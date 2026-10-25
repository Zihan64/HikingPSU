"""Which LLM the app talks to. LLM_PROVIDER=gemini (default) or claude; both paths share the same tools and rules.

Gemini reads GEMINI_API_KEY (or GOOGLE_API_KEY); Claude reads ANTHROPIC_API_KEY. Without a working key every
AI feature falls back to its offline version, so switching never takes the app down.
"""
from __future__ import annotations

import os

from google import genai

PROVIDERS = ("gemini", "claude")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
# HIKINGPSU_MODEL is preferred; TRAILHEAD_MODEL kept so existing .env files still work.
CLAUDE_MODEL = os.getenv("HIKINGPSU_MODEL") or os.getenv("TRAILHEAD_MODEL", "claude-sonnet-5-5")


def provider() -> str:
    """Read per call so a changed environment (or a test) takes effect without a restart of this module."""
    p = os.getenv("LLM_PROVIDER", "gemini").strip().lower()
    return p if p in PROVIDERS else "gemini"


def model() -> str:
    return GEMINI_MODEL if provider() == "gemini" else CLAUDE_MODEL


def gemini_client() -> genai.Client:
    return genai.Client()  # reads GEMINI_API_KEY / GOOGLE_API_KEY
