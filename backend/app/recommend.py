"""Personalized "Recommended for you" ranking.

Deterministic on purpose: hard filters a trail must pass, then a weighted score whose
named terms double as the explanation. No LLM decides which trails are shown.

  1. Hard filters: reachable with the user's transport; level <= comfort + 1; fits max_time_min at their pace.
  2. Score: interests, things to avoid, distance from comfort level, saved, new vs. repeat, rated highly, verified.
  3. Comfort level drifts from the stated max_level using how hard the last few hikes felt.
  4. Personal pace scales the time estimate from logged durations.

Weights and thresholds live in REC_CALIBRATION, mirroring CALIBRATION in difficulty.py.
`recommend()` is pure (user doc + hike docs in, ranking out) so it is testable without a database.
"""
from __future__ import annotations

import statistics

from . import store
from .difficulty import LABELS
from .models import TrailWithDifficulty
from .user_models import RecommendedTrail, Recommendations

REC_CALIBRATION = {
    "weights": {
        "feature": 2.0,   # per matching interest
        "avoid": 2.0,     # per matching thing to avoid
        "level": 1.5,     # per level away from comfort
        "saved": 1.0,
        "novel": 0.8,
        "repeat": 0.5,
        "rated": 0.5,
        "verified": 0.5,
    },
    "default_comfort_level": 2,   # when the user hasn't set max_level
    "drift_window": 5,            # felt_difficulty from this many most recent hikes
    "pace_min_hikes": 2,          # fewer logged durations than this -> pace 1.0
    "pace_clamp": (0.6, 1.8),
    "loved_rating": 4,            # rating at/above this counts as "rated highly"
    "max_walk_min": 60,           # same cut-off store.py uses for car_free
    "max_bike_min": 45,
    "default_k": 5,
}

ALL_MODES = ("bus", "walk", "bike", "car")
_MODE_WORDS = {"bus": "bus", "walk": "walking", "bike": "bike", "car": "car"}


# ---------- user signals ----------

def allowed_modes(user: dict) -> set[str]:
    """Transport the user can use: their transit_modes (or all), minus car if they have none."""
    profile, prefs = user.get("profile") or {}, user.get("preferences") or {}
    modes = set(prefs.get("transit_modes") or ALL_MODES)
    if profile.get("has_car") is False:
        modes.discard("car")
    return modes or {"bus", "walk", "bike"}


def reachable_by(trail: TrailWithDifficulty, modes: set[str], max_drive_min: int | None = None) -> list[str]:
    a, c = trail.access, REC_CALIBRATION
    ok = {
        "bus": bool(a.bus),
        "walk": a.walk_from_campus_min is not None and a.walk_from_campus_min <= c["max_walk_min"],
        "bike": a.bike_min is not None and a.bike_min <= c["max_bike_min"],
        "car": max_drive_min is None or (a.drive_min is not None and a.drive_min <= max_drive_min),
    }
    return [m for m in ALL_MODES if m in modes and ok[m]]


def _sign(x: float) -> int:
    return (x > 0) - (x < 0)


def estimate_comfort_level(user: dict, hike_logs: list[dict], trails: dict[str, TrailWithDifficulty]) -> tuple[int, float]:
    """(comfort_level, drift). drift is mean felt-vs-rated over recent hikes: -1 easier ... +1 harder.

    felt_difficulty is stored on the 1-5 level scale; each hike counts as -1/0/+1 against the
    trail's official level. Ties (|drift| == 0.5) keep the base level, so one level of movement at most.
    """
    c = REC_CALIBRATION
    base = (user.get("preferences") or {}).get("max_level") or c["default_comfort_level"]
    recent = sorted(hike_logs, key=lambda d: d["completed_on"], reverse=True)
    deltas = [
        _sign(d["felt_difficulty"] - trails[d["trail_id"]].difficulty.level)
        for d in recent
        if d.get("felt_difficulty") and d["trail_id"] in trails
    ][: c["drift_window"]]
    drift = sum(deltas) / len(deltas) if deltas else 0.0
    step = -_sign(drift) if abs(drift) > 0.5 else 0
    return max(1, min(5, base + step)), round(drift, 2)


def estimate_pace(hike_logs: list[dict], trails: dict[str, TrailWithDifficulty]) -> float:
    """Median of logged duration / estimated time, clamped. 1.0 until there is enough data."""
    c = REC_CALIBRATION
    ratios = [
        d["duration_min"] / trails[d["trail_id"]].difficulty.est_time_min
        for d in hike_logs
        if d.get("duration_min") and d["trail_id"] in trails and trails[d["trail_id"]].difficulty.est_time_min > 0
    ]
    if len(ratios) < c["pace_min_hikes"]:
        return 1.0
    lo, hi = c["pace_clamp"]
    return round(max(lo, min(hi, statistics.median(ratios))), 2)


# ---------- ranking ----------

def _matches(trail: TrailWithDifficulty, wanted: list[str]) -> list[str]:
    return [f for f in wanted if store.feature_matches(trail, f)]


