"""Pydantic models shared by the API, the difficulty model and the agent."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


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


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    profile: Optional[dict] = None  # e.g. {"has_car": false, "fitness": 2}


class ChatResponse(BaseModel):
    reply: str
    recommended_ids: list[str]
    trails: list[TrailWithDifficulty]
    tool_log: list[dict] = []
