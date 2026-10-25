"""Trail medals, derived on the fly from what a hiker has already recorded (nothing new is stored).

A trail counts as finished when the hiker logged a hike on it or reviewed it ("I finished this
trail"). Rules that keep medals meaningful:
  * each trail counts once, however often it is repeated;
  * harder trails also count toward the easier medals;
  * at most MAX_DAY_MIN minutes of estimated hiking count per calendar day (no logging 20 trails at once);
  * the two honour medals only count hard trails the hiker has also reviewed.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Callable

from . import likes, store
from .db import get_db
from .user_models import BadgeOut, BadgesOut

MAX_DAY_MIN = 14 * 60


@dataclass(frozen=True)
class Medal:
    id: str
    name: str
    tagline: str
    how: str            # how to earn it, shown on locked medals
    rank: int           # higher shows first next to a hiker's name
    goal: Callable[[], int]
    metric: str         # key into the progress counters


def _count_level(min_level: int) -> int:
    return sum(1 for t in store.load_all() if t.difficulty.level >= min_level)


def _park_ids() -> set[str]:
    return {p["id"] for p in store.load_parks() if p.get("kind") != "unverified"}


MEDALS: list[Medal] = [
    Medal("trailhead", "Trailhead", "Your first trail in Happy Valley", "Finish any trail.", 10, lambda: 1, "trails"),
    Medal("valley-walker", "Valley Walker", "Five different trails walked", "Finish 5 different trails.", 20, lambda: 5, "trails"),
    Medal("ridge-walker", "Ridge Walker", "Three moderate climbs or harder", "Finish 3 different trails rated L3 or harder.", 40, lambda: 3, "l3"),
    Medal("summit", "Summit", "Your first hard trail", "Finish a trail rated L4 or L5.", 60, lambda: 1, "l4"),
    Medal("seven-mountains", "Seven Mountains", "Honour medal · five hard trails", "Finish and review 5 different L4–L5 trails.", 80,
          lambda: min(5, _count_level(4)), "l4_reviewed"),
    Medal("allegheny-front", "Allegheny Front", "Legend · every Very Hard trail", "Finish and review every L5 trail.", 100,
          lambda: max(1, _count_level(5)), "l5_reviewed"),
    Medal("explorer", "Happy Valley Explorer", "Trails in three parks", "Finish trails in 3 different parks or forests.", 30,
          lambda: 3, "parks"),
    Medal("car-free", "Car-free", "Three trails without a car", "Finish 3 trails you can reach by bus, bike or on foot.", 25,
          lambda: 3, "car_free"),
    Medal("four-seasons", "Four Seasons", "Out in every season", "Finish a trail in spring, summer, fall and winter.", 50,
          lambda: 4, "seasons"),
    Medal("trail-guide", "Trail Guide", "Your tips earned five hearts", "Get 5 hearts on your trail reviews.", 35, lambda: 5, "hearts"),
]
BY_ID = {m.id: m for m in MEDALS}


def _season(d: dt.date) -> str:
    return {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
            6: "summer", 7: "summer", 8: "summer"}.get(d.month, "fall")


def _as_date(value) -> dt.date:
    return value.date() if isinstance(value, dt.datetime) else value


def _finishes(user_id) -> tuple[list[tuple[dt.date, str]], set[str], list[str]]:
    """(date, trail_id) finishes oldest first, reviewed trail ids, and the review ids (for hearts)."""
    db = get_db()
    rows = [(_as_date(h["completed_on"]), h["trail_id"]) for h in db.hike_logs.find({"user_id": user_id}, {"completed_on": 1, "trail_id": 1})]
    reviewed, review_ids = set(), []
    for r in db.reviews.find({"user_id": user_id}, {"trail_id": 1, "created_at": 1, "comment": 1}):
        reviewed.add(r["trail_id"])
        rows.append((_as_date(r["created_at"]), r["trail_id"]))
        if r.get("comment"):
            review_ids.append(str(r["_id"]))
    rows.sort()
    return rows, reviewed, review_ids


def compute(user_id) -> BadgesOut:
    """Every medal with progress, and the date each earned medal was reached."""
    rows, reviewed, review_ids = _finishes(user_id)
    parks = _park_ids()
    counted: set[str] = set()
    day_minutes: dict[dt.date, int] = {}
    seasons: set[str] = set()
    progress = {k: 0 for k in ("trails", "l3", "l4", "l4_reviewed", "l5_reviewed", "parks", "car_free", "seasons", "hearts")}
    park_seen: set[str] = set()
    earned_on: dict[str, dt.date] = {}
    goals = {m.id: m.goal() for m in MEDALS}

    def check(day: dt.date | None) -> None:
        for m in MEDALS:
            if m.id not in earned_on and progress[m.metric] >= goals[m.id]:
                earned_on[m.id] = day

    for day, trail_id in rows:
        trail = store.get(trail_id)
        if trail is None:
            continue
        est = trail.difficulty.est_time_min
        if day_minutes.get(day, 0) + est > MAX_DAY_MIN:
            continue  # more hiking than one day holds: ignore the extra entries
        day_minutes[day] = day_minutes.get(day, 0) + est
        seasons.add(_season(day))
        progress["seasons"] = len(seasons)
        if trail_id not in counted:
            counted.add(trail_id)
            level = trail.difficulty.level
            progress["trails"] += 1
            progress["l3"] += level >= 3
            progress["l4"] += level >= 4
            progress["l4_reviewed"] += level >= 4 and trail_id in reviewed
            progress["l5_reviewed"] += level >= 5 and trail_id in reviewed
            progress["car_free"] += bool(trail.car_free)
            if trail.park_id in parks:
                park_seen.add(trail.park_id)
                progress["parks"] = len(park_seen)
        check(day)

    progress["hearts"] = sum(likes.counts(review_ids).values()) if review_ids else 0
    check(None)  # hearts have no single date

    out = [
        BadgeOut(id=m.id, name=m.name, tagline=m.tagline, how=m.how, rank=m.rank,
                 progress=min(progress[m.metric], goals[m.id]), goal=goals[m.id],
                 earned=m.id in earned_on, earned_on=earned_on.get(m.id))
        for m in MEDALS
    ]
    top = max((b for b in out if b.earned), key=lambda b: b.rank, default=None)
    return BadgesOut(badges=out, top=top.id if top else None, earned=sum(b.earned for b in out))


def top_for(user_ids: list) -> dict[str, str | None]:
    """The highest medal of each hiker, for the name chips on the Community feed."""
    result = {}
    for uid in {u for u in user_ids if u is not None}:
        try:
            result[str(uid)] = compute(uid).top
        except Exception:  # a medal is decoration; never break the feed over it
            result[str(uid)] = None
    return result
