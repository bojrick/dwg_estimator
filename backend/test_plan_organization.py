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
from app.services.dxf_parser import infer_discipline, infer_project_name


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


if __name__ == "__main__":
    test_infer_discipline_and_project()
    test_plans_api_project_and_discipline()
    test_supabase_user_isolation()
    print("All plan organization & API checks passed.")
