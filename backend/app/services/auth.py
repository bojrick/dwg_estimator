import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any, Dict, Optional, Tuple
import urllib.error
import urllib.request
from fastapi import Header, HTTPException

# Secret key for signing FOSS native tokens (defaults to local random / env)
NATIVE_JWT_SECRET = os.getenv("AUTH_SECRET_KEY") or os.getenv("SUPABASE_JWT_SECRET") or "planvault-secret-foss-auth-key-32b"
# Cache verified tokens: {sha256(token): (expires_at, user_dict)}
_TOKEN_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}


def hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
    if not salt:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return dk.hex(), salt


def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return hmac.compare_digest(dk.hex(), expected_hash)


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode(data + pad)


def create_access_token(user_id: str, email: str, expires_in_seconds: int = 30 * 86400) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": int(time.time()),
        "exp": int(time.time() + expires_in_seconds),
        "iss": "planvault-foss",
    }
    encoded_header = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    encoded_payload = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = hmac.new(NATIVE_JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
    encoded_signature = _b64url_encode(signature)
    return f"{encoded_header}.{encoded_payload}.{encoded_signature}"


def verify_native_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        signing_input = f"{parts[0]}.{parts[1]}".encode("ascii")
        expected_sig = hmac.new(NATIVE_JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
        if not hmac.compare_digest(expected_sig, _b64url_decode(parts[2])):
            return None
        payload = json.loads(_b64url_decode(parts[1]).decode("utf-8"))
        if payload.get("exp") and time.time() >= float(payload["exp"]):
            raise HTTPException(status_code=401, detail="Session expired, please sign in again")
        sub = payload.get("sub")
        if sub:
            return {"id": str(sub), "email": payload.get("email", ""), "iss": payload.get("iss", "planvault-foss")}
    except HTTPException:
        raise
    except Exception:
        return None
    return None


def get_supabase_config() -> Dict[str, str]:
    return {
        "url": (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").strip().rstrip("/"),
        "anon_key": (os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY") or "").strip(),
        "jwt_secret": (os.getenv("SUPABASE_JWT_SECRET") or "").strip(),
    }


def is_supabase_enabled() -> bool:
    cfg = get_supabase_config()
    return bool((cfg["url"] and cfg["anon_key"]) or cfg["jwt_secret"])


def is_auth_enabled() -> bool:
    # Native FOSS auth is always enabled
    return True


def verify_token(token: str) -> Dict[str, Any]:
    # 1. First attempt native token verification
    native_user = verify_native_token(token)
    if native_user:
        return native_user

    # 2. Check Supabase token if Supabase is configured
    cfg = get_supabase_config()
    if cfg["jwt_secret"]:
        try:
            parts = token.split(".")
            if len(parts) == 3:
                header = json.loads(_b64url_decode(parts[0]).decode("utf-8"))
                if header.get("alg") == "HS256":
                    signing_input = f"{parts[0]}.{parts[1]}".encode("ascii")
                    expected = hmac.new(cfg["jwt_secret"].encode("utf-8"), signing_input, hashlib.sha256).digest()
                    if hmac.compare_digest(expected, _b64url_decode(parts[2])):
                        payload = json.loads(_b64url_decode(parts[1]).decode("utf-8"))
                        if payload.get("exp") and time.time() >= float(payload["exp"]):
                            raise HTTPException(status_code=401, detail="Session expired, please sign in again")
                        sub = payload.get("sub")
                        if sub:
                            return {"id": str(sub), "email": payload.get("email", "")}
        except HTTPException:
            raise
        except Exception:
            pass

    if cfg["url"] and cfg["anon_key"]:
        cache_key = hashlib.sha256(token.encode("utf-8")).hexdigest()
        cached = _TOKEN_CACHE.get(cache_key)
        now = time.time()
        if cached and cached[0] > now:
            return cached[1]

        req = urllib.request.Request(
            f"{cfg['url']}/auth/v1/user",
            headers={"apikey": cfg["anon_key"], "Authorization": f"Bearer {token}"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                user_data = json.loads(resp.read().decode("utf-8"))
                user_id = user_data.get("id")
                if user_id:
                    result = {"id": str(user_id), "email": user_data.get("email", "")}
                    _TOKEN_CACHE[cache_key] = (now + 300, result)
                    return result
        except Exception:
            pass

    raise HTTPException(status_code=401, detail="Invalid or expired session, please sign in again")


def extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.strip().split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
        return parts[1].strip()
    return None


def get_current_user_id(authorization: Optional[str] = Header(default=None)) -> Optional[str]:
    token = extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Sign in required to access or save plans")
    return verify_token(token)["id"]


def get_optional_user_id(authorization: Optional[str] = Header(default=None)) -> Optional[str]:
    token = extract_bearer_token(authorization)
    if not token:
        return None
    try:
        return verify_token(token)["id"]
    except Exception:
        return None
