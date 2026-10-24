"""Metadata-only official resource index and bounded, non-persistent GIS reads.

No PDF/GPX/GIS files are mirrored. Geometry is fetched on demand from a fixed
manager endpoint, validated, returned with no-store headers, then discarded.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Query, Response
from typing import Literal

router = APIRouter(prefix="/official", tags=["official resources"])
GIS_LAYER = "https://www.gis.dcnr.state.pa.us/agsprod/rest/services/Parks/StateParksTrailsSimplifiedPortal/MapServer/0"
SOURCE_NOTICE = "DCNR describes this GIS as planning/education/monitoring data. It may contain errors and may not reflect closures. This is a mapped-route reference, not certified turn-by-turn navigation. Follow current manager notices and on-site signs."
FIELDS = "OBJECTID,Park_ForestName,Name,BlazeColor,Hiking,Bicycle,MtnBike,Ownership,VisiblePublic,Surface,TrailDescription,Length,GlobalID"
Activity = Literal["hiking", "cycling"]


@lru_cache(maxsize=1)
def catalog() -> list[dict]:
    return json.loads((Path(__file__).parent.parent / "data" / "official_sources.json").read_text(encoding="utf-8"))


def search_resources(q: str = "", activity: str | None = None, kind: str | None = None) -> list[dict]:
    tokens = [word for word in q.lower().split() if word not in {"pdf", "offline", "map", "maps", "离线", "地图"}]
    if "pdf" in q.lower() and kind is None:
        kind = "pdf"
    results = []
    for area in catalog():
        haystack = json.dumps(area, ensure_ascii=False).lower()
        if activity and activity not in area["activities"] or not all(word in haystack for word in tokens):
            continue
        resources = [r for r in area["resources"] if kind is None or r["kind"] == kind]
        matching = [r for r in resources if all(word in (r["title"] + " " + r["url"]).lower() for word in tokens)]
        if matching:
            resources = matching
        if resources:
            results.append({**area, "resources": resources, "geometry_available": bool(area.get("gis_park_name"))})
    return results


def seed_sources(trail_id: str) -> list[dict]:
    return [{"area_id": a["id"], "manager": a["manager"], "manager_url": a["manager_url"], "resources": a["resources"]}
            for a in catalog() if trail_id in a.get("trail_ids", [])]


def get_area(area_id: str) -> dict:
    area = next((a for a in catalog() if a["id"] == area_id), None)
    if not area:
        raise HTTPException(404, "Official area not indexed")
    return area


def _fetch(params: dict) -> dict:
    try:
        with httpx.stream("GET", GIS_LAYER + "/query", params=params,
                          timeout=httpx.Timeout(20, connect=8), follow_redirects=False) as response:
            response.raise_for_status()
            chunks, size = [], 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > 8_000_000:
                    raise ValueError("GIS response too large")
                chunks.append(chunk)
        result = json.loads(b"".join(chunks))
        if not isinstance(result, dict) or result.get("type") != "FeatureCollection" or not isinstance(result.get("features"), list):
            raise ValueError("GIS returned an invalid feature collection")
        metadata = result.get("properties") or {}
        if not isinstance(metadata, dict) or result.get("error") or result.get("exceededTransferLimit") or metadata.get("exceededTransferLimit"):
            raise ValueError("GIS rejected or truncated this query")
        if len(result.get("features", [])) > 2000:
            raise ValueError("GIS returned too many features")
        return result
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise HTTPException(502, "Official GIS is unavailable or returned incomplete data. Use the manager's original map links and retry later.") from exc


def _features(area: dict, geometry: bool) -> list[dict]:
    park = area.get("gis_park_name")
    if not park:
        raise HTTPException(409, "This area has official resource links, but no connected digital trail source in this release.")
    # The area is chosen from our index, never an arbitrary URL or SQL expression.
    data = _fetch({"f": "geojson", "where": f"Park_ForestName = '{park.replace(chr(39), chr(39) * 2)}'",
                   "outFields": FIELDS, "outSR": 4326, "returnGeometry": str(geometry).lower()})
    features = data.get("features")
    if not isinstance(features, list):
        raise HTTPException(502, "Official GIS returned an invalid feature collection")
    if any(not isinstance(f, dict) or not isinstance(f.get("properties"), dict) for f in features):
        raise HTTPException(502, "Official GIS returned invalid feature metadata")
    text_fields = ("Name", "Park_ForestName", "VisiblePublic", "Ownership", "Hiking", "Bicycle", "MtnBike", "BlazeColor", "TrailDescription")
    if any(f["properties"].get(field) is not None and not isinstance(f["properties"][field], str)
           for f in features for field in text_fields):
        raise HTTPException(502, "Official GIS metadata format has changed. Use the original manager map links.")
    return [f for f in features if f["properties"].get("Park_ForestName") == park]


def _group_name(area: dict, name: str) -> str:
    for group in area.get("route_groups", []):
        if name in group["source_names"]:
            return group["name"]
    return name


def _allowed(feature: dict, activity: str) -> bool:
    props = feature["properties"]
    if props.get("VisiblePublic") != "Yes" or props.get("Ownership") not in {"PA State Park", "PA State Forest"}:
        return False
    return props.get("Hiking") == "Permitted" if activity == "hiking" else (
        props.get("Bicycle") == "Permitted" or props.get("MtnBike") == "Permitted")


def _groups(area: dict, features: list[dict], activity: str) -> list[tuple[dict, list[dict]]]:
    grouped = defaultdict(list)
    for feature in features:
        name = (feature["properties"].get("Name") or "").strip()
        if name:
            grouped[_group_name(area, name)].append(feature)
    results = []
    for name, parts in sorted(grouped.items()):
        # Group before checking public visibility, ownership AND activity, so a
        # restricted section cannot turn the rest of a loop into a false route.
        if not all(_allowed(part, activity) for part in parts):
            continue
        route_id = hashlib.sha256(f"{area['id']}:{name}".encode()).hexdigest()[:16]
        descriptions = list(dict.fromkeys(p["properties"].get("TrailDescription") for p in parts if p["properties"].get("TrailDescription")))
        results.append(({"id": route_id, "area_id": area["id"], "name": name, "area": area["name"], "manager": area["manager"],
                         "activity": activity, "status": "manager-listed; current closure status unconfirmed",
                         "source_url": GIS_LAYER, "manager_url": area["manager_url"], "resources": area["resources"],
                         "description": "\n".join(descriptions), "blazes": sorted({p["properties"].get("BlazeColor") for p in parts if p["properties"].get("BlazeColor")}),
                         "segment_count": len(parts), "notice": SOURCE_NOTICE}, parts))
    return results


def validate_geometry(features: list[dict]) -> None:
    count = 0
    for feature in features:
        geometry = feature.get("geometry") or {}
        kind = geometry.get("type")
        coordinates = geometry.get("coordinates")
        if kind not in {"LineString", "MultiLineString"} or not isinstance(coordinates, list) or not coordinates:
            raise HTTPException(502, "Official source has no usable line geometry for this route")
        lines = [coordinates] if kind == "LineString" else coordinates
        for line in lines:
            if not isinstance(line, list) or len(line) < 2:
                raise HTTPException(502, "Official source returned an invalid line")
            for point in line:
                if not isinstance(point, list) or len(point) < 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in point[:2]) or abs(point[0]) > 180 or abs(point[1]) > 90:
                    raise HTTPException(502, "Official source returned invalid coordinates")
                count += 1
                if count > 50000:
                    raise HTTPException(502, "Official geometry is too large to display reliably")


@router.get("/library")
def library(q: str = Query("", max_length=120), activity: Activity | None = None,
            kind: Literal["pdf", "manager_page"] | None = None):
    return {"areas": search_resources(q, activity, kind), "coverage": "Curated State College / Rothrock pilot; expandable manager-source index.",
            "storage": "Metadata and external links only. No public document files are hosted."}


@router.get("/trails")
def trails(response: Response, area_id: str, activity: Activity = "hiking", q: str = Query("", max_length=80)):
    area = get_area(area_id)
    response.headers["Cache-Control"] = "no-store"
    items = [meta for meta, _ in _groups(area, _features(area, False), activity) if q.lower() in meta["name"].lower()]
    return {"trails": items, "source_url": GIS_LAYER, "notice": SOURCE_NOTICE,
            "retrieved_at": datetime.now(timezone.utc).isoformat()}


@router.get("/trails/{area_id}/{route_id}/geometry")
def geometry(area_id: str, route_id: str, response: Response, activity: Activity = "hiking"):
    area = get_area(area_id)
    matches = [(meta, parts) for meta, parts in _groups(area, _features(area, True), activity) if meta["id"] == route_id]
    if not matches:
        raise HTTPException(404, "No manager-listed route permits this activity with the requested identifier")
    meta, parts = matches[0]
    validate_geometry(parts)
    response.headers["Cache-Control"] = "no-store"
    return {"route": meta, "geojson": {"type": "FeatureCollection", "features": parts},
            "retrieved_at": datetime.now(timezone.utc).isoformat(), "source_notice": SOURCE_NOTICE}
