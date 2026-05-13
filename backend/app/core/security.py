import hmac
import hashlib
import base64
import json
from datetime import datetime, timedelta, timezone
from typing import Optional
import bcrypt
from app.core.config import settings


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def _sign(data: str, key: str) -> str:
    return _b64url_encode(
        hmac.new(key.encode(), data.encode(), hashlib.sha256).digest()
    )


def _encode_jwt(payload: dict) -> str:
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64url_encode(json.dumps(payload).encode())
    sig = _sign(f"{header}.{body}", settings.SECRET_KEY)
    return f"{header}.{body}.{sig}"


def _decode_jwt(token: str) -> Optional[dict]:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header, body, sig = parts
        expected_sig = _sign(f"{header}.{body}", settings.SECRET_KEY)
        if not hmac.compare_digest(expected_sig, sig):
            return None
        payload = json.loads(_b64url_decode(body))
        exp = payload.get("exp")
        if exp and datetime.now(timezone.utc).timestamp() > exp:
            return None
        return payload
    except Exception:
        return None


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    payload = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload.update({"exp": expire.timestamp(), "type": "access"})
    return _encode_jwt(payload)


def create_refresh_token(data: dict) -> str:
    payload = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload.update({"exp": expire.timestamp(), "type": "refresh"})
    return _encode_jwt(payload)


def decode_token(token: str) -> Optional[dict]:
    return _decode_jwt(token)
