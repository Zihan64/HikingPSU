# Trails catalog data and review notes

The catalog reuses all 52 current records; no trail count is hardcoded in the UI. Park assignment does not certify access, activity permission or current closures. Trailhead containment can differ from ownership along the rest of a route. Unverified assignments are deliberately grouped separately.

## Park assignments

| Park / managed area | Count | Trails |
| --- | ---: | --- |
| Bald Eagle State Forest | 6 | Bog Loop Trail (`bog-loop-trail-21374050`)<br>Faust Valley Trail (`faust-valley-trail-21374046`)<br>Horse Path Trail (`horse-path-trail-21374048`)<br>North Sand Mountain Trail (`north-sand-mountain-trail-13655344`)<br>North Sand Mountain Trail (`north-sand-mountain-trail-21376013`)<br>South Sand Mountain Trail (`south-sand-mountain-trail-21374040`) |
| Black Moshannon State Park | 1 | Moss-Hanne Trail (`moss-hanne-trail-17233610`) |
| Mount Nittany Conservancy Trails | 5 | Mount Nittany Blue and White Trails (`mount-nittany-blue-and-white-trails-17408263`)<br>Mount Nittany Blue Trail (`mount-nittany-blue-trail-17408207`)<br>Mount Nittany White Trail (`mount-nittany-white-trail-17408208`)<br>Mount Nittany – White & Blue Full Loop (`mt-nittany-full-loop`)<br>Mount Nittany – Mike Lynch Overlook (`mt-nittany-mike-lynch`) |
| Rothrock State Forest | 20 | Bald Knob Ridge Trail (`bald-knob-ridge-trail-21272894`)<br>Bear Meadows Loop (`bear-meadows-loop-1024488`)<br>Fern Winder Trail (`fern-winder-trail-21272886`)<br>Forest Leaves Trail (`forest-leaves-trail-21272870`)<br>Greenshoot Trail (`greenshoot-trail-21272893`)<br>Greenwood Spur (`greenwood-spur-1024489`)<br>Hubler Gap Trail (`hubler-gap-trail-21272871`)<br>Indian Steps – Tussey Mountain (`indian-steps`)<br>Ironstone Trail (`ironstone-trail-5694643`)<br>Jo Hays Vista – Mid State Trail Ridge Walk (`jo-hays-vista`)<br>Logging Railroad Grade (`logging-railroad-grade-20510448`)<br>Maguire Trail (`maguire-trail-21272897`)<br>Mountain Mist Trail (`mountain-mist-trail-21272887`)<br>Musser Gap Trail (`musser-gap`)<br>Musser Gap Trail (`musser-gap-trail-21272885`)<br>Rudy Ridge Loop (`rudy-ridge-loop-21272869`)<br>Shingletown Gap – Lower Trail Out-and-Back (`shingletown-gap`)<br>Shingletown Gap Trail (`shingletown-gap-trail-21272898`)<br>Shingletown Gap – Ridge Loop (`shingletown-ridge-loop`)<br>Up and Over Trail (`up-and-over-trail-21272884`) |
| Whipple Dam State Park | 2 | Whipple Dam State Park Lake Loop (`whipple-dam-loop`)<br>Whipple Lake Trail (`whipple-lake-trail-21279199`) |
| Other nearby trails | 18 | Arboretum & Hartley Wood Loop (`arboretum-hartley-wood`)<br>Bluebird (`bluebird-5694641`)<br>Charcoal Flats Trail (`charcoal-flats-trail-21272896`)<br>Hobie's Trail – Colyer Lake Loop (`colyer-lake-hobies`)<br>Decker Path (`decker-path-21376012`)<br>Hobie's Trail hiking (`hobie-s-trail-hiking-18086376`)<br>Lake Trail (`lake-trail-5694644`)<br>Lone Pine Trail (`lone-pine-trail-21272889`)<br>Lower Trail (`lower-trail-21272892`)<br>Millbrook Marsh Nature Center Boardwalk (`millbrook-marsh`)<br>PA SGL 176 Trail A (`pa-sgl-176-trail-a-21058523`)<br>PA SGL 176 Trail B (`pa-sgl-176-trail-b-21058524`)<br>PA SGL 176 Trail C (`pa-sgl-176-trail-c-21058525`)<br>PA SGL 176 Trail D (`pa-sgl-176-trail-d-21058526`)<br>PA SGL 176 Trail E (`pa-sgl-176-trail-e-21058527`)<br>PA SGL 176 Trail F (`pa-sgl-176-trail-f-21058528`)<br>Tussey Pond Park Hiking (`tussey-pond-park-hiking-14356206`)<br>Walnut Springs Park & Thompson Woods (`walnut-springs-thompson-woods`) |

