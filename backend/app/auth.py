"""Password hashing (stdlib scrypt), JWT issue/verify, and FastAPI auth dependencies."""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import logging
import os
import secrets

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import users

log = logging.getLogger("hikingpsu.auth")

TOKEN_TTL = dt.timedelta(days=7)
_N, _R, _P = 2**14, 8, 1

_secret = os.getenv("JWT_SECRET")
if not _secret:
    log.warning("JWT_SECRET not set; using a random one (logins reset on every restart)")
    _secret = secrets.token_hex(32)

_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return "scrypt${}${}".format(base64.b64encode(salt).decode(), base64.b64encode(digest).decode())


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_b64, digest_b64 = stored.split("$")
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(digest_b64)
    except ValueError:
        return False
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=len(expected))
    return hmac.compare_digest(digest, expected)


# Verified against when the email is unknown, so login time doesn't reveal which emails exist.
DUMMY_HASH = hash_password(secrets.token_hex(8))


def issue_token(user_id: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    return jwt.encode({"sub": user_id, "iat": now, "exp": now + TOKEN_TTL}, _secret, algorithm="HS256")


def _user_id_from(creds: HTTPAuthorizationCredentials) -> str:
    try:
        return jwt.decode(creds.credentials, _secret, algorithms=["HS256"])["sub"]
    except (jwt.PyJWTError, KeyError):
        raise HTTPException(401, "invalid or expired token", headers={"WWW-Authenticate": "Bearer"})


def current_user_id_optional(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str | None:
    """Anonymous callers pass through; a token that is present but bad is a 401."""
    return _user_id_from(creds) if creds else None


def current_user_id(user_id: str | None = Depends(current_user_id_optional)) -> str:
    if user_id is None:
        raise HTTPException(401, "authentication required", headers={"WWW-Authenticate": "Bearer"})
    return user_id


def current_user(user_id: str = Depends(current_user_id)) -> dict:
    user = users.get(user_id)
    if user is None:  # token outlived the account
        raise HTTPException(401, "account no longer exists", headers={"WWW-Authenticate": "Bearer"})
    return user