def _level_reason(level: int, comfort: int) -> str:
    tag = f"L{level} {LABELS[level]}"
    if level == comfort:
        return f"At your level ({tag})"
    if level > comfort:
        return f"One step above your level ({tag})"
    return f"Easier than your level ({tag})" if comfort - level == 1 else f"Well below your level ({tag})"


def _score(trail, *, reach, comfort, interests, avoid, saved, hiked, loved) -> tuple[dict[str, float], list[str]]:
    """Named score terms and one reason per term. Zero-valued terms are omitted, except level.

    Transport is a filter rather than a term, but it is part of why the trail is listed, so it gets a reason too.
    """
    w = REC_CALIBRATION["weights"]
    terms: dict[str, float] = {}
    reasons: list[str] = []

    liked = _matches(trail, interests)
    if liked:
        terms["feature"] = w["feature"] * len(liked)
        reasons.append("Matches your interests: " + ", ".join(liked))
    disliked = _matches(trail, avoid)
    if disliked:
        terms["avoid"] = -w["avoid"] * len(disliked)
        reasons.append("Has things you avoid: " + ", ".join(disliked))
    terms["level"] = -w["level"] * abs(trail.difficulty.level - comfort)
    reasons.append(_level_reason(trail.difficulty.level, comfort))
    words = [_MODE_WORDS[m] for m in reach]
    reasons.append("Reachable by " + (", ".join(words[:-1]) + " or " if len(words) > 1 else "") + words[-1])
    if trail.id in saved:
        terms["saved"] = w["saved"]
        reasons.append("On your saved list")
    if trail.id in hiked:
        terms["repeat"] = -w["repeat"]
        reasons.append("You've hiked it before")
    else:
        terms["novel"] = w["novel"]
        reasons.append("You haven't hiked it yet")
    if trail.id in loved:
        terms["rated"] = w["rated"]
        reasons.append("You rated it highly")
    if trail.verified:
        terms["verified"] = w["verified"]
        reasons.append("Trail data checked in the field")
    return terms, reasons


def recommend(
    user: dict,
    hike_logs: list[dict],
    k: int | None = None,
    trails: list[TrailWithDifficulty] | None = None,
) -> Recommendations:
    """Rank trails for one user. Same inputs -> same output and order."""
    c = REC_CALIBRATION
    k = k or c["default_k"]
    trails = trails if trails is not None else store.load_all()
    by_id = {t.id: t for t in [*store.load_all(), *trails]}  # hike logs may name trails outside `trails`
    prefs = user.get("preferences") or {}

    comfort, drift = estimate_comfort_level(user, hike_logs, by_id)
    pace = estimate_pace(hike_logs, by_id)
    modes = allowed_modes(user)
    interests = prefs.get("preferred_features") or []
    avoid = prefs.get("avoid") or []
    max_time = prefs.get("max_time_min")
    saved = set(user.get("saved_trail_ids") or [])
    hiked = {d["trail_id"] for d in hike_logs}
    loved = {d["trail_id"] for d in hike_logs if (d.get("rating") or 0) >= c["loved_rating"]}

    ranked: list[RecommendedTrail] = []
    for t in trails:
        reach = reachable_by(t, modes, prefs.get("max_drive_min"))
        personal_time = round(t.difficulty.est_time_min * pace)
        if not reach or t.difficulty.level > comfort + 1 or (max_time is not None and personal_time > max_time):
            continue
        terms, reasons = _score(t, reach=reach, comfort=comfort, interests=interests, avoid=avoid,
                                saved=saved, hiked=hiked, loved=loved)
        ranked.append(RecommendedTrail(
            trail_id=t.id,
            score=round(sum(terms.values()), 2),
            breakdown={name: round(v, 2) for name, v in terms.items()},
            reasons=reasons,
            reachable_by=reach,
            personal_time_min=personal_time,
            trail=t,
        ))
    ranked.sort(key=lambda r: (-r.score, r.trail_id))
    return Recommendations(comfort_level=comfort, felt_drift=drift, pace_multiplier=pace, trails=ranked[:k])


def for_user(user: dict, k: int | None = None) -> Recommendations:
    """recommend() with the user's hike log loaded from the database."""
    from . import hikes  # imported here so recommend() itself never needs pymongo

    return recommend(user, hikes.list_for(str(user["_id"]), limit=1000), k=k)


def tool_output(recs: Recommendations) -> dict:
    """Compact form for the chat agent (same shape as search_trails so the guardrail accepts these ids)."""
    return {
        "comfort_level": recs.comfort_level,
        "pace_multiplier": recs.pace_multiplier,
        "count": len(recs.trails),
        "trails": [
            {
                "id": r.trail_id,
                "name": r.trail.name,
                "rank": i + 1,
                "difficulty_level": r.trail.difficulty.level,
                "difficulty_label": r.trail.difficulty.label,
                "difficulty_reasons": r.trail.difficulty.reasons,
                "personal_time_min": r.personal_time_min,
                "reachable_by": r.reachable_by,
                "access": r.trail.access.model_dump(),
                "hunting_zone": r.trail.hunting_zone,
                "why_recommended": r.reasons,
            }
            for i, r in enumerate(recs.trails)
        ],
    }
