"""Auth0 token verification. Local RSA key, no network."""
import time

import mongomock
import pytest

from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import auth, db
from app.main import app

from tests.conftest import DOMAIN, bearer, make_token


@pytest.fixture
def client(fake_auth0):
    db.set_client(mongomock.MongoClient())
    yield TestClient(app)
    db.set_client(None)


def test_valid_token(client):
    assert client.get("/me", headers=bearer()).status_code == 200


@pytest.mark.parametrize("overrides", [
    {"aud": "https://someone-else"},
    {"iss": "https://evil.example/"},
    {"exp": int(time.time()) - 10},
])
def test_rejected_claims(client, overrides):
    assert client.get("/me", headers=bearer(**overrides)).status_code == 401


def test_token_signed_by_another_key(client):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged = make_token(key=other)
    assert client.get("/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_hs256_token_is_rejected(client):
    import jwt
    hs = jwt.encode({"sub": "auth0|x", "aud": "https://api.hikingpsu", "iss": f"https://{DOMAIN}/",
                     "exp": int(time.time()) + 60}, "x" * 32, algorithm="HS256")
    assert client.get("/me", headers={"Authorization": f"Bearer {hs}"}).status_code == 401


def test_auth_config_endpoint(client):
    assert client.get("/auth/config").json() == {"enabled": True}


def test_not_configured(monkeypatch, client):
    monkeypatch.setenv("DEMO_MODE", "1")  # keep /chat offline
    monkeypatch.delenv("AUTH0_DOMAIN")
    assert client.get("/auth/config").json() == {"enabled": False}
    assert client.get("/me", headers=bearer()).status_code == 503
    # public routes ignore tokens when login isn't configured
    r = client.post("/chat", headers=bearer(), json={"messages": [{"role": "user", "content": "easy"}]})
    assert r.status_code == 200 and r.json()["session_id"] is None


def test_public_routes_need_no_login(client):
    assert client.get("/trails").status_code == 200
    assert client.get("/health").status_code == 200
