"""Pull hiking routes around State College from OpenStreetMap (the data behind opentrailmap.us).

    python backend/scripts/fetch_osm_trails.py [--bbox S,W,N,E] [--min-mi 0.8] [--max-mi 10]

Writes backend/data/trails_osm.json, which store.py merges with the hand-curated trails.json.
Everything written here is `verified: false`: distance comes from OSM geometry (round trip: a non-loop
route is hiked out and back, so its one-way length is doubled and both directions' climbs are added),
elevation gain from the Open-Meteo DEM (~90 m resolution, so gain is approximate), terrain scores from
OSM tags, and access times are straight-line estimates. Hand-curated trails always win on duplicates.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

DATA = Path(__file__).resolve().parent.parent / "data"
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
ELEVATION = "https://api.open-meteo.com/v1/elevation"
HEADERS = {"User-Agent": "HikingPSU/0.1 (Penn State student project; trail data import)"}
DEFAULT_BBOX = "40.62,-78.10,40.95,-77.55"  # State College + Rothrock / Bald Eagle / Tussey ridges
CAMPUS = (40.7982, -77.8599)  # Old Main
TOWNS = {
    "State College": (40.7934, -77.8600), "Lemont": (40.8013, -77.8127), "Boalsburg": (40.7748, -77.7847),
    "Pine Grove Mills": (40.7234, -77.9331), "Centre Hall": (40.8612, -77.6847), "Bellefonte": (40.9134, -77.7783),
    "Port Matilda": (40.8023, -78.0522), "Julian": (40.8987, -77.9967), "Stormstown": (40.7853, -77.9508),
    "Huntingdon": (40.4848, -78.0100), "Spruce Creek": (40.6150, -78.1380),
}


def miles(a, b) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p = math.pi / 180
    h = math.sin((la2 - la1) * p / 2) ** 2 + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def post(client: httpx.Client, query: str) -> dict:
    for attempt in range(6):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            r = client.post(url, data={"data": query}, timeout=180)
            if r.status_code == 200:
                return r.json()
            print(f"  {url} -> {r.status_code}, retrying", flush=True)
        except httpx.HTTPError as e:
            print(f"  {url} -> {e.__class__.__name__}, retrying", flush=True)
        time.sleep(5 * (attempt + 1))
    raise SystemExit("Overpass unavailable; try again later")


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def way_geoms(rel: dict) -> list[list[tuple[float, float]]]:
    ways, seen = [], set()
    for m in rel.get("members", []):
        if m["type"] == "way" and m.get("geometry") and m["ref"] not in seen:
            seen.add(m["ref"])
            ways.append([(p["lat"], p["lon"]) for p in m["geometry"]])
    return ways


def is_loop(ways) -> bool:
    deg: dict[tuple, int] = {}
    for w in ways:
        for end in (w[0], w[-1]):
            k = (round(end[0], 6), round(end[1], 6))
            deg[k] = deg.get(k, 0) + 1
    return bool(deg) and all(v % 2 == 0 for v in deg.values())


def sample(way, step_mi=0.1):
    pts, acc = [way[0]], 0.0
    for a, b in zip(way, way[1:]):
        acc += miles(a, b)
        if acc >= step_mi:
            pts.append(b)
            acc = 0.0
    if pts[-1] != way[-1]:
        pts.append(way[-1])
    return pts


def elevations(client: httpx.Client, pts) -> list[float]:
    out: list[float] = []
    for i in range(0, len(pts), 100):
        chunk = pts[i:i + 100]
        params = {"latitude": ",".join(f"{p[0]:.5f}" for p in chunk), "longitude": ",".join(f"{p[1]:.5f}" for p in chunk)}
        for attempt in range(5):
            r = client.get(ELEVATION, params=params, timeout=30)
            if r.status_code == 200:
                out += r.json()["elevation"]
                break
            time.sleep(3 * (attempt + 1))
        else:
            raise RuntimeError("elevation API failed")
        time.sleep(0.4)
    return out


def gain_ft(elev_m: list[float], threshold_m: float = 3.0) -> int:
    """Sum of climbs, ignoring wiggles smaller than threshold (the DEM is coarse)."""
    if len(elev_m) < 2:
        return 0
    sm = [sum(elev_m[max(0, i - 1):i + 2]) / len(elev_m[max(0, i - 1):i + 2]) for i in range(len(elev_m))]
    total, low = 0.0, sm[0]
    for e in sm[1:]:
        if e < low:
            low = e
        elif e - low >= threshold_m:  # a rise big enough to count; keep climbing from here
            total += e - low
            low = e
    return int(round(total * 3.28084))


def terrain(tags: dict) -> dict:
    sac = tags.get("sac_scale", "")
    surface = tags.get("surface", "")
    rocky = 3 if sac in ("alpine_hiking", "demanding_alpine_hiking") else 2 if sac == "demanding_mountain_hiking" else (
        2 if surface in ("rock", "stone", "unhewn_cobblestone", "bare_rock") else 1 if surface in ("ground", "dirt", "gravel", "") else 0)
    if sac == "mountain_hiking":
        rocky = max(rocky, 2)
    scramble = 2 if sac in ("alpine_hiking", "demanding_alpine_hiking") else 1 if sac == "demanding_mountain_hiking" else 0
    vis = tags.get("trail_visibility", "")
    nav = 2 if vis in ("bad", "horrible", "no") else 1 if vis in ("intermediate", "") and not tags.get("osmc:symbol") else 0
    return {"rocky": rocky, "scramble": scramble, "water_crossing": 0, "navigation": nav}


def nearest_town(p) -> tuple[str, float]:
    name = min(TOWNS, key=lambda t: miles(p, TOWNS[t]))
    return name, miles(p, TOWNS[name])


def build(client, rel: dict, min_mi: float, max_mi: float):
    tags = rel.get("tags", {})
    name = tags.get("name") or tags.get("ref")
    ways = way_geoms(rel)
    if not name or not ways:
        return None, "no name/geometry"
    dist = sum(miles(a, b) for w in ways for a, b in zip(w, w[1:]))
    loop = is_loop(ways)
    if not (min_mi <= dist <= max_mi):
        return None, f"{dist:.1f} mi outside range"

    # trailhead: loop -> first point; otherwise the end of the route closest to campus
    ends = [w[0] for w in ways] + [w[-1] for w in ways]
    th = ends[0] if loop else min(ends, key=lambda p: miles(p, CAMPUS))

    gain = 0
    for w in ways:
        pts = sample(w)
        if len(pts) > 1:
            elev = elevations(client, pts)
            gain += gain_ft(elev)
            if not loop:  # out and back: the way back climbs what the way out descended
                gain += gain_ft(elev[::-1])
    if not loop:
        dist *= 2  # distance and difficulty are for the whole hike, there and back

    town, _ = nearest_town(th)
    to_campus = miles(th, CAMPUS)
    drive = max(3, int(round(to_campus * 1.4 / 35 * 60 + 3)))
    walk = int(round(to_campus * 1.3 * 20))
    feats = []
    if tags.get("tourism") == "viewpoint":
        feats.append("view")
    if loop:
        feats.append("loop")
    rid = rel["id"]
    return {
        "id": f"{slug(name)}-{rid}",
        "name": name,
        "area": town,
        "distance_mi": round(dist, 1),
        "elevation_gain_ft": gain,
        "loop": loop,
        "terrain": terrain(tags),
        "trailhead": {"lat": round(th[0], 5), "lon": round(th[1], 5), "address": f"Near {town}, PA (OSM relation {rid})"},
        "access": {"drive_min": drive, "bus": None, "walk_from_campus_min": walk if walk <= 90 else None,
                   "bike_min": int(round(to_campus * 1.3 * 6)) if to_campus < 8 else None},
        "parking": "",
        "cell_signal": "fair",
        "hunting_zone": True,  # conservative: assume state forest / game lands until checked
        "features": feats,
        "best_seasons": ["spring", "summer", "fall"],
        "notes": f"Imported from OpenStreetMap relation {rid}. Distance from OSM geometry"
                 f"{'' if loop else ' (round trip: out and back)'}; elevation from a ~90 m DEM; "
                 "drive/walk times are straight-line estimates. Unchecked in the field."
                 + (f" {tags['description']}" if tags.get("description") else ""),
        "verified": False,
        "source": "osm",
    }, None


def connected_lines(ways):
    """Join only real shared endpoints; never connect disjoint ways across empty space."""
    lines = [list(w) for w in ways if len(w) >= 2]
    changed = True
    while changed:
        changed = False
        for i, a in enumerate(lines):
            for j in range(i + 1, len(lines)):
                b = lines[j]
                if a[-1] == b[0]: merged = a + b[1:]
                elif a[-1] == b[-1]: merged = a + b[-2::-1]
                elif a[0] == b[-1]: merged = b + a[1:]
                elif a[0] == b[0]: merged = b[::-1] + a[1:]
                else: continue
                lines[i] = merged; lines.pop(j); changed = True; break
            if changed: break
    return lines


def profile_samples(line, step_mi=0.1):
    points, distances, distance, next_sample = [line[0]], [0.0], 0.0, step_mi
    for a, b in zip(line, line[1:]):
        length = miles(a, b)
        while length > 0 and next_sample <= distance + length:
            ratio = (next_sample - distance) / length
            points.append(tuple(a[k] + ratio * (b[k] - a[k]) for k in range(2)))
            distances.append(next_sample); next_sample += step_mi
        distance += length
    if distance > distances[-1] + 0.001:
        points.append(line[-1]); distances.append(distance)
    return points, distances


def relation_geometry(client, relation_id, cache_dir):
    path = cache_dir / f'osm-{relation_id}.json'
    if path.exists():
        data = json.loads(path.read_text(encoding='utf-8'))
    else:
        response = client.get(f'https://www.openstreetmap.org/api/0.6/relation/{relation_id}/full.json',
                              follow_redirects=True, timeout=35)
        response.raise_for_status(); data = response.json()
        path.write_text(json.dumps(data), encoding='utf-8')
        time.sleep(0.4)
    nodes = {e['id']:(e['lat'],e['lon']) for e in data['elements'] if e['type'] == 'node'}
    ways = {e['id']:e for e in data['elements'] if e['type'] == 'way'}
    relation = next(e for e in data['elements'] if e['type'] == 'relation' and e['id'] == relation_id)
    geometry, seen = [], set()
    for member in relation.get('members', []):
        if member['type'] != 'way' or member['ref'] in seen: continue
        seen.add(member['ref']); way = ways.get(member['ref'])
        if not way or any(n not in nodes for n in way['nodes']):
            raise ValueError('Incomplete OSM way; skip rather than connect across missing nodes')
        geometry.append([nodes[n] for n in way['nodes']])
    return connected_lines(geometry), relation.get('tags', {})


def export_geometry(cache_dir):
    """One-off refresh for current catalog IDs; never rewrites trail lengths or difficulty inputs."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    trails = json.loads((DATA/'trails_osm.json').read_text(encoding='utf-8'))
    previous_path = DATA/'trail_geometry.json'
    previous = json.loads(previous_path.read_text(encoding='utf-8')) if previous_path.exists() else {}
    output, samples = {}, {}
    with httpx.Client(headers=HEADERS) as client:
        def fetch(trail):
            rid = int(trail['id'].rsplit('-',1)[1])
            try:
                lines, tags = relation_geometry(client, rid, cache_dir)
                return trail['id'], rid, lines, tags
            except (httpx.HTTPError, ValueError, StopIteration) as error:
                print(f"Skip {trail['id']}: {type(error).__name__}", flush=True)
                return trail['id'], rid, [], {}
        for trail_id, rid, lines, tags in ThreadPoolExecutor(max_workers=2).map(fetch, trails):
            if not lines:
                if trail_id in previous: output[trail_id] = previous[trail_id]
                continue
            # Share a total budget of about 300 vertices across actual component lines.
            budget = max(2, 300 // len(lines))
            simplified = [[line[round(i*(len(line)-1)/(min(len(line),budget)-1))] for i in range(min(len(line),budget))] for line in lines]
            output[trail_id] = {'source':'osm', 'osm_relation':rid, 'source_url':f'https://www.openstreetmap.org/relation/{rid}',
                'lines':[[[lon,lat] for lat,lon in line] for line in simplified], 'profile':[],
                'tags':{key:tags[key] for key in ['name','operator','network','is_in'] if key in tags}}
            if len(lines) == 1:
                samples[trail_id] = profile_samples(lines[0])
            print(f"Geometry {trail_id}: {len(lines)} component(s)", flush=True)
        # Batch DEM reads, cached separately so a network retry never re-fetches OSM.
        pending = [(trail_id, i, point) for trail_id,(points,_) in samples.items() for i,point in enumerate(points)]
        values = {}
        for offset in range(0, len(pending), 100):
            batch = pending[offset:offset+100]
            key = str(offset)
            path = cache_dir / f'dem-{key}.json'
            points = [p for _,_,p in batch]
            try:
                # Cache validates the complete coordinate list, not just a batch number.
                saved = json.loads(path.read_text()) if path.exists() else None
                if saved and saved.get('points') == [list(p) for p in points]: elevations_m = saved['values']
                else:
                    response = client.get(ELEVATION, params={'latitude':','.join(f'{p[0]:.5f}' for p in points),
                        'longitude':','.join(f'{p[1]:.5f}' for p in points)}, timeout=25)
                    response.raise_for_status(); elevations_m = response.json()['elevation']
                    if len(elevations_m) != len(points): raise ValueError('Incomplete DEM result')
                    path.write_text(json.dumps({'points':points,'values':elevations_m}), encoding='utf-8')
                    time.sleep(0.4)
                for (trail_id,i,_), value in zip(batch,elevations_m):
                    if isinstance(value,(int,float)) and math.isfinite(value): values[trail_id,i] = value * 3.28084
            except (httpx.HTTPError, ValueError, KeyError) as error:
                print(f'DEM batch {offset}: {type(error).__name__}; no invented elevations', flush=True)
        for trail_id,(points,distances) in samples.items():
            if all((trail_id,i) in values for i in range(len(points))):
                output[trail_id]['profile'] = [[round(d,4),round(values[trail_id,i],1)] for i,d in enumerate(distances)]
        for entry in output.values():
            if len(entry.get('lines', [])) == 1:
                entry['line'] = entry.pop('lines')[0]
        (DATA/'trail_geometry.json').write_text(json.dumps(output, separators=(',',':'), ensure_ascii=False)+'\n', encoding='utf-8')
        print(f"Wrote {len(output)} geometries, {sum(bool(e['profile']) for e in output.values())} profiles", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", default=DEFAULT_BBOX)
    ap.add_argument("--min-mi", type=float, default=0.8)
    ap.add_argument("--max-mi", type=float, default=10.0)
    ap.add_argument('--geometry-only', action='store_true', help='Refresh geometry/profile for existing OSM catalog IDs only')
    ap.add_argument('--cache-dir', type=Path, default=DATA.parent.parent / '.tools/catalog-source')
    args = ap.parse_args()
    if args.geometry_only:
        export_geometry(args.cache_dir)
        return

    curated = json.loads((DATA / "trails.json").read_text(encoding="utf-8"))
    query = f'[out:json][timeout:150];rel[route~"^(hiking|foot)$"]({args.bbox});out geom;'
    generic = {"trail", "loop", "the", "state", "park"}
    with httpx.Client(headers=HEADERS) as client:
        print("Querying Overpass...", flush=True)
        rels = [e for e in post(client, query)["elements"] if e["type"] == "relation"]
        print(f"{len(rels)} route relations", flush=True)
        out, seen = [], set()
        for rel in rels:
            label = rel.get("tags", {}).get("name", f"relation/{rel['id']}")
            try:
                t, why = build(client, rel, args.min_mi, args.max_mi)
            except RuntimeError as e:
                t, why = None, str(e)
            if t is None:
                print(f"  skip {label}: {why}", flush=True)
                continue
            here = (t["trailhead"]["lat"], t["trailhead"]["lon"])
            words = set(slug(t["name"]).split("-")) - generic
            dup = next((c for c in curated
                        if miles((c["trailhead"]["lat"], c["trailhead"]["lon"]), here) < 0.3
                        and words & (set(slug(c["name"]).split("-")) - generic)), None)
            if dup:
                print(f"  skip {label}: duplicates curated '{dup['name']}'", flush=True)
                continue
            if t["id"] in seen:
                continue
            seen.add(t["id"])
            out.append(t)
            print(f"  + {t['name']}: {t['distance_mi']} mi, {t['elevation_gain_ft']} ft, {'loop' if t['loop'] else 'one-way'}", flush=True)
    out.sort(key=lambda t: t["name"])
    (DATA / "trails_osm.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} trails to {DATA / 'trails_osm.json'}", flush=True)
    export_geometry(args.cache_dir)


if __name__ == "__main__":
    main()
