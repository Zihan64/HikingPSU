"""Abuse limits on /chat: message length, rate limits, history trimming, scope prompt."""
from fastapi.testclient import TestClient
import pytest

from app import agent, main
from app.main import app
from app.models import ChatMessage

from .conftest import bearer


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    with TestClient(app) as session:
        yield session


def ask(client, text="easy hike", **kw):
    return client.post("/chat", json={"messages": [{"role": "user", "content": text}]}, **kw)


def test_long_message_is_rejected_before_the_model(client, monkeypatch):
    monkeypatch.setattr(agent, "run", lambda *a, **k: pytest.fail("model must not be called"))
    r = ask(client, "x" * 501)
    assert r.status_code == 413 and "too long" in r.json()["detail"]


def test_message_at_the_limit_is_allowed(client):
    assert ask(client, "x" * 500).status_code == 200


def test_last_message_must_be_from_user(client):
    r = client.post("/chat", json={"messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]})
    assert r.status_code == 400


def test_too_many_history_messages_is_rejected(client):
    msgs = [{"role": "user" if i % 2 == 0 else "assistant", "content": "hi"} for i in range(61)]
    assert client.post("/chat", json={"messages": msgs}).status_code == 422


def test_anonymous_rate_limit_per_minute(client, monkeypatch):
    monkeypatch.setenv("CHAT_LIMIT_ANON_PER_MIN", "3")
    assert [ask(client).status_code for _ in range(3)] == [200, 200, 200]
    r = ask(client)
    assert r.status_code == 429 and "too fast" in r.json()["detail"]


def test_limits_are_per_caller(client, monkeypatch):
    monkeypatch.setenv("CHAT_LIMIT_ANON_PER_MIN", "1")
    assert ask(client, headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
    assert ask(client, headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 429
    assert ask(client, headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 200


def test_signed_in_users_get_their_own_daily_limit(client, monkeypatch, fake_auth0):
    monkeypatch.setenv("CHAT_LIMIT_USER_PER_DAY", "2")
    monkeypatch.setattr(main, "_stored_profile", lambda uid: {})
    monkeypatch.setattr(main.chats, "record_exchange", lambda *a, **k: None)
    alice = bearer("auth0|alice")
    assert [ask(client, headers=alice).status_code for _ in range(2)] == [200, 200]
    r = ask(client, headers=alice)
    assert r.status_code == 429 and "Daily" in r.json()["detail"]
    assert ask(client, headers=bearer("auth0|bob")).status_code == 200


def test_history_is_trimmed_and_starts_with_user():
    msgs = [ChatMessage(role="user" if i % 2 == 0 else "assistant", content=str(i)) for i in range(15)]
    recent = main._recent(msgs)
    assert len(recent) <= main.HISTORY_MESSAGES
    assert recent[0].role == "user" and recent[-1].content == "14"


def test_system_prompt_limits_scope():
    assert "Only help with hiking" in agent.SYSTEM
    assert "politely decline" in agent.SYSTEM
