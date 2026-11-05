import base64
import hashlib
import hmac
import json
import os
import time
from fastapi import HTTPException
from sqlmodel import Session
from app.database import engine, init_db
from app.models.schema import Plan
from app.routers.plans import (
    UpdatePlanRequest,
    delete_plan,
    get_plan,
    get_shared_plan,
    list_plans,
    update_plan_view_or_units,
)
from app.services.auth import get_current_user_id
from app.services.dxf_parser import (
    infer_discipline,
    infer_project_name,
    merge_dwg_views_to_single_plan,
)


def test_infer_discipline_and_project():
    assert infer_discipline("1086  Electrical Layout Ground floor.dwg") == "electrical"
    assert infer_discipline("Tower_A_Structural_Column_Footing.dwg") == "structural"
    assert infer_discipline("Block_B_Plumbing_Water_Supply.dxf") == "plumbing"
    assert infer_discipline("Basement_Fire_Sprinkler_Hydrant.dwg") == "fire"
    assert infer_discipline("1086 mansa  BLOCK - A+B   working plan.dwg") == "architectural"
    # Ensure 'color' doesn't false-match 'col' (structural)
    assert infer_discipline("Color_Presentation_Floor_Plan.dwg") == "architectural"

    proj1 = infer_project_name("1086 mansa  BLOCK - A+B   working plan.dwg")
    assert proj1 == "1086 Mansa"
    proj2 = infer_project_name("1086  Electrical Layout Ground floor.dwg", [proj1])
    assert proj2 == "1086 Mansa"


def test_plans_api_project_and_discipline():
    init_db()
    with Session(engine) as session:
        data = list_plans(session=session)
        assert "projects" in data
        assert "plans" in data
        if data["plans"]:
            p0 = data["plans"][0]
            assert "project_name" in p0
            assert "discipline" in p0
            orig_disc = p0["discipline"]
            res = update_plan_view_or_units(
                p0["id"],
                UpdatePlanRequest(discipline="fire"),
                session=session,
            )
            assert res["plan"]["discipline"] == "fire"
            update_plan_view_or_units(
                p0["id"],
                UpdatePlanRequest(discipline=orig_disc),
                session=session,
            )


