"""Pydantic models shared by the API, the difficulty model and the agent."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Terrain(BaseModel):
    rocky: int = Field(0, ge=0, le=3, description="0 smooth … 3 PA rock-hopping")
    scramble: int = Field(0, ge=0, le=2, description="0 none, 1 hands occasionally, 2 sustained")
    water_crossing: int = Field(0, ge=0, le=2)
    navigation: int = Field(0, ge=0, le=2, description="0 obvious, 1 junctions, 2 easy to get lost")


class Access(BaseModel):
    drive_min: Optional[int] = None
    bus: Optional[str] = None
    walk_from_campus_min: Optional[int] = None
    bike_min: Optional[int] = None


class Trailhead(BaseModel):
    lat: float
    lon: float
    address: str


class Trail(BaseModel):
    id: str
    name: str
    area: str
    distance_mi: float
    elevation_gain_ft: int
    loop: bool
    terrain: Terrain
    trailhead: Trailhead
    access: Access
    parking: str = ""
    cell_signal: Literal["good", "fair", "spotty", "poor"] = "fair"
    hunting_zone: bool = False
    features: list[str] = []
    best_seasons: list[str] = []
    notes: str = ""
    verified: bool = False
    source: Literal["curated", "osm"] = "curated"  # osm: imported by scripts/fetch_osm_trails.py, estimated


class Difficulty(BaseModel):
    level: int = Field(ge=1, le=5)
    label: str
    effort_mi: float
    terrain_bump: int
    reasons: list[str]
    est_time_min: int


class TrailWithDifficulty(Trail):
    difficulty: Difficulty
    car_free: bool
    park_id: str = 'other-nearby-trails'
    park_name: str = 'Other nearby trails'


MAX_USER_MESSAGE_CHARS = 500  # every user turn; assistant turns are our own (signed) replies


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)
    sig: Optional[str] = Field(None, max_length=128)  # assistant turns: the reply_sig we returned with it


class ChatProfile(BaseModel):
    """Per-request overrides of the stored profile. It goes into the system prompt, so only known,
    bounded fields are accepted: free-form keys would be a way around the message length limit."""

    model_config = ConfigDict(extra="forbid")

    has_car: Optional[bool] = None
    fitness: Optional[int] = Field(None, ge=1, le=5)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(max_length=60)
    profile: Optional[ChatProfile] = None  # overrides the stored profile
    session_id: Optional[str] = None  # signed-in users: continue this saved chat; omitted starts a new one


class ChatResponse(BaseModel):
    session_id: Optional[str] = None  # set when the exchange was saved
    reply: str
    reply_sig: Optional[str] = None  # send back as `sig` with this reply in later requests
    recommended_ids: list[str]
    trails: list[TrailWithDifficulty]
    tool_log: list[dict] = []
    usage: list[dict] = []  # one entry per model call: input/output tokens, for cost tracking and evals
