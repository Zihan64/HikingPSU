"""Pydantic models for accounts, profiles, preferences, hike logs and saved chats."""
from __future__ import annotations

import datetime as dt
from typing import Literal, Optional

from pydantic import BaseModel, Field

EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class Profile(BaseModel):
    display_name: Optional[str] = Field(None, max_length=60)
    home_area: Optional[str] = Field(None, max_length=80)
    has_car: Optional[bool] = None
    fitness: Optional[int] = Field(None, ge=1, le=5, description="1 (new) … 5 (strong)")
    bio: Optional[str] = Field(None, max_length=500)


class Preferences(BaseModel):
    preferred_features: list[str] = Field(default_factory=list, max_length=20)
    max_level: Optional[int] = Field(None, ge=1, le=5)
    max_time_min: Optional[int] = Field(None, ge=1, le=1440)
    max_drive_min: Optional[int] = Field(None, ge=0, le=600)
    notes: Optional[str] = Field(None, max_length=500)


class Credentials(BaseModel):
    email: str = Field(max_length=254, pattern=EMAIL_PATTERN)
    password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"


class UserOut(BaseModel):
    id: str
    email: str
    profile: Profile
    preferences: Preferences
    saved_trail_ids: list[str]
    created_at: dt.datetime


class MePatch(BaseModel):
    """Only fields the client actually sends are changed; an explicit null clears a field."""

    profile: Optional[Profile] = None
    preferences: Optional[Preferences] = None


class HikeCreate(BaseModel):
    trail_id: str
    completed_on: dt.date
    duration_min: Optional[int] = Field(None, ge=1, le=1440)
    rating: Optional[int] = Field(None, ge=1, le=5)
    felt_difficulty: Optional[int] = Field(None, ge=1, le=5)
    notes: Optional[str] = Field(None, max_length=1000)


class HikeUpdate(BaseModel):
    completed_on: Optional[dt.date] = None
    duration_min: Optional[int] = Field(None, ge=1, le=1440)
    rating: Optional[int] = Field(None, ge=1, le=5)
    felt_difficulty: Optional[int] = Field(None, ge=1, le=5)
    notes: Optional[str] = Field(None, max_length=1000)


class HikeOut(BaseModel):
    id: str
    trail_id: str
    trail_name: str
    completed_on: dt.date
    duration_min: Optional[int] = None
    rating: Optional[int] = None
    felt_difficulty: Optional[int] = None
    notes: Optional[str] = None
    created_at: dt.datetime


class HikeStats(BaseModel):
    total_hikes: int
    unique_trails: int
    total_distance_mi: float
    total_elevation_gain_ft: int


class StoredMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    ts: dt.datetime
    recommended_ids: list[str] = []


class ChatSessionSummary(BaseModel):
    id: str
    title: str
    message_count: int
    created_at: dt.datetime
    updated_at: dt.datetime


class ChatSessionOut(ChatSessionSummary):
    messages: list[StoredMessage]
