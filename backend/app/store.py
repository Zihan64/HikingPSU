"""Trail data access. JSON for the hackathon; swap for a DB later without touching callers."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .difficulty import rate
from .models import Trail, TrailWithDifficulty

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "trails.json"
OSM_PATH = DATA_PATH.with_name("trails_osm.json")
PARKS_PATH = DATA_PATH.with_name('parks.json')
GEOMETRY_PATH = DATA_PATH.with_name('trail_geometry.json')


@lru_cache(maxsize=1)
def load_parks() -> list[dict]:
    return json.loads(PARKS_PATH.read_text(encoding='utf-8'))


@lru_cache(maxsize=1)
def load_geometry() -> dict:
    return json.loads(GEOMETRY_PATH.read_text(encoding='utf-8')) if GEOMETRY_PATH.exists() else {}


# The model asks for "view"; the data says "overlook" / "ridge views" / "7 overlooks".
# Each requested word expands to keywords that are substring-matched against trail features.
FEATURE_SYNONYMS: dict[str, list[str]] = {
    "view": ["view", "overlook", "vista"],
    "views": ["view", "overlook", "vista"],
    "overlook": ["overlook", "view", "vista"],
    "scenic": ["view", "overlook", "vista", "lake"],
    "sunset": ["sunset"],
    "sunrise": ["overlook", "view"],
    "lake": ["lake"],
    "water": ["lake", "stream", "marsh"],
    "swim": ["swim", "lake"],
    "stream": ["stream"],
    "creek": ["stream"],
    "flat": ["flat", "boardwalk"],
    "easy": ["flat", "boardwalk"],
    "forest": ["forest", "shade", "laurel", "woods"],
    "woods": ["forest", "shade", "laurel", "woods"],
    "shade": ["shade", "forest"],
    "birds": ["bird"],
    "wildlife": ["bird", "marsh"],
    "rocks": ["rock"],
    "rocky": ["rock"],
    "challenging": ["steep", "rock", "ridge"],
    "steep": ["steep"],
    "campus": ["campus", "close to downtown", "no car"],
    "no car": ["no car", "campus", "close to downtown"],
}


def _expand(feature: str) -> list[str]:
    f = feature.strip().lower()
    return FEATURE_SYNONYMS.get(f, [f])


def feature_matches(trail: Trail, feature: str) -> bool:
    haystack = [x.lower() for x in trail.features]
    return any(kw in h for kw in _expand(feature) for h in haystack)


def _is_car_free(trail: Trail) -> bool:
    a = trail.access
    return bool(a.bus) or (a.walk_from_campus_min is not None and a.walk_from_campus_min <= 60)


@lru_cache(maxsize=1)
def load_all() -> list[TrailWithDifficulty]:
    raw = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    if OSM_PATH.exists():  # imported by scripts/fetch_osm_trails.py; curated ids win on clashes
        known = {r["id"] for r in raw}
        raw += [r for r in json.loads(OSM_PATH.read_text(encoding="utf-8")) if r["id"] not in known]
    out = []
    parks = {trail_id: p for p in load_parks() for trail_id in p['trail_ids']}
    for item in raw:
        t = Trail(**item)
        park = parks.get(t.id, {'id':'other-nearby-trails', 'name':'Other nearby trails'})
        out.append(TrailWithDifficulty(**t.model_dump(), difficulty=rate(t), car_free=_is_car_free(t),
                                       park_id=park['id'], park_name=park['name']))
    return out


def get(trail_id: str) -> TrailWithDifficulty | None:
    return next((t for t in load_all() if t.id == trail_id), None)


def search(
    max_level: int | None = None,
    min_level: int | None = None,
    max_time_min: int | None = None,
    car_free: bool | None = None,
    features: list[str] | None = None,
    max_drive_min: int | None = None,
    limit: int = 5,
) -> list[TrailWithDifficulty]:
    results = load_all()
    if max_level is not None:
        results = [t for t in results if t.difficulty.level <= max_level]
    if min_level is not None:
        results = [t for t in results if t.difficulty.level >= min_level]
    if max_time_min is not None:
        results = [t for t in results if t.difficulty.est_time_min <= max_time_min]
    if car_free:
        results = [t for t in results if t.car_free]
    if max_drive_min is not None:
        results = [t for t in results if t.access.drive_min is not None and t.access.drive_min <= max_drive_min]
    if features:
        # A trail matches if it matches ANY requested feature (so "view" OR "sunset").
        results = [t for t in results if any(feature_matches(t, f) for f in features)]
    # prefer verified data, then shorter drives
    results.sort(key=lambda t: (not t.verified, t.access.drive_min if t.access.drive_min is not None else 999))
    return results[:limit]
