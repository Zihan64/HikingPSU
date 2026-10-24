"""Official-source contract, permissions and failure handling; no network needed."""
from copy import deepcopy
from contextlib import contextmanager
import json

from fastapi import HTTPException
from fastapi.testclient import TestClient
import httpx
import pytest

from app import official
from app.main import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    with TestClient(app) as session:
        yield session


def feature(name="Whipple Lake", hiking="Permitted", cycling="Prohibited", **props):
    # Synthetic coordinates; not a downloaded trail file.
    return {"type": "Feature", "properties": {
        "Name": name, "Park_ForestName": "Whipple Dam State Park", "VisiblePublic": "Yes",
        "Ownership": "PA State Park", "Hiking": hiking, "Bicycle": cycling,
        "MtnBike": cycling, "BlazeColor": "Yellow", **props},
        "geometry": {"type": "LineString", "coordinates": [[-77, 40], [-76.999, 40]]}}


@pytest.fixture
def upstream(monkeypatch):
    parts = [feature(), feature("Whipple Lake (On Beidler Rd.)", cycling="Permitted"),
             feature("Whipple Lake (On Park Roads)", cycling="Permitted"),
             feature("Separate Cycle Trail", cycling="Permitted")]
    calls = []
    def fetch(params):
        calls.append(params)
        return {"type": "FeatureCollection", "features": deepcopy(parts)}
    monkeypatch.setattr(official, "_fetch", fetch)
    return parts, calls


def test_library_search_pdf_and_activity(client):
    response = client.get("/official/library", params={"q": "Musser Gap PDF"})
    assert response.status_code == 200
    areas = response.json()["areas"]
    assert [a["id"] for a in areas] == ["rothrock"]
    assert all(r["kind"] == "pdf" and r["url"].startswith("https://elibrary.dcnr.pa.gov/")
               for r in areas[0]["resources"])
    assert len(areas[0]["resources"]) == 1
    assert "MusserGap.pdf" in areas[0]["resources"][0]["url"]
    assert client.get("/official/library", params={"q": "Mount Nittany", "activity": "cycling"}).json()["areas"] == []
    assert client.get("/official/library", params={"q": "unindexed-national-park"}).json()["areas"] == []
    assert client.get("/official/library", params={"activity": "motorcycle"}).status_code == 422


def test_offline_chat_returns_original_pdf_links_without_a_made_up_itinerary(client):
    result = client.post("/chat", json={"messages": [{"role": "user", "content": "Please give me the Whipple offline map PDF"}]}).json()
    assert "https://elibrary.dcnr.pa.gov/GetDocument?DocName=WHIP_ParkMap.pdf&docId=1737196" in result["reply"]
    assert result["recommended_ids"] == []
    assert result["trails"] == []
    unknown = client.post("/chat", json={"messages": [{"role": "user", "content": "Yosemite official map PDF"}]}).json()
    assert "No indexed area" in unknown["reply"]
    assert "https://" not in unknown["reply"]


def test_whole_route_permissions_are_checked_before_activity_filtering(client, upstream):
    _, calls = upstream
    hiking = client.get("/official/trails", params={"area_id": "whipple-dam"})
    assert hiking.status_code == 200
    assert hiking.headers["cache-control"] == "no-store"
    loop = next(r for r in hiking.json()["trails"] if r["name"] == "Whipple Lake")
    assert loop["segment_count"] == 3
    cycling = client.get("/official/trails", params={"area_id": "whipple-dam", "activity": "cycling"})
    assert [r["name"] for r in cycling.json()["trails"]] == ["Separate Cycle Trail"]
    assert calls[0]["returnGeometry"] == "false"
    assert calls[0]["where"] == "Park_ForestName = 'Whipple Dam State Park'"
    # Even a known hiking ID cannot be used to bypass activity permissions.
    assert client.get(f"/official/trails/whipple-dam/{loop['id']}/geometry?activity=cycling").status_code == 404


def test_unknown_permissions_exclude_the_entire_named_route(client, upstream):
    parts, _ = upstream
    parts[0]["properties"]["Hiking"] = "Unknown"
    result = client.get("/official/trails?area_id=whipple-dam").json()["trails"]
    assert "Whipple Lake" not in [r["name"] for r in result]


