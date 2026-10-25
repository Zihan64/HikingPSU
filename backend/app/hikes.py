"""hike_logs collection: one document per completed hike (a user may repeat a trail)."""
from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict

from pymongo import DESCENDING, ReturnDocument

from . import store
from .db import get_db, to_oid
from .user_models import Count, HikeOut, HikeStats, Insights


def _to_dt(d: dt.date) -> dt.datetime:
    return dt.datetime.combine(d, dt.time.min)  # BSON stores datetimes, not dates


def add(user_id: str, trail_id: str, completed_on: dt.date, **fields) -> dict:
    trail = store.get(trail_id)
    if trail is None:
        raise KeyError(trail_id)
    now = dt.datetime.now(dt.timezone.utc)
    doc = {
        "user_id": user_id,
        "trail_id": trail_id,
        "trail_name": trail.name,  # denormalized so history survives trail renames/removals
        "completed_on": _to_dt(completed_on),
        **fields,
        "created_at": now,
        "updated_at": now,
    }
    doc["_id"] = get_db().hike_logs.insert_one(doc).inserted_id
    return doc


def for_checkin(user_id: str, checkin_id: str) -> dict | None:
    """The entry a trailhead check-in wrote when it was finished, if any."""
    return get_db().hike_logs.find_one({"user_id": user_id, "checkin_id": checkin_id})


def list_for(user_id: str, limit: int = 100, skip: int = 0) -> list[dict]:
    cur = get_db().hike_logs.find({"user_id": user_id}).sort("completed_on", DESCENDING).skip(skip).limit(limit)
    return list(cur)


def update(user_id: str, hike_id: str, changes: dict) -> dict | None:
    oid = to_oid(hike_id)
    if oid is None:
        return None
    if "completed_on" in changes and changes["completed_on"] is not None:
        changes["completed_on"] = _to_dt(changes["completed_on"])
    changes["updated_at"] = dt.datetime.now(dt.timezone.utc)
    return get_db().hike_logs.find_one_and_update(
        {"_id": oid, "user_id": user_id}, {"$set": changes}, return_document=ReturnDocument.AFTER
    )


def delete(user_id: str, hike_id: str) -> bool:
    oid = to_oid(hike_id)
    return bool(oid) and get_db().hike_logs.delete_one({"_id": oid, "user_id": user_id}).deleted_count == 1


def delete_all(user_id: str) -> int:
    return get_db().hike_logs.delete_many({"user_id": user_id}).deleted_count


def stats(user_id: str) -> HikeStats:
    docs = list(get_db().hike_logs.find({"user_id": user_id}, {"trail_id": 1}))
    dist, gain = 0.0, 0
    for d in docs:
        t = store.get(d["trail_id"])
        if t:
            dist += t.distance_mi
            gain += t.elevation_gain_ft
    return HikeStats(
        total_hikes=len(docs),
        unique_trails=len({d["trail_id"] for d in docs}),
        total_distance_mi=round(dist, 1),
        total_elevation_gain_ft=gain,
    )


def agent_summary(user_id: str, limit: int = 20) -> dict:
    """Compact history for the agent's system prompt."""
    docs = list_for(user_id, limit=limit)
    done = list(dict.fromkeys(d["trail_id"] for d in docs))
    loved = list(dict.fromkeys(d["trail_id"] for d in docs if (d.get("rating") or 0) >= 4))
    return {"completed_trail_ids": done, "favorite_trail_ids": loved}


def to_out(doc: dict) -> HikeOut:
    return HikeOut(
        id=str(doc["_id"]),
        trail_id=doc["trail_id"],
        trail_name=doc["trail_name"],
        completed_on=doc["completed_on"].date(),
        duration_min=doc.get("duration_min"),
        rating=doc.get("rating"),
        felt_difficulty=doc.get("felt_difficulty"),
        notes=doc.get("notes"),
        created_at=doc["created_at"],
    )


_SEASONS = {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
            6: "summer", 7: "summer", 8: "summer", 9: "fall", 10: "fall", 11: "fall"}

_PROFILE_FIELDS = ("age", "fitness", "group_type", "home_area", "has_car")
_PREF_FIELDS = ("preferred_features", "transit_modes", "preferred_seasons", "max_level", "max_time_min", "prefers_loop")


def completeness(user: dict) -> int:
    """Percent of the profile and preference fields the user has filled in."""
    profile, prefs = user.get("profile", {}), user.get("preferences", {})
    filled = sum(profile.get(k) not in (None, "", []) for k in _PROFILE_FIELDS)
    filled += sum(prefs.get(k) not in (None, "", []) for k in _PREF_FIELDS)
    return round(100 * filled / (len(_PROFILE_FIELDS) + len(_PREF_FIELDS)))


def insights(user: dict) -> Insights:
    """Taste signals computed from the hike log plus the stated profile; the recommender's input."""
    uid = str(user["_id"])
    docs = list_for(uid, limit=1000)
    levels, areas, features, seasons = Counter(), Counter(), Counter(), Counter()
    access, loops = Counter(), []
    ratings, felt_delta = [], []
    affinity: dict[str, list[float]] = defaultdict(list)
    loved_levels: list[int] = []
    for d in docs:
        t = store.get(d["trail_id"])
        seasons[_SEASONS[d["completed_on"].month]] += 1
        if t is None:
            continue
        lvl = t.difficulty.level
        levels[lvl] += 1
        areas[t.area] += 1
        access["car_free" if t.car_free else "drive_only"] += 1
        loops.append(t.loop)
        r = d.get("rating")
        if r:
            ratings.append(r)
            if r >= 4:
                loved_levels.append(lvl)
        if d.get("felt_difficulty"):
            felt_delta.append(d["felt_difficulty"] - lvl)
        for f in t.features:
            features[f] += 1
            # an unrated hike is neutral: finishing it says little about whether they liked it
            affinity[f].append((r - 3) / 2 if r else 0.0)
    return Insights(
        profile_completeness=completeness(user),
        stats=stats(uid),
        level_counts={lvl: levels.get(lvl, 0) for lvl in range(1, 6)},
        avg_rating=round(sum(ratings) / len(ratings), 2) if ratings else None,
        felt_vs_official=round(sum(felt_delta) / len(felt_delta), 2) if felt_delta else None,
        comfortable_level=max(loved_levels or levels or [0]) or None,
        top_features=[Count(key=k, count=c) for k, c in features.most_common(8)],
        top_areas=[Count(key=k, count=c) for k, c in areas.most_common(5)],
        access_counts=dict(access),
        loop_share=round(sum(loops) / len(loops), 2) if loops else None,
        season_counts={s: seasons.get(s, 0) for s in ("spring", "summer", "fall", "winter")},
        feature_affinity={f: round(sum(v) / len(v), 2) for f, v in affinity.items()},
        recent_hikes=[to_out(d) for d in docs[:5]],
    )
