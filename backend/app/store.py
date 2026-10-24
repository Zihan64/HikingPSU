"""Trail data access. JSON for the hackathon; swap for a DB later without touching callers."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .difficulty import rate
from .models import Trail, TrailWithDifficulty

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "trails.json"


def _is_car_free(trail: Trail) -> bool:
    a = trail.access
    return bool(a.bus) or (a.walk_from_campus_min is not None and a.walk_from_campus_min <= 60)


@lru_cache(maxsize=1)
def load_all() -> list[TrailWithDifficulty]:
    raw = json.loads(DATA_PATH.read_text())
    out = []
    for item in raw:
        t = Trail(**item)
        out.append(TrailWithDifficulty(**t.model_dump(), difficulty=rate(t), car_free=_is_car_free(t)))
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
        wanted = {f.lower() for f in features}
        results = [t for t in results if wanted & {f.lower() for f in t.features}]
    # prefer verified data, then shorter drives
    results.sort(key=lambda t: (not t.verified, t.access.drive_min or 999))
    return results[:limit]
