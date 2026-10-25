"""Badges, earned only through verified check-ins (checkins.py); manual hike-log entries don't count.

bronze    trail:<trail_id>     first completion of a trail
silver    park:<park_id>       every trail of a park completed ("Other nearby trails" has no park badge)
gold      milestone:10         10 distinct trails
platinum  milestone:30         30 distinct trails
special   repeat:<trail_id>    the same trail completed 5 times

Badges are permanent: once earned they stay, even if a park later gains trails. award() recomputes
everything from the completed check-ins, so it is idempotent and repairs anything a crash skipped.
"""
from __future__ import annotations

from collections import Counter

from pymongo import DESCENDING
from pymongo.errors import DuplicateKeyError

from . import checkins, store
from .db import get_db
from .user_models import BadgeBoard, BadgeOut, MilestoneProgress, ParkProgress, RepeatProgress

MILESTONES = (10, 30)
REPEAT_AT = 5
MILESTONE_INFO = {
    10: ("gold", "Trailblazer", "Completed 10 different trails"),
    30: ("platinum", "Happy Valley Legend", "Completed 30 different trails"),
}


def parks() -> list[dict]:
    """Parks that can be completed: verified areas only, each with the trails we actually list."""
    known = {t.id for t in store.load_all()}
    out = []
    for p in store.load_parks():
        trail_ids = [t for t in p["trail_ids"] if t in known]
        if p.get("kind") != "unverified" and trail_ids:
            out.append({**p, "trail_ids": trail_ids})
    return out


def _trail_name(trail_id: str, fallback: str | None = None) -> str:
    t = store.get(trail_id)
    return t.name if t else (fallback or trail_id)


def due(completed: list[str]) -> list[dict]:
    """Every badge these completions earn, in display order: trails, repeats, parks, milestones."""
    counts = Counter(completed)
    done = set(counts)
    out = [{"key": f"trail:{t}", "kind": "trail", "target_id": t} for t in dict.fromkeys(completed)]
    out += [{"key": f"repeat:{t}", "kind": "repeat", "target_id": t} for t, n in counts.items() if n >= REPEAT_AT]
    out += [{"key": f"park:{p['id']}", "kind": "park", "target_id": p["id"]} for p in parks() if done >= set(p["trail_ids"])]
    out += [{"key": f"milestone:{m}", "kind": "milestone", "target_id": None} for m in MILESTONES if len(done) >= m]
    return out


def award(user_id: str) -> list[dict]:
    """Insert badges the user has earned but doesn't have yet. Returns only the new ones."""
    have = {d["key"] for d in get_db().badges.find({"user_id": user_id}, {"key": 1})}
    new = []
    for b in due(checkins.completed_trail_ids(user_id)):
        if b["key"] in have:
            continue
        doc = {**b, "user_id": user_id, "awarded_at": checkins.now(), "name": _snapshot_name(b)}
        try:
            get_db().badges.insert_one(doc)
        except DuplicateKeyError:  # awarded concurrently
            continue
        new.append(doc)
    return new


def _snapshot_name(b: dict) -> str | None:
    """The trail or park name at award time, in case it later disappears from the data."""
    if b["kind"] in ("trail", "repeat"):
        return _trail_name(b["target_id"])
    if b["kind"] == "park":
        return next((p["name"] for p in store.load_parks() if p["id"] == b["target_id"]), None)
    return None


def to_out(doc: dict) -> BadgeOut:
    kind, target = doc["kind"], doc.get("target_id")
    if kind == "trail":
        name = _trail_name(target, doc.get("name"))
        tier, title, description = "bronze", name, f"Completed {name}"
    elif kind == "repeat":
        name = _trail_name(target, doc.get("name"))
        tier, title, description = "special", f"{name} Regular", f"Completed {name} {REPEAT_AT} times"
    elif kind == "park":
        park = next((p for p in parks() if p["id"] == target), None)
        name = park["name"] if park else doc.get("name") or target
        total = len(park["trail_ids"]) if park else None
        tier, title = "silver", f"{name} Complete"
        description = (f"Completed the only trail in {name}" if total == 1
                       else f"Completed all {total} trails in {name}" if total else f"Completed every trail in {name}")
    else:
        count = int(doc["key"].split(":", 1)[1])
        tier, title, description = MILESTONE_INFO.get(count, ("gold", f"{count} Trails", f"Completed {count} different trails"))
    return BadgeOut(key=doc["key"], kind=kind, tier=tier, title=title, description=description,
                    target_id=target, awarded_at=checkins.utc(doc["awarded_at"]))


def board(user_id: str) -> BadgeBoard:
    docs = list(get_db().badges.find({"user_id": user_id}).sort([("awarded_at", DESCENDING), ("key", 1)]))
    keys = {d["key"] for d in docs}
    completed = checkins.completed_trail_ids(user_id)
    counts = Counter(completed)
    done = set(counts)
    return BadgeBoard(
        badges=[to_out(d) for d in docs],
        completed_trails=len(done),
        total_trails=len(store.load_all()),
        milestones=[MilestoneProgress(count=m, earned=f"milestone:{m}" in keys) for m in MILESTONES],
        parks=[
            ParkProgress(park_id=p["id"], name=p["name"], completed=len(done & set(p["trail_ids"])),
                         total=len(p["trail_ids"]), earned=f"park:{p['id']}" in keys)
            for p in parks()
        ],
        repeats=[RepeatProgress(trail_id=t, trail_name=_trail_name(t), count=n)
                 for t, n in counts.most_common() if n >= 2],
        today_remaining=checkins.today_remaining(user_id),
    )


def delete_all(user_id: str) -> int:
    return get_db().badges.delete_many({"user_id": user_id}).deleted_count
