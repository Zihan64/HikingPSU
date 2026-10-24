"""Exercise the demo through the same HTTP contract used by the frontend."""
from fastapi.testclient import TestClient
import pytest

from app.main import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    with TestClient(app) as session:
        yield session


def test_health_and_trail_details(client):
    health = client.get("/health")
    assert health.status_code == 200
    trails = client.get("/trails").json()
    assert health.json()["trails"] == len(trails) >= 12
    assert "Mount Nittany –" in client.get("/trails/mt-nittany-mike-lynch").json()["name"]
    assert client.get("/trails/missing").status_code == 404


def test_filters(client):
    response = client.get("/trails", params={"car_free": True, "max_level": 2, "max_time_min": 60})
    assert response.status_code == 200
    trails = response.json()
    assert trails
    assert all(t["car_free"] and t["difficulty"]["level"] <= 2
               and t["difficulty"]["est_time_min"] <= 60 for t in trails)
    assert trails[0]["id"] == "arboretum-hartley-wood"


def test_demo_honors_car_checkbox(client):
    response = client.post("/chat", json={
        "messages": [{"role": "user", "content": "Something easy for a first-time hiker"}],
        "profile": {"has_car": False},
    })
    assert response.status_code == 200
    data = response.json()
    assert data["recommended_ids"] == [t["id"] for t in data["trails"]]
    assert data["trails"]
    assert all(t["car_free"] and t["difficulty"]["level"] <= 2 for t in data["trails"])
    assert "offline demo mode" in data["reply"]


def test_demo_hard_hike_and_easier_followup(client):
    messages = [{"role": "user", "content": "I have a car, want something hard with rocks on Sunday"}]
    hard = client.post("/chat", json={"messages": messages, "profile": {"has_car": False}}).json()
    assert hard["trails"]
    assert all(t["difficulty"]["level"] >= 4 for t in hard["trails"])
    messages += [{"role": "assistant", "content": hard["reply"]},
                 {"role": "user", "content": "Something easier — my friend hasn't hiked before."}]
    easy = client.post("/chat", json={"messages": messages}).json()
    assert easy["trails"]
    assert all(t["difficulty"]["level"] <= 2 for t in easy["trails"])


def test_demo_remembers_no_car_on_followup(client):
    response = client.post("/chat", json={"messages": [
        {"role": "user", "content": "No car, about three hours"},
        {"role": "assistant", "content": "Try a nearby hike."},
        {"role": "user", "content": "Something easier"},
    ]})
    assert response.status_code == 200
    assert response.json()["trails"]
    assert all(t["car_free"] for t in response.json()["trails"])


def test_demo_no_matches_and_empty_messages(client, monkeypatch):
    monkeypatch.setattr("app.agent.store.search", lambda **kwargs: [])
    response = client.post("/chat", json={
        "messages": [{"role": "user", "content": "A hard hike, no car"}],
    })
    assert response.status_code == 200
    assert response.json()["trails"] == []
    assert "No trails match" in response.json()["reply"]
    assert client.post("/chat", json={"messages": []}).status_code == 400
