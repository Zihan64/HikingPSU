from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import agent, store
from .models import ChatRequest, ChatResponse, TrailWithDifficulty

app = FastAPI(title="HikingPSU API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"ok": True, "trails": len(store.load_all())}


@app.get("/trails", response_model=list[TrailWithDifficulty])
def list_trails(max_level: int | None = None, car_free: bool | None = None, max_time_min: int | None = None):
    return store.search(max_level=max_level, car_free=car_free, max_time_min=max_time_min, limit=100)


@app.get("/trails/{trail_id}", response_model=TrailWithDifficulty)
def get_trail(trail_id: str):
    t = store.get(trail_id)
    if not t:
        raise HTTPException(404, "trail not found")
    return t


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if not req.messages:
        raise HTTPException(400, "messages required")
    return agent.run(req.messages, req.profile)
