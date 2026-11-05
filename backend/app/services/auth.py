import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Dict, Optional
import urllib.error
import urllib.request
from fastapi import Header, HTTPException

# Cache verified tokens via /auth/v1/user: {sha256(token): (expires_at, user_dict)}
_TOKEN_CACHE: Dict[str, tuple[float, Dict[str, Any]]] = {}


def get_supabase_config() -> Dict[str, str]:
    return {
        "url": (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").strip().rstrip("/"),
        "anon_key": (os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY") or "").strip(),
        "jwt_secret": (os.getenv("SUPABASE_JWT_SECRET") or "").strip(),
    }


def is_auth_enabled() -> bool:
    cfg = get_supabase_config()
    return bool((cfg["url"] and cfg["anon_key"]) or cfg["jwt_secret"])


def _b64url_decode(data: str) -> bytes:
    pad = "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode(data + pad)


def verify_supabase_token(token: str) -> Dict[str, Any]:
    cfg = get_supabase_config()
    # 1. Fast local verification when SUPABASE_JWT_SECRET is provided (HS256)
    if cfg["jwt_secret"]:
        try:
            parts = token.split(".")
            if len(parts) == 3:
                header = json.loads(_b64url_decode(parts[0]).decode("utf-8"))
                if header.get("alg") == "HS256":
                    signing_input = f"{parts[0]}.{parts[1]}".encode("ascii")
                    expected = hmac.new(cfg["jwt_secret"].encode("utf-8"), signing_input, hashlib.sha256).digest()
                    if not hmac.compare_digest(expected, _b64url_decode(parts[2])):
                        raise HTTPException(status_code=401, detail="Invalid token signature")
                    payload = json.loads(_b64url_decode(parts[1]).decode("utf-8"))
                    if payload.get("exp") and time.time() >= float(payload["exp"]):
                        raise HTTPException(status_code=401, detail="Session expired, please sign in again")
                    sub = payload.get("sub")
                    if sub:
                        return {"id": str(sub), "email": payload.get("email", "")}
        except HTTPException:
            raise
        except Exception:
            if not (cfg["url"] and cfg["anon_key"]):
                raise HTTPException(status_code=401, detail="Invalid authentication token")

    # 2. Verify with Supabase Auth server (/auth/v1/user) — supports ES256 & HS256 without needing JWT secret
    if not (cfg["url"] and cfg["anon_key"]):
        raise HTTPException(status_code=401, detail="Supabase Auth is not configured")

    cache_key = hashlib.sha256(token.encode("utf-8")).hexdigest()
    cached = _TOKEN_CACHE.get(cache_key)
    now = time.time()
    if cached and cached[0] > now:
        return cached[1]

    req = urllib.request.Request(
        f"{cfg['url']}/auth/v1/user",
        headers={
            "apikey": cfg["anon_key"],
            "Authorization": f"Bearer {token}",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            user_data = json.loads(resp.read().decode("utf-8"))
            user_id = user_data.get("id")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid user session")
            result = {"id": str(user_id), "email": user_data.get("email", "")}
            _TOKEN_CACHE[cache_key] = (now + 300, result)
            return result
    except urllib.error.HTTPError:
        raise HTTPException(status_code=401, detail="Invalid or expired session, please sign in again")
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Auth verification failed: {exc}")


def extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.strip().split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
        return parts[1].strip()
    return None


def get_current_user_id(authorization: Optional[str] = Header(default=None)) -> Optional[str]:
    if not is_auth_enabled():
        return None
    if not isinstance(authorization, str):
        authorization = None
    token = extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Sign in required to access your plans")
    return verify_supabase_token(token)["id"]

