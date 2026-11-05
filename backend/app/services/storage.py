from datetime import datetime, timezone
import hashlib
import hmac
import os
from pathlib import Path
from typing import Optional
import urllib.parse
import urllib.request
from dotenv import load_dotenv

from app.database import CLOUD_FALLBACK_DIR

# Load environment variables from backend/.env or root .env
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
load_dotenv()


def _safe_local_path(key: str) -> Path:
    clean_parts = [p for p in Path(key).parts if p not in ("", ".", "..", "/")]
    if not clean_parts:
        raise ValueError("Invalid storage key")
    target = (CLOUD_FALLBACK_DIR / Path(*clean_parts)).resolve()
    if not str(target).startswith(str(CLOUD_FALLBACK_DIR.resolve())):
        raise ValueError("Storage key escapes root directory")
    return target


def _get_r2_config():
    # Supports explicit R2 variables or standard S3 variables
    bucket = os.getenv("R2_BUCKET") or os.getenv("S3_BUCKET")
    access_key = os.getenv("R2_ACCESS_KEY_ID") or os.getenv("S3_ACCESS_KEY_ID")
    secret_key = os.getenv("R2_SECRET_ACCESS_KEY") or os.getenv("S3_SECRET_ACCESS_KEY")
    account_id = os.getenv("R2_ACCOUNT_ID")

    endpoint = os.getenv("R2_ENDPOINT_URL") or os.getenv("S3_ENDPOINT_URL")
    if not endpoint and account_id:
        endpoint = f"https://{account_id}.r2.cloudflarestorage.com"

    return {
        "bucket": bucket,
        "access_key": access_key,
        "secret_key": secret_key,
        "endpoint": endpoint,
        "region": os.getenv("R2_REGION", os.getenv("S3_REGION", "auto")),
    }


def is_r2_configured() -> bool:
    cfg = _get_r2_config()
    return bool(cfg["bucket"] and cfg["access_key"] and cfg["secret_key"] and cfg["endpoint"])


def get_storage_backend_name() -> str:
    if is_r2_configured():
        cfg = _get_r2_config()
        return f"cloudflare-r2://{cfg['bucket']}"
    return "cloud-vault (local-mirrored)"


def _s3_request(method: str, key: str, data: Optional[bytes] = None, content_type: str = "application/octet-stream") -> bytes:
    cfg = _get_r2_config()
    bucket = cfg["bucket"]
    access_key = cfg["access_key"]
    secret_key = cfg["secret_key"]
    region = cfg["region"]
    endpoint = cfg["endpoint"].rstrip("/")

    parsed = urllib.parse.urlparse(endpoint)
    host = parsed.netloc
    quoted_key = urllib.parse.quote(key.lstrip("/"), safe="/-_.~")
    if bucket not in host:
        uri_path = f"/{bucket}/{quoted_key}"
    else:
        uri_path = f"/{quoted_key}"

    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(data or b"").hexdigest()

    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    if data is not None:
        headers["content-type"] = content_type

    signed_headers = ";".join(sorted(headers.keys()))
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers.keys()))
    canonical_request = f"{method}\n{uri_path}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"

    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = (
        f"AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n"
        f"{hashlib.sha256(canonical_request.encode()).hexdigest()}"
    )

    def _sign(k: bytes, msg: str) -> bytes:
        return hmac.new(k, msg.encode("utf-8"), hashlib.sha256).digest()

    k_date = _sign(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, "s3")
    k_signing = _sign(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    headers["Authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    url = f"{parsed.scheme}://{host}{uri_path}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def put_object(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    local_path = _safe_local_path(key)
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_bytes(data)
    if is_r2_configured():
        _s3_request("PUT", key, data=data, content_type=content_type)
    return key


def get_object_bytes(key: str) -> bytes:
    local_path = _safe_local_path(key)
    if local_path.exists():
        return local_path.read_bytes()
    if is_r2_configured():
        data = _s3_request("GET", key)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(data)
        return data
    raise FileNotFoundError(f"Object '{key}' not found in cloud storage")


def get_local_cached_path(key: str) -> Path:
    local_path = _safe_local_path(key)
    if not local_path.exists() and is_r2_configured():
        get_object_bytes(key)
    if not local_path.exists():
        raise FileNotFoundError(f"Object '{key}' not found in cloud storage")
    return local_path


def delete_object(key: Optional[str]) -> None:
    if not key:
        return
    try:
        local_path = _safe_local_path(key)
        if local_path.exists():
            local_path.unlink()
    except Exception:
        pass
    if is_r2_configured():
        try:
            _s3_request("DELETE", key)
        except Exception:
            pass
