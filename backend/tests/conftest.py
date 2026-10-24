"""Shared test helpers: a fake Auth0 tenant (local RSA key, no network)."""
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app import auth, ratelimit

DOMAIN = "test-tenant.us.auth0.com"
AUDIENCE = "https://api.hikingpsu"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _FakeJWKS:
    def get_signing_key_from_jwt(self, token):
        return type("SigningKey", (), {"key": KEY.public_key()})()


def make_token(sub="auth0|alice", key=KEY, **overrides) -> str:
    now = int(time.time())
    claims = {"sub": sub, "aud": AUDIENCE, "iss": f"https://{DOMAIN}/", "iat": now, "exp": now + 3600}
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm="RS256")


def bearer(sub="auth0|alice", **overrides) -> dict:
    return {"Authorization": f"Bearer {make_token(sub, **overrides)}"}


@pytest.fixture
def fake_auth0(monkeypatch):
    """Login configured; tokens from make_token() verify; /userinfo answers with an email from the sub."""
    monkeypatch.setenv("AUTH0_DOMAIN", DOMAIN)
    monkeypatch.setenv("AUTH0_AUDIENCE", AUDIENCE)
    monkeypatch.setattr(auth, "_jwks_client", lambda domain: _FakeJWKS())
    monkeypatch.setattr(
        auth, "fetch_profile",
        lambda identity: {"email": identity.id.split("|", 1)[1] + "@psu.edu", "name": identity.id.split("|", 1)[1].title()},
    )


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    """Every test starts with empty /chat counters."""
    ratelimit.reset()
    yield
    ratelimit.reset()
