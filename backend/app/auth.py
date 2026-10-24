"""Login via Auth0, plus the FastAPI dependencies every user route uses.

The browser logs in with Auth0 and sends `Authorization: Bearer <access token>`.
We verify that token with Auth0's public keys (nothing secret on our side) and use its
`sub` claim ("auth0|65f1..." / "google-oauth2|1098...") as the user id everywhere.
Passwords never reach this server and nothing password-related is stored.

Dependencies (same names as before, so routes didn't change):
    current_user_id_optional -> str | None   anonymous OK; a bad token is a 401
    current_user_id          -> str          401 unless logged in
    current_user             -> dict         the users document, created on first use
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import quote

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import users

log = logging.getLogger("hikingpsu.auth")

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Identity:
    id: str     # Auth0 "sub"
    token: str  # raw access token, only needed to call Auth0 /userinfo


def _settings() -> tuple[str, str]:
    domain = os.getenv("AUTH0_DOMAIN", "").strip().removeprefix("https://").rstrip("/")
    audience = os.getenv("AUTH0_AUDIENCE", "").strip()
    return domain, audience


def auth_configured() -> bool:
    return all(_settings())


@lru_cache(maxsize=4)
def _jwks_client(domain: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"https://{domain}/.well-known/jwks.json", cache_keys=True)


def _unauthorized(msg: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, msg, headers={"WWW-Authenticate": "Bearer"})


def verify_token(token: str) -> Identity:
    domain, audience = _settings()
    if not (domain and audience):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "login is not configured on this server")
    try:
        key = _jwks_client(domain).get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=audience,
            issuer=f"https://{domain}/",
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise _unauthorized("token expired, please log in again")
    except jwt.PyJWKClientError:
        raise _unauthorized("could not verify token signing key")
    except jwt.InvalidTokenError as e:
        raise _unauthorized(f"invalid token: {e.__class__.__name__}")
    return Identity(id=claims["sub"], token=token)


def fetch_profile(identity: Identity) -> dict:
    """Email / name from Auth0 /userinfo (access tokens don't carry them). Used once, on first login."""
    domain, _ = _settings()
    try:
        r = httpx.get(f"https://{domain}/userinfo", headers={"Authorization": f"Bearer {identity.token}"}, timeout=8)
        r.raise_for_status()
        info = r.json()
    except Exception:
        log.warning("could not fetch Auth0 userinfo for %s", identity.id)
        return {}
    return {"email": info.get("email"), "name": info.get("name") or info.get("nickname")}


def delete_login(user_id: str) -> bool:
    """Delete the Auth0 login itself, so the same email can't sign back in to this account.

    Needs a Machine-to-Machine Auth0 app allowed `delete:users` on the Management API
    (AUTH0_MGMT_CLIENT_ID / AUTH0_MGMT_CLIENT_SECRET). Without them, or if Auth0 fails, returns False
    and the login stays: signing in again then starts a fresh, empty account.
    """
    domain, _ = _settings()
    client_id, secret = os.getenv("AUTH0_MGMT_CLIENT_ID", "").strip(), os.getenv("AUTH0_MGMT_CLIENT_SECRET", "").strip()
    if not (domain and client_id and secret):
        return False
    try:
        r = httpx.post(f"https://{domain}/oauth/token", timeout=8, json={
            "grant_type": "client_credentials", "client_id": client_id, "client_secret": secret,
            "audience": f"https://{domain}/api/v2/",
        })
        r.raise_for_status()
        token = r.json()["access_token"]
        r = httpx.delete(f"https://{domain}/api/v2/users/{quote(user_id, safe='')}",
                         headers={"Authorization": f"Bearer {token}"}, timeout=8)
        r.raise_for_status()
        return True
    except Exception:
        log.warning("could not delete Auth0 login for %s", user_id)
        return False


# ---------- FastAPI dependencies ----------

def current_identity_optional(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Identity | None:
    """Anonymous callers pass through. A token that is present but bad is a 401.

    If login isn't configured on this server, tokens are ignored so public routes (/chat) keep working.
    """
    if creds is None or not auth_configured():
        return None
    return verify_token(creds.credentials)


def current_user_id_optional(identity: Identity | None = Depends(current_identity_optional)) -> str | None:
    return identity.id if identity else None


def current_identity(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Identity:
    if creds is None:
        raise _unauthorized("authentication required")
    return verify_token(creds.credentials)


def current_user_id(identity: Identity = Depends(current_identity)) -> str:
    return identity.id


def current_user(identity: Identity = Depends(current_identity)) -> dict:
    """The caller's users document. The first authenticated call creates it."""
    user = users.get(identity.id)
    if user is None:
        user = users.get_or_create(identity.id, **fetch_profile(identity))
    return user
