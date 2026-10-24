from collections import Counter
import math
from fastapi.testclient import TestClient
from app.main import app
from app import store

client = TestClient(app)


def test_park_index_covers_each_trail_exactly_once_with_no_unknown_ids():
    ids = [t.id for t in store.load_all()]
    assignments = [i for park in store.load_parks() for i in park['trail_ids']]
    assert Counter(assignments) == Counter(ids)
    assert all(count == 1 for count in Counter(assignments).values())
    assert all(set(p['evidence']) == set(p['trail_ids']) for p in store.load_parks())


def test_park_counts_and_trail_fields_agree():
    trails = client.get('/trails').json()
    response = client.get('/parks')
    assert response.status_code == 200
    parks = response.json()
    assert sum(p['trail_count'] for p in parks) == len(trails)
    assert parks[-1]['kind'] == 'unverified'
    for park in parks:
        members = [t for t in trails if t['park_id'] == park['id']]
        assert park['trail_count'] == len(members)
        assert all(t['park_name'] == park['name'] for t in members)
    assert all(t['park_id'] for t in trails)
    assert all('line' not in t and 'profile' not in t for t in trails)


def test_geometry_not_found_and_unknown_trail_are_explicit():
    assert client.get('/trails/not-a-trail/geometry').status_code == 404
    assert client.get('/trails/mt-nittany-mike-lynch/geometry').status_code == 404


def test_geometry_endpoint_returns_stored_data_without_network(monkeypatch):
    payload = {'source':'osm', 'osm_relation':123, 'lines':[[[-77.8,40.8],[-77.81,40.81]]], 'profile':[]}
    monkeypatch.setattr(store, 'load_geometry', lambda:{'musser-gap':payload})
    response = client.get('/trails/musser-gap/geometry')
    assert response.status_code == 200
    assert response.json() == payload


def test_committed_geometries_are_bounded_real_lines_with_ordered_profiles():
    known_ids = {t.id for t in store.load_all()}
    for trail_id, entry in store.load_geometry().items():
        assert trail_id in known_ids
        assert entry['source'] == 'osm' and isinstance(entry['osm_relation'], int)
        lines = entry.get('lines') or [entry['line']]
        assert sum(len(line) for line in lines) <= 300
        for line in lines:
            assert len(line) >= 2
            assert all(len(p) == 2 and all(math.isfinite(v) for v in p) and abs(p[0]) <= 180 and abs(p[1]) <= 90 for p in line)
        profile = entry['profile']
        assert not profile or len(lines) == 1
        assert all(all(math.isfinite(v) for v in p) for p in profile)
        assert all(a[0] < b[0] for a, b in zip(profile,profile[1:]))
