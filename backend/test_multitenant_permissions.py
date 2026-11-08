import json
from pathlib import Path
import urllib.request
import urllib.error
from sqlmodel import Session, select

from app.database import engine
from app.models.schema import Plan, User
from app.services.auth import create_access_token, hash_password

BASE_URL = "http://127.0.0.1:8000"

def do_req(path: str, method: str = "GET", headers: dict = None, body: dict = None):
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    h = headers or {}
    if body and "Content-Type" not in h:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            content = resp.read().decode("utf-8")
            return resp.status, json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        content = e.read().decode("utf-8")
        try:
            parsed = json.loads(content)
        except Exception:
            parsed = content
        return e.code, parsed

def test_multitenant_isolation():
    with Session(engine) as session:
        # Create user A
        user_a = session.exec(select(User).where(User.email == "user_a@test.com")).first()
        if not user_a:
            p_hash, salt = hash_password("password123")
            user_a = User(id="user-a-uuid", email="user_a@test.com", password_hash=p_hash, salt=salt)
            session.add(user_a)
            session.commit()
            session.refresh(user_a)
        user_a_id = user_a.id
        user_a_email = user_a.email

        # Create user B
        user_b = session.exec(select(User).where(User.email == "user_b@test.com")).first()
        if not user_b:
            p_hash, salt = hash_password("password123")
            user_b = User(id="user-b-uuid", email="user_b@test.com", password_hash=p_hash, salt=salt)
            session.add(user_b)
            session.commit()
            session.refresh(user_b)
        user_b_id = user_b.id
        user_b_email = user_b.email

        # Create Plan owned by User A
        plan_a = session.exec(select(Plan).where(Plan.name == "Test Plan User A")).first()
        if not plan_a:
            plan_a = Plan(
                user_id=user_a.id,
                name="Test Plan User A",
                project_name="Project Alpha",
                discipline="architectural",
                share_token="share-test-token-a",
                sheets_json="[]",
                measurements_json="[]",
            )
            session.add(plan_a)
            session.commit()
            session.refresh(plan_a)
        plan_a_id = plan_a.id
        plan_a_share = plan_a.share_token

    token_a = create_access_token(user_a_id, user_a_email)
    token_b = create_access_token(user_b_id, user_b_email)

    # 1. Unauthenticated GET /api/plans returns empty list, does not leak User A's plan
    status, data_guest = do_req("/api/plans")
    assert status == 200, f"Expected 200, got {status}: {data_guest}"
    assert data_guest["plans"] == [], f"Expected empty plans for guest, got {data_guest['plans']}"
    assert data_guest["projects"] == []

    # 2. Authenticated User A sees Plan A
    status, data_user_a = do_req("/api/plans", headers={"Authorization": f"Bearer {token_a}"})
    assert status == 200
    plan_ids_a = [p["id"] for p in data_user_a["plans"]]
    assert plan_a_id in plan_ids_a

    # 3. Authenticated User B does NOT see Plan A
    status, data_user_b = do_req("/api/plans", headers={"Authorization": f"Bearer {token_b}"})
    assert status == 200
    plan_ids_b = [p["id"] for p in data_user_b["plans"]]
    assert plan_a_id not in plan_ids_b

    # 4. Guest cannot access Plan A details via GET /api/plans/{id} without share token
    status, err = do_req(f"/api/plans/{plan_a_id}")
    assert status == 401, f"Expected 401 for guest accessing private plan, got {status}"

    # 5. User B cannot access Plan A details (returns 404, preventing enumeration)
    status, err = do_req(f"/api/plans/{plan_a_id}", headers={"Authorization": f"Bearer {token_b}"})
    assert status == 404, f"Expected 404 for User B accessing User A plan, got {status}"

    # 6. Guest CAN access Plan A via share token
    status, shared_data = do_req(f"/api/plans/share/{plan_a_share}")
    assert status == 200, f"Expected 200 for shared endpoint, got {status}"
    assert shared_data["plan"]["id"] == plan_a_id

    status, shared_param_data = do_req(f"/api/plans/{plan_a_id}?share={plan_a_share}")
    assert status == 200, f"Expected 200 with ?share=, got {status}"
    assert shared_param_data["plan"]["id"] == plan_a_id

    # 7. Project rename / delete by User B cannot touch User A's project
    status, err = do_req(
        "/api/projects/Project%20Alpha",
        method="PATCH",
        headers={"Authorization": f"Bearer {token_b}"},
        body={"new_name": "Project Hacked"},
    )
    assert status == 404, f"Expected 404 when User B tries to rename User A project, got {status}"

    with Session(engine) as session:
        refreshed = session.get(Plan, plan_a_id)
        assert refreshed.project_name == "Project Alpha"

    print("✓ ALL MULTI-TENANT PERMISSION TESTS PASSED!")

if __name__ == "__main__":
    test_multitenant_isolation()
