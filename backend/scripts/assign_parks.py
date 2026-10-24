"""Rebuild the park index from curated official links and agency boundary polygons.

python backend/scripts/assign_parks.py --source-dir .tools/catalog-source [--refresh]
The source folder is a disposable cache; only assignments/evidence are committed.
Trailhead containment is an index aid, not a claim that an entire route stays on one property.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import httpx

DATA = Path(__file__).resolve().parent.parent / 'data'
SOURCES = {
    'park': 'https://www.gis.dcnr.state.pa.us/agsprod/rest/services/Parks/State_Parks/MapServer/9',
    'forest': 'https://www.gis.dcnr.state.pa.us/agsprod/rest/services/BOF/State_Forests/MapServer/4',
    'game': 'https://pgcmaps.pa.gov/arcgis/rest/services/PGC/NEW_PUBLIC/FeatureServer/17',
}


def contains(geometry, x, y):
    """Even-odd polygon containment, including holes and multipolygons."""
    polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
    for rings in polygons:
        inside = False
        for ring in rings:
            for a, b in zip(ring, ring[1:]):
                if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
                    inside = not inside
        if inside:
            return True
    return False


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def build(trails, official, boundaries, relations=None):
    parks = {}
    def ensure(name, manager, kind, official_id=None):
        key = official_id or slug(name)
        if key not in parks:
            parks[key] = dict(id=key, name=name, manager=manager, kind=kind, center=None,
                              official_area_id=official_id, trail_ids=[], evidence={})
        return parks[key]
    for t in trails:
        area = next((a for a in official if t['id'] in a['trail_ids']), None)
        relation_id = t['id'].rsplit('-', 1)[-1]
        tags = (relations or {}).get(relation_id, {})
        osm_evidence = False
        if not area and tags.get('source'):
            source = urlparse(tags['source'])
            for candidate in official:
                manager = urlparse(candidate['manager_url'])
                same_operator = tags.get('operator') == candidate['manager'] and source.netloc == manager.netloc
                doc_id = parse_qs(source.query).get('docId')
                same_document = source.netloc == 'elibrary.dcnr.pa.gov' and doc_id and any(
                    parse_qs(urlparse(r['url']).query).get('docId') == doc_id for r in candidate['resources'])
                if same_operator or same_document:
                    area = candidate; osm_evidence = True; break
        if area:
            kind = 'state_forest' if area['id'] == 'rothrock' else 'conservancy' if area['id'] == 'mount-nittany' else 'state_park'
            park = ensure(area['name'], area['manager'], kind, area['id'])
            evidence = {'method':'curated official resource index', 'source':area['manager_url']}
            if osm_evidence:
                evidence = {'method':'OSM operator/source matches indexed manager or official document',
                            'source':f'https://www.openstreetmap.org/relation/{relation_id}', 'manager_source':tags['source']}
        else:
            park = None
            for source in ['park', 'game', 'forest']:
                for feature in boundaries.get(source, {}).get('features', []):
                    g, p = feature.get('geometry'), feature['properties']
                    if not g or g['type'] not in ['Polygon', 'MultiPolygon'] or not contains(g, t['trailhead']['lon'], t['trailhead']['lat']):
                        continue
                    if source == 'forest':
                        name = p.get('SF_Name')
                        if not name or name == 'NA': continue
                        name += ' State Forest'; manager, kind = 'PA DCNR, Bureau of Forestry', 'state_forest'
                    elif source == 'game':
                        number = p.get('SGL') or p.get('SGL_NO')
                        if not number: continue
                        name = f'State Game Lands {int(number)}'; manager, kind = 'Pennsylvania Game Commission', 'game_lands'
                    else:
                        name = p.get('PARK_NAME')
                        if not name: continue
                        manager, kind = 'PA DCNR, Bureau of State Parks', 'state_park'
                    match = next((a for a in official if a['name'] == name), None)
                    park = ensure(name, manager, kind, match['id'] if match else None)
                    evidence = {'method':'trailhead within agency boundary (route may cross boundaries)',
                                'source':SOURCES[source], 'feature_id':p.get('OBJECTID')}
                    break
                if park: break
            if not park:
                park = ensure('Other nearby trails', 'Park assignment unverified', 'unverified')
                evidence = {'method':'no verified park assignment', 'source':None}
        park['trail_ids'].append(t['id']); park['evidence'][t['id']] = evidence
    by_id = {t['id']: t for t in trails}
    for p in parks.values():
        p['trail_ids'].sort()
        points = [by_id[i]['trailhead'] for i in p['trail_ids']]
        p['center'] = {k:round(sum(point[k] for point in points)/len(points), 5) for k in ['lat','lon']}
    return sorted(parks.values(), key=lambda p:(p['kind'] == 'unverified', p['name']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=DATA.parent.parent / '.tools/catalog-source')
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args(); args.source_dir.mkdir(parents=True, exist_ok=True)
    boundaries = {}
    for name, url in SOURCES.items():
        path = args.source_dir / f'{name}.json'
        if args.refresh or not path.exists():
            response = httpx.get(url+'/query', params={'f':'geojson','where':'1=1','outFields':'*',
                'geometry':'-78.12,40.60,-77.54,40.97','geometryType':'esriGeometryEnvelope',
                'inSR':4326,'outSR':4326,'spatialRel':'esriSpatialRelIntersects','returnGeometry':'true'}, timeout=45)
            response.raise_for_status(); result = response.json()
            if result.get('type') != 'FeatureCollection' or result.get('exceededTransferLimit') or result.get('error'):
                raise ValueError(f'Incomplete boundary source: {url}')
            path.write_text(json.dumps(result), encoding='utf-8')
        boundaries[name] = json.loads(path.read_text(encoding='utf-8'))
    trails = json.loads((DATA/'trails.json').read_text(encoding='utf-8')) + json.loads((DATA/'trails_osm.json').read_text(encoding='utf-8'))
    relations = {}
    for path in args.source_dir.glob('osm-*.json'):
        for element in json.loads(path.read_text(encoding='utf-8')).get('elements', []):
            if element['type'] == 'relation': relations[str(element['id'])] = element.get('tags', {})
    parks = build(trails, json.loads((DATA/'official_sources.json').read_text(encoding='utf-8')), boundaries, relations)
    (DATA/'parks.json').write_text(json.dumps(parks, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
    for park in parks: print(f"{park['name']}: {len(park['trail_ids'])}")


if __name__ == '__main__': main()
