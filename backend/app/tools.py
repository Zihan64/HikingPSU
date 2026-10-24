"""Tools the agent can call. Each tool is a plain function + a JSON schema for Claude tool use.

Rule: the LLM never invents trails. It can only recommend ids returned by search_trails.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

import httpx

from . import store
from .official import search_resources, seed_sources

STATE_COLLEGE = (40.7934, -77.8600)


def search_trails(**kw) -> dict[str, Any]:
    args = {k: v for k, v in kw.items() if v is not None}
    if "limit" in args:
        args["limit"] = max(1, min(int(args["limit"]), 8))  # keep tool output small
    if isinstance(args.get("features"), str):  # model sometimes sends "view" instead of ["view"]
        args["features"] = [args["features"]]
    trails = store.search(**args)
    return {
        "count": len(trails),
        "trails": [
            {
                "id": t.id,
                "name": t.name,
                "distance_mi": t.distance_mi,
                "elevation_gain_ft": t.elevation_gain_ft,
                "difficulty_level": t.difficulty.level,
                "difficulty_label": t.difficulty.label,
                "difficulty_reasons": t.difficulty.reasons,
                "est_time_min": t.difficulty.est_time_min,
                "car_free": t.car_free,
                "access": t.access.model_dump(),
                "features": t.features,
                "hunting_zone": t.hunting_zone,
                "cell_signal": t.cell_signal,
                "notes": t.notes,
                "official_resources": seed_sources(t.id),
                "data_note": "Local seed distances and loops are estimates. Use the official library's manager data for mapped routes; no seed is a verified navigation itinerary.",
            }
            for t in trails
        ],
    }


def get_weather(date: str | None = None) -> dict[str, Any]:
    """Daily forecast for State College via Open-Meteo (no API key)."""
    day = date or dt.date.today().isoformat()
    try:
        r = httpx.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": STATE_COLLEGE[0],
                "longitude": STATE_COLLEGE[1],
                "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunset",
                "temperature_unit": "fahrenheit",
                "timezone": "America/New_York",
                "start_date": day,
                "end_date": day,
            },
            timeout=8,
        )
        d = r.json()["daily"]
        return {
            "date": day,
            "high_f": d["temperature_2m_max"][0],
            "low_f": d["temperature_2m_min"][0],
            "rain_chance_pct": d["precipitation_probability_max"][0],
            "sunset": d["sunset"][0][-5:],
        }
    except Exception as e:  # keep the demo alive
        return {"date": day, "error": f"weather unavailable: {e.__class__.__name__}"}


def hunting_season_note(date: str | None = None) -> dict[str, Any]:
    """Coarse PA hunting-season flag. Replace with the PA Game Commission calendar later."""
    day = dt.date.fromisoformat(date) if date else dt.date.today()
    # Rifle deer season is roughly late Nov – mid Dec; fall archery/small game run Oct–Jan.
    in_season = day.month in (10, 11, 12, 1)
    rifle = (day.month == 11 and day.day >= 25) or (day.month == 12 and day.day <= 15)
    return {
        "date": day.isoformat(),
        "hunting_active_in_state_forest": in_season,
        "rifle_deer_season_likely": rifle,
        "advice": "Wear blaze orange on state forest trails" if in_season else "No special precautions",
    }


TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_trails",
        "description": "Search the local trail database around State College. Returns trails with a 1-5 difficulty level and reasons. Only recommend trails returned here.",
        "input_schema": {
            "type": "object",
            "properties": {
                "max_level": {"type": "integer", "minimum": 1, "maximum": 5, "description": "Hardest acceptable level"},
                "min_level": {"type": "integer", "minimum": 1, "maximum": 5},
                "max_time_min": {"type": "integer", "description": "Max hiking time in minutes (excluding travel)"},
                "car_free": {"type": "boolean", "description": "True if the user has no car"},
                "max_drive_min": {"type": "integer"},
                "features": {"type": "array", "items": {"type": "string"}, "description": "Optional. Matches ANY of these. Use plain words: view, sunset, lake, stream, flat, forest, rocks, birds, campus"},
                "limit": {"type": "integer", "default": 5},
            },
        },
    },
    {
        "name": "get_weather",
        "description": "Daily forecast (high/low, rain chance, sunset time) for State College on a date (YYYY-MM-DD). Defaults to today.",
        "input_schema": {"type": "object", "properties": {"date": {"type": "string"}}},
    },
    {
        "name": "hunting_season_note",
        "description": "Whether hunting season is active in PA state forests on a date, and what to wear.",
        "input_schema": {"type": "object", "properties": {"date": {"type": "string"}}},
    },
]

# Per-user, so it is not in REGISTRY: agent.run() adds it only for signed-in users (see recommend.py).
RECOMMEND_FOR_ME_TOOL: dict[str, Any] = {
    "name": "recommend_for_me",
    "description": "The signed-in user's personal trail ranking from their profile, preferences, saved trails and hike log. Returns trails in rank order with why_recommended reasons and personal_time_min at their pace. Only recommend trails returned here, in this order.",
    "input_schema": {"type": "object", "properties": {"k": {"type": "integer", "minimum": 1, "maximum": 8, "default": 3}}},
}

REGISTRY = {
    "search_trails": search_trails,
    "get_weather": get_weather,
    "hunting_season_note": hunting_season_note,
}


def search_official_resources(query: str = "", activity: str | None = None) -> dict:
    return {"areas": search_resources(query[:120], activity), "note": "Official external links only. Download documents from the publisher. Geometry and live permissions are available in the website's Official library."}


TOOLS.append({"name": "search_official_resources", "description": "Find indexed official manager pages and PDF map links around State College/Rothrock. Call for official maps, offline PDFs, regulations, or requests for authoritative trail sources. Never invent a document URL.",
              "input_schema": {"type": "object", "properties": {"query": {"type": "string"}, "activity": {"type": "string", "enum": ["hiking", "cycling"]}}}})
REGISTRY["search_official_resources"] = search_official_resources
