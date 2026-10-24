# HikingPSU

AI hiking guide for Penn State / State College. Five-level, explainable difficulty + car-free access, with a Claude tool-use agent that can only recommend trails from the local database.

## Layout
```
backend/
  app/
    main.py        FastAPI routes: /health /trails /trails/{id} /chat
    models.py      Pydantic schemas
    difficulty.py  5-level model (effort miles + terrain bump) — the core IP
    store.py       JSON trail store + search filters
    tools.py       Agent tools: search_trails, get_weather, hunting_season_note
    agent.py       Claude tool-use loop + guardrail (only ids returned by search)
  data/trails.json 12 seed trails (verified: false — check before demo)
  scripts/calibrate.py   compare model levels vs PSOC ratings
  tests/
frontend/          React + Vite + Tailwind + Leaflet
```

## Run
```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # add ANTHROPIC_API_KEY, or DEMO_MODE=1 for offline
export $(cat .env | xargs)
uvicorn app.main:app --reload   # http://localhost:8000/docs
pytest

# frontend
cd frontend
npm install && npm run dev      # http://localhost:5173  (proxies /api → :8000)
```

## Difficulty model (v0)
```
effort = distance_mi + elevation_gain_ft / 500
L1 < 3.0  |  L2 < 5.5  |  L3 < 9.0  |  L4 < 14  |  L5 ≥ 14
+1 level if terrain score (rocky + 2·scramble + water + navigation) ≥ 4
+1 level if ≤ 2.5 mi with ≥ 600 ft gain and it landed on L1
```
Thresholds are in `difficulty.CALIBRATION`. Collect PSOC ratings into `data/psoc_ratings.csv` (trail_id,rater,level) and run `python scripts/calibrate.py data/psoc_ratings.csv`.

## Adding a trail
Append to `data/trails.json`. Required: distance, gain, terrain scores (0–3 rocky, 0–2 scramble/water/navigation), trailhead coords, access (bus / walk / bike / drive). Set `verified: true` only after someone on the team has hiked it or checked an official map.
