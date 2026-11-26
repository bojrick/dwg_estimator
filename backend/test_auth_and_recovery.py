import json
import os
import socket
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

_TMP_DIR = tempfile.TemporaryDirectory(prefix="planvault_auth_test_")
os.environ["STORAGE_DIR"] = _TMP_DIR.name
os.environ.pop("DATABASE_URL", None)

import uvicorn  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app.database import STORAGE_DIR, engine, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.schema import Plan, User  # noqa: E402
from app.services import logger as app_logger_mod  # noqa: E402
from app.services.auth import create_access_token, hash_password  # noqa: E402


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _request(base_url: str, path: str, method: str = "GET", headers: dict = None, body: dict = None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req_headers = dict(headers or {})
    if body is not None and "Content-Type" not in req_headers:
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{base_url}{path}", data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = raw
        return exc.code, parsed


def test_logger_path_and_readonly_safety():
    assert app_logger_mod.LOG_DIR == Path(STORAGE_DIR) / "logs"
    assert app_logger_mod.LOG_DIR.exists()

    # Verify logger initialization handles unwritable paths without raising
    import importlib
    orig_mkdir = Path.mkdir
    def fail_mkdir(self, *args, **kwargs):
        if self == app_logger_mod.LOG_DIR:
            raise PermissionError("Simulated read-only filesystem")
        return orig_mkdir(self, *args, **kwargs)

    Path.mkdir = fail_mkdir
    try:
        importlib.reload(app_logger_mod)
        app_logger_mod.app_logger.info("Logger survived read-only path")
    finally:
        Path.mkdir = orig_mkdir
        importlib.reload(app_logger_mod)


def test_init_db_preserves_ownership():
    init_db()
    with Session(engine) as session:
        ph, salt = hash_password("secret123")
        u1 = User(id="uid-1", email="first@example.com", password_hash=ph, salt=salt)
        session.add(u1)
        unclaimed = Plan(user_id=None, name="Unclaimed Legacy Plan", project_name="Proj 1")
        session.add(unclaimed)
        session.commit()
        unclaimed_id = unclaimed.id

    # With 1 user, unclaimed plan gets claimed
    init_db()
    with Session(engine) as session:
        assert session.get(Plan, unclaimed_id).user_id == "uid-1"

        # Add a second user and an externally-owned (e.g. Supabase) plan
        ph2, salt2 = hash_password("secret456")
        u2 = User(id="uid-2", email="second@example.com", password_hash=ph2, salt=salt2)
        ext_plan = Plan(user_id="external-supabase-uid", name="External Plan", project_name="Proj Ext")
        session.add(u2)
        session.add(ext_plan)
        session.commit()
        ext_plan_id = ext_plan.id

    # Re-running init_db with multiple users must NOT wipe external-supabase-uid to None
    init_db()
    with Session(engine) as session:
        assert session.get(Plan, ext_plan_id).user_id == "external-supabase-uid"
        assert session.get(Plan, unclaimed_id).user_id == "uid-1"


def test_auth_and_plans_http():
    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{port}"

    for _ in range(50):
        try:
            st, _ = _request(base_url, "/api/health")
            if st == 200:
                break
        except Exception:
            time.sleep(0.05)

    try:
        # 1. Guest GET /api/plans (no token) returns 200 with empty list
        st, data = _request(base_url, "/api/plans")
        assert st == 200, f"Expected 200 for guest, got {st}: {data}"
        assert data["plans"] == []

        # 2. Invalid or expired Bearer token on GET /api/plans returns 401 (never silent 200 empty)
        st, data = _request(base_url, "/api/plans", headers={"Authorization": "Bearer invalid.jwt.token"})
        assert st == 401, f"Expected 401 for invalid token, got {st}: {data}"

        expired_tok = create_access_token("uid-1", "first@example.com", expires_in_seconds=-60)
        st, data = _request(base_url, "/api/plans", headers={"Authorization": f"Bearer {expired_tok}"})
        assert st == 401, f"Expected 401 for expired token, got {st}: {data}"

        # 3. Sign in with mixed-case email works and returns user's plans
        st, signin_data = _request(
            base_url,
            "/api/auth/signin",
            method="POST",
            body={"email": "  First@Example.COM ", "password": "secret123"},
        )
        assert st == 200, f"Expected 200 signin, got {st}: {signin_data}"
        tok1 = signin_data["access_token"]
        assert signin_data["user"]["id"] == "uid-1"

        # Wrong password rejected with 401
        st, bad = _request(
            base_url,
            "/api/auth/signin",
            method="POST",
            body={"email": "first@example.com", "password": "wrong-password"},
        )
        assert st == 401, f"Expected 401 on wrong password, got {st}: {bad}"

        # 4. Authenticated user sees their own plan and not other users' plans
        st, plans_res = _request(base_url, "/api/plans", headers={"Authorization": f"Bearer {tok1}"})
        assert st == 200
        names = [p["name"] for p in plans_res["plans"]]
        assert "Unclaimed Legacy Plan" in names
        assert "External Plan" not in names
    finally:
        server.should_exit = True
        thread.join(timeout=3)


if __name__ == "__main__":
    try:
        test_logger_path_and_readonly_safety()
        test_init_db_preserves_ownership()
        test_auth_and_plans_http()
        print("✓ ALL AUTH & RECOVERY TESTS PASSED!")
    finally:
        _TMP_DIR.cleanup()