def _make_hs256_jwt(sub: str, email: str, secret: str) -> str:
    b64 = lambda obj: base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    hdr = b64({"alg": "HS256", "typ": "JWT"})
    pld = b64({"sub": sub, "email": email, "exp": int(time.time()) + 3600})
    sig = base64.urlsafe_b64encode(
        hmac.new(secret.encode(), f"{hdr}.{pld}".encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    return f"{hdr}.{pld}.{sig}"


def test_supabase_user_isolation():
    init_db()
    secret = "test-supabase-jwt-secret"
    os.environ["SUPABASE_JWT_SECRET"] = secret
    try:
        tok_a = _make_hs256_jwt("user-uuid-a", "a@example.com", secret)
        tok_b = _make_hs256_jwt("user-uuid-b", "b@example.com", secret)
        uid_a = get_current_user_id(f"Bearer {tok_a}")
        uid_b = get_current_user_id(f"Bearer {tok_b}")
        assert uid_a == "user-uuid-a"
        assert uid_b == "user-uuid-b"

        with Session(engine) as session:
            plan_a = Plan(user_id=uid_a, name="User A Secret Plan", project_name="Proj A")
            session.add(plan_a)
            session.commit()
            session.refresh(plan_a)
            try:
                plans_a_ids = {p["id"] for p in list_plans(session=session, user_id=uid_a)["plans"]}
                plans_b_ids = {p["id"] for p in list_plans(session=session, user_id=uid_b)["plans"]}
                assert plan_a.id in plans_a_ids
                assert plan_a.id not in plans_b_ids

                # User B cannot access or modify User A's plan
                try:
                    get_plan(plan_a.id, session=session, user_id=uid_b)
                    assert False, "User B should not access User A plan"
                except HTTPException as exc:
                    assert exc.status_code == 404

                # Share token still resolves publicly
                shared = get_shared_plan(plan_a.share_token, session=session)
                assert shared["plan"]["id"] == plan_a.id
            finally:
                delete_plan(plan_a.id, session=session, user_id=uid_a)
    finally:
        os.environ.pop("SUPABASE_JWT_SECRET", None)


def test_custom_sheet_and_name_editing():
    init_db()
    with Session(engine) as session:
        test_plan = Plan(
            name="Original Plan Name",
            project_name="Test Project",
            sheets_json=json.dumps([
                {
                    "id": "sheet_1",
                    "name": "Original Sheet 1",
                    "description": "Floor plan description",
                    "bbox": {"min_x": 0, "min_y": 0, "max_x": 50, "max_y": 50, "width": 50, "height": 50},
                }
            ]),
        )
        session.add(test_plan)
        session.commit()
        session.refresh(test_plan)

        try:
            # Test editing plan name and sheet name/description
            custom_sheets = [
                {
                    "id": "sheet_1",
                    "name": "Renamed Ground Floor",
                    "description": "Working layout with room dims and column marks",
                    "bbox": {"min_x": 0, "min_y": 0, "max_x": 50, "max_y": 50, "width": 50, "height": 50},
                },
                {
                    "id": "sheet_2",
                    "name": "Section A-A",
                    "description": "Staircase and ceiling height details",
                    "bbox": {"min_x": 60, "min_y": 0, "max_x": 100, "max_y": 40, "width": 40, "height": 40},
                },
            ]
            res = update_plan_view_or_units(
                test_plan.id,
                UpdatePlanRequest(
                    name="Edited Master DWG File",
                    sheets=custom_sheets,
                ),
                session=session,
            )
            assert res["plan"]["name"] == "Edited Master DWG File"
            assert len(res["plan"]["sheets"]) == 2
            assert res["plan"]["sheets"][0]["name"] == "Renamed Ground Floor"
            assert "Working layout" in res["plan"]["sheets"][0]["description"]
            assert res["plan"]["sheets"][1]["name"] == "Section A-A"
        finally:
            delete_plan(test_plan.id, session=session)


def test_merge_dwg_views_to_single_plan():
    files_data = {
        "file_0": {
            "filename": "Tower_A_Ground.dwg",
            "raw_data": {
                "unit_name": "m",
                "scale_to_m": 1.0,
                "bbox_raw": {"min_x": 0, "min_y": 0, "max_x": 30, "max_y": 20, "width": 30, "height": 20},
                "lines": [
                    {"start": [0, 0], "end": [30, 0], "layer": "WALL", "color": "#00ff00"},
                    {"start": [30, 0], "end": [30, 20], "layer": "WALL", "color": "#00ff00"},
                ],
                "polylines": [],
                "arcs_circles": [],
                "texts": [{"x": 15, "y": 10, "text": "ROOM A", "layer": "TEXT", "height": 0.3}],
                "hatches": [],
                "sheets": [
                    {
                        "id": "sheet_a",
                        "name": "Tower A Ground Plan",
                        "bbox": {"min_x": 0, "min_y": 0, "max_x": 30, "max_y": 20, "width": 30, "height": 20},
                    }
                ],
            },
        },
        "file_1": {
            "filename": "Tower_B_Typical.dwg",
            "raw_data": {
                "unit_name": "mm",
                "scale_to_m": 0.001,
                "bbox_raw": {"min_x": 0, "min_y": 0, "max_x": 40000, "max_y": 25000, "width": 40000, "height": 25000},
                "lines": [
                    {"start": [0, 0], "end": [40000, 0], "layer": "WALL", "color": "#ff0000"},
                ],
                "polylines": [],
                "arcs_circles": [],
                "texts": [{"x": 20000, "y": 12500, "text": "ROOM B", "layer": "TEXT", "height": 300}],
                "hatches": [],
                "sheets": [
                    {
                        "id": "sheet_b",
                        "name": "Tower B Typical Floor",
                        "bbox": {"min_x": 0, "min_y": 0, "max_x": 40000, "max_y": 25000, "width": 40000, "height": 25000},
                    }
                ],
            },
        },
    }

    selected_sheets = [
        {
            "id": "sheet_1",
            "name": "Tower A Ground",
            "file_id": "file_0",
            "bbox": {"min_x": 0, "min_y": 0, "max_x": 30, "max_y": 20, "width": 30, "height": 20},
        },
        {
            "id": "sheet_2",
            "name": "Tower B Typical",
            "file_id": "file_1",
            "bbox": {"min_x": 0, "min_y": 0, "max_x": 40000, "max_y": 25000, "width": 40000, "height": 25000},
        },
    ]

    merged = merge_dwg_views_to_single_plan(selected_sheets, files_data)
    assert len(merged["sheets"]) == 2
    assert merged["unit_name"] == "m"
    assert merged["scale_to_m"] == 1.0

    # Ensure sheet 1 and sheet 2 do not overlap horizontally
    s1 = merged["sheets"][0]
    s2 = merged["sheets"][1]
    assert s1["bbox"]["max_x"] < s2["bbox"]["min_x"]

    # Verify entities from both files exist in merged modelspace (2 lines from file_0 + 1 line from file_1 = 3)
    assert len(merged["lines"]) == 3
    assert len(merged["texts"]) == 2

    # Verify unit conversion (mm to m: 40000 mm -> 40 m width)
    assert abs(s2["bbox"]["width"] - 40.0) < 0.1
    # Check text height in meters
    t_b = next(t for t in merged["texts"] if t["text"] == "ROOM B")
    assert abs(t_b["height"] - 0.3) < 0.01


if __name__ == "__main__":
    test_infer_discipline_and_project()
    test_plans_api_project_and_discipline()
    test_supabase_user_isolation()
    test_custom_sheet_and_name_editing()
    test_merge_dwg_views_to_single_plan()
    print("All plan organization & API checks passed.")