def test_nonpublic_private_and_other_areas_cannot_be_returned(client, upstream):
    parts, _ = upstream
    parts.extend([feature("Private", Ownership="Private"), feature("Hidden", VisiblePublic="No"),
                  feature("Other Park", Park_ForestName="Another Park")])
    names = [r["name"] for r in client.get("/official/trails?area_id=whipple-dam").json()["trails"]]
    assert not {"Private", "Hidden", "Other Park"}.intersection(names)


@pytest.mark.parametrize("restriction", [{"Ownership": "Private"}, {"VisiblePublic": "No"}])
def test_a_restricted_part_cannot_leave_a_partial_named_loop(client, upstream, restriction):
    parts, _ = upstream
    parts[1]["properties"].update(restriction)
    names = [r["name"] for r in client.get("/official/trails?area_id=whipple-dam").json()["trails"]]
    assert names == ["Separate Cycle Trail"]


def test_geometry_is_original_source_lines_with_provenance_and_no_cache(client, upstream):
    parts, calls = upstream
    route = next(r for r in client.get("/official/trails?area_id=whipple-dam").json()["trails"] if r["name"] == "Whipple Lake")
    result = client.get(f"/official/trails/whipple-dam/{route['id']}/geometry")
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    data = result.json()
    assert data["geojson"]["features"] == parts[:3]
    assert data["route"]["source_url"] == official.GIS_LAYER
    assert "planning" in data["source_notice"].lower()
    assert data["retrieved_at"]
    assert calls[-1]["returnGeometry"] == "true"
    assert calls[-1]["outSR"] == 4326


@pytest.mark.parametrize("bad_geometry", [
    {"type": "Point", "coordinates": [-77, 40]},
    {"type": "LineString", "coordinates": [[-77, 40]]},
    {"type": "LineString", "coordinates": [[-77, 40], [-181, 40]]},
    {"type": "MultiLineString", "coordinates": [[[True, 40], [-77, 40]]]},
    None,
])
def test_invalid_geometry_never_reaches_map(client, upstream, bad_geometry):
    parts, _ = upstream
    parts[0]["geometry"] = bad_geometry
    route = next(r for r in client.get("/official/trails?area_id=whipple-dam").json()["trails"] if r["name"] == "Whipple Lake")
    assert client.get(f"/official/trails/whipple-dam/{route['id']}/geometry").status_code == 502


def test_missing_or_links_only_area_does_not_fetch_or_invent_geometry(client, upstream):
    _, calls = upstream
    assert client.get("/official/trails?area_id=https://example.com").status_code == 404
    assert client.get("/official/trails?area_id=rothrock").status_code == 409
    assert client.get("/official/trails/mount-nittany/anything/geometry").status_code == 409
    assert calls == []


def test_changed_upstream_schema_fails_with_a_link_fallback_instead_of_a_500(client, upstream):
    parts, _ = upstream
    parts[0]["properties"]["Name"] = ["unexpected", "schema"]
    response = client.get("/official/trails?area_id=whipple-dam")
    assert response.status_code == 502
    assert "original manager map links" in response.json()["detail"]


@pytest.mark.parametrize("payload", [[], {"error": {"message": "unavailable"}},
    {"type": "FeatureCollection", "features": [], "exceededTransferLimit": True},
    {"type": "FeatureCollection", "features": [], "properties": {"exceededTransferLimit": True}},
    {"type": "FeatureCollection", "features": "invalid"}])
def test_upstream_errors_and_truncation_are_explicit_not_partial_results(monkeypatch, payload):
    @contextmanager
    def stream(*args, **kwargs):
        assert args[1] == official.GIS_LAYER + "/query"
        assert kwargs["follow_redirects"] is False
        yield httpx.Response(200, content=json.dumps(payload).encode(), request=httpx.Request("GET", args[1]))
    monkeypatch.setattr(httpx, "stream", stream)
    with pytest.raises(HTTPException) as exc:
        official._fetch({"where": "fixed-query"})
    assert exc.value.status_code == 502


def test_unavailable_gis_does_not_hide_official_resource_links(client, monkeypatch):
    def fail(*args, **kwargs):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(httpx, "stream", fail)
    assert client.get("/official/trails?area_id=whipple-dam").status_code == 502
    assert client.get("/official/library?q=Whipple").json()["areas"][0]["resources"]
