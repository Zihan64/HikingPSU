"""Five-level difficulty model.

Design:
  1. Effort  = distance_mi + elevation_gain_ft / 500   ("equivalent miles")
  2. Base level from effort thresholds (calibrated against PSOC ratings)
  3. Terrain bump: +1 level when terrain is clearly harder than the effort suggests
  4. Every level comes with human-readable reasons — that is the product.

Thresholds live in CALIBRATION so they can be tuned from data without touching logic.
"""
from __future__ import annotations

from .models import Difficulty, Trail

LABELS = {1: "Starter", 2: "Easy", 3: "Moderate", 4: "Hard", 5: "Very Hard"}

# Upper bound of effort (equivalent miles) for each level. Tune from PSOC ratings.
CALIBRATION = {
    "effort_upper": {1: 3.0, 2: 5.5, 3: 9.0, 4: 14.0},  # >14 → 5
    "ft_per_mile": 500,          # 500 ft of gain ≈ 1 extra mile of effort
    "terrain_bump_score": 4,     # terrain score at/above this → +1 level
    "hiking_pace_mph": 2.5,      # flat pace used for time estimate
    "min_per_1000ft": 30,        # Naismith-style climb penalty
}


def effort_miles(trail: Trail) -> float:
    return round(trail.distance_mi + trail.elevation_gain_ft / CALIBRATION["ft_per_mile"], 2)


def terrain_score(trail: Trail) -> int:
    t = trail.terrain
    # rocky dominates in central PA; scramble and navigation weigh heavier per point
    return t.rocky + 2 * t.scramble + t.water_crossing + t.navigation


def base_level(effort: float) -> int:
    for level, upper in CALIBRATION["effort_upper"].items():
        if effort < upper:
            return level
    return 5


def estimate_time_min(trail: Trail) -> int:
    flat = trail.distance_mi / CALIBRATION["hiking_pace_mph"] * 60
    climb = trail.elevation_gain_ft / 1000 * CALIBRATION["min_per_1000ft"]
    rough = 1 + 0.05 * terrain_score(trail)
    return int(round((flat + climb) * rough))


def rate(trail: Trail) -> Difficulty:
    effort = effort_miles(trail)
    level = base_level(effort)
    reasons = [
        f"{trail.distance_mi:g} mi {'loop' if trail.loop else 'out-and-back'}",
        f"{trail.elevation_gain_ft} ft of climbing",
    ]

    bump = 0
    tscore = terrain_score(trail)
    if tscore >= CALIBRATION["terrain_bump_score"] and level < 5:
        bump = 1
        level += 1
        why = []
        if trail.terrain.rocky >= 2:
            why.append("rocky footing")
        if trail.terrain.scramble:
            why.append("hands-on sections")
        if trail.terrain.navigation >= 2:
            why.append("easy to lose the trail")
        if trail.terrain.water_crossing:
            why.append("stream crossings")
        reasons.append("bumped one level for " + ", ".join(why))
    elif trail.terrain.rocky >= 2:
        reasons.append("rocky in places")

    if trail.distance_mi <= 2.5 and trail.elevation_gain_ft >= 600:
        reasons.append("short but steep")
        if level == 1:  # a 600 ft wall is never a starter hike
            level, bump = 2, bump + 1

    return Difficulty(
        level=level,
        label=LABELS[level],
        effort_mi=effort,
        terrain_bump=bump,
        reasons=reasons,
        est_time_min=estimate_time_min(trail),
    )


def personalize(level: int, fitness: int | None) -> int:
    """Shift the displayed level for a user. fitness: 1 (new) … 5 (strong). None → unchanged."""
    if fitness is None:
        return level
    shift = {1: +1, 2: 0, 3: 0, 4: -1, 5: -1}.get(fitness, 0)
    return max(1, min(5, level + shift))