Every record has exactly one assignment. Evidence and agency/OSM source links are stored per trail in `backend/data/parks.json`. The 18 unverified records include the six PA SGL 176 named routes; the PGC service returned no boundary features during this import, so their names alone were not treated as sufficient proof.

Agency sources: [DCNR state park boundaries](https://www.gis.dcnr.state.pa.us/agsprod/rest/services/Parks/State_Parks/MapServer/9), [DCNR state forest boundaries](https://www.gis.dcnr.state.pa.us/agsprod/rest/services/BOF/State_Forests/MapServer/4), [PGC boundaries](https://pgcmaps.pa.gov/arcgis/rest/services/PGC/NEW_PUBLIC/FeatureServer/17). Existing official source links and OSM operator/source tags supplement boundary containment.

## Route geometry and profiles

40 OSM relations have source-derived geometry. 27 single-component routes have complete DEM profiles. 12 curated records have no stored line and display a trailhead marker only; they were not automatically merged with similar OSM trails. Separate component lines stay separate. No route connectors or elevations were invented. Each route has at most 300 displayed vertices. OSM snapshot line lengths can differ from the older catalog length; catalog statistics and backend difficulty calculations are preserved.

| Trail | OSM relation | Elevation profile |
| --- | ---: | --- |
| Bald Knob Ridge Trail (`bald-knob-ridge-trail-21272894`) | 21272894 | Available |
| Bear Meadows Loop (`bear-meadows-loop-1024488`) | 1024488 | Available |
| Bluebird (`bluebird-5694641`) | 5694641 | Available |
| Bog Loop Trail (`bog-loop-trail-21374050`) | 21374050 | Available |
| Charcoal Flats Trail (`charcoal-flats-trail-21272896`) | 21272896 | Available |
| Decker Path (`decker-path-21376012`) | 21376012 | Available |
| Faust Valley Trail (`faust-valley-trail-21374046`) | 21374046 | Available |
| Fern Winder Trail (`fern-winder-trail-21272886`) | 21272886 | Available |
| Forest Leaves Trail (`forest-leaves-trail-21272870`) | 21272870 | Unavailable / multiple components |
| Greenshoot Trail (`greenshoot-trail-21272893`) | 21272893 | Available |
| Greenwood Spur (`greenwood-spur-1024489`) | 1024489 | Unavailable / multiple components |
| Hobie's Trail hiking (`hobie-s-trail-hiking-18086376`) | 18086376 | Unavailable / multiple components |
| Horse Path Trail (`horse-path-trail-21374048`) | 21374048 | Unavailable / multiple components |
| Hubler Gap Trail (`hubler-gap-trail-21272871`) | 21272871 | Available |
| Ironstone Trail (`ironstone-trail-5694643`) | 5694643 | Available |
| Lake Trail (`lake-trail-5694644`) | 5694644 | Unavailable / multiple components |
| Logging Railroad Grade (`logging-railroad-grade-20510448`) | 20510448 | Available |
| Lone Pine Trail (`lone-pine-trail-21272889`) | 21272889 | Available |
| Lower Trail (`lower-trail-21272892`) | 21272892 | Available |
| Maguire Trail (`maguire-trail-21272897`) | 21272897 | Available |
| Moss-Hanne Trail (`moss-hanne-trail-17233610`) | 17233610 | Available |
| Mount Nittany Blue and White Trails (`mount-nittany-blue-and-white-trails-17408263`) | 17408263 | Unavailable / multiple components |
| Mount Nittany Blue Trail (`mount-nittany-blue-trail-17408207`) | 17408207 | Unavailable / multiple components |
| Mount Nittany White Trail (`mount-nittany-white-trail-17408208`) | 17408208 | Unavailable / multiple components |
| Mountain Mist Trail (`mountain-mist-trail-21272887`) | 21272887 | Unavailable / multiple components |
| Musser Gap Trail (`musser-gap-trail-21272885`) | 21272885 | Available |
| North Sand Mountain Trail (`north-sand-mountain-trail-13655344`) | 13655344 | Unavailable / multiple components |
| North Sand Mountain Trail (`north-sand-mountain-trail-21376013`) | 21376013 | Available |
| PA SGL 176 Trail A (`pa-sgl-176-trail-a-21058523`) | 21058523 | Available |
| PA SGL 176 Trail B (`pa-sgl-176-trail-b-21058524`) | 21058524 | Available |
| PA SGL 176 Trail C (`pa-sgl-176-trail-c-21058525`) | 21058525 | Unavailable / multiple components |
| PA SGL 176 Trail D (`pa-sgl-176-trail-d-21058526`) | 21058526 | Unavailable / multiple components |
| PA SGL 176 Trail E (`pa-sgl-176-trail-e-21058527`) | 21058527 | Available |
| PA SGL 176 Trail F (`pa-sgl-176-trail-f-21058528`) | 21058528 | Available |
| Rudy Ridge Loop (`rudy-ridge-loop-21272869`) | 21272869 | Available |
| Shingletown Gap Trail (`shingletown-gap-trail-21272898`) | 21272898 | Available |
| South Sand Mountain Trail (`south-sand-mountain-trail-21374040`) | 21374040 | Available |
| Tussey Pond Park Hiking (`tussey-pond-park-hiking-14356206`) | 14356206 | Unavailable / multiple components |
| Up and Over Trail (`up-and-over-trail-21272884`) | 21272884 | Available |
| Whipple Lake Trail (`whipple-lake-trail-21279199`) | 21279199 | Available |

Map attribution: [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright). Elevations: [Open-Meteo elevation API](https://open-meteo.com/en/docs/elevation-api), approximately 90 m DEM, converted from meters to feet. These lines are OSM snapshots, not manager-certified legal-route or turn-by-turn instructions. Official document downloads remain external links.

The latest main branch computes imported non-loop distance, climb and time for the full out-and-back hike. The source geometry and profile still follow the mapped line once; the detail page labels this difference instead of doubling the route line or fabricating a return profile. Older one-way records are still labeled explicitly if served by an older backend.

## Refresh (manual; never run network imports in CI)

```powershell
python backend/scripts/fetch_osm_trails.py --geometry-only --cache-dir .tools/catalog-source
python backend/scripts/assign_parks.py --source-dir .tools/catalog-source --refresh
```

The geometry-only mode refreshes existing OSM IDs without changing `trails_osm.json`, the current length/gain numbers, or difficulty inputs. The normal import also exports geometry after updating the trail dataset. Raw relations, DEM responses and boundary polygons stay in the ignored `.tools` cache; only bounded line/profile data and park assignment metadata are committed. Re-run assignment after geometry import to include cached OSM operator/source evidence. Failed elevation batches can be retried from cache. A failed relation refresh preserves its previous snapshot when available.

## Possible duplicates (retained for human review)

- Curated `musser-gap` and OSM `musser-gap-trail-21272885`.
- Curated Shingletown Gap variants and OSM `shingletown-gap-trail-21272898`.
- Curated Mount Nittany variants and the three OSM Mount Nittany relations (different route combinations).
- Curated `whipple-dam-loop` and OSM `whipple-lake-trail-21279199` (require map review; no automatic equivalence).
- Curated `colyer-lake-hobies` and OSM `hobie-s-trail-hiking-18086376` (name similarity; trailhead locations disagree).
- `north-sand-mountain-trail-13655344` and `north-sand-mountain-trail-21376013` share a name.

## Validation

Unit and component tests cover park coverage/counts, geometry fallback and bounds, disconnected-line imports, search/sort composition, list/detail/back state, park/geometry API retries, review callbacks and header tab selection. Existing reviews continue to handle backend failures independently.

Desktop and 360 px CSS layouts are implemented. Automated browser review and screenshots are pending: the computer-use tool fails to start with `CreateProcessWithLogonW failed: 2`. No screenshots or visual assertions are claimed. A real authenticated review submission was not performed; existing authenticated API tests and the reused review callback cover that flow without writing production reviews.
