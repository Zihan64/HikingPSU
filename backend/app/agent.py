"""Claude tool-use loop. The model plans, calls tools, and explains. It cannot invent trails."""
from __future__ import annotations

import datetime as dt
import json
import os
import re

import anthropic

from . import store
from .models import ChatMessage, ChatResponse
from .tools import REGISTRY, TOOLS

MODEL = os.getenv("TRAILHEAD_MODEL", "claude-sonnet-4-5")
MAX_TURNS = 6

SYSTEM = """You are Trailhead, a hiking guide for the Penn State / State College community.

Rules:
- ALWAYS call search_trails before recommending anything. Recommend only trail ids it returned.
- Use the difficulty_level and difficulty_reasons from the tool; never make up your own difficulty.
- If the user has no car, set car_free=true. Say how to get there (bus, walk, bike).
- Convert the user's time budget into max_time_min, leaving ~20% buffer.
- Call hunting_season_note when the date is Oct–Jan and a trail has hunting_zone=true; remind about blaze orange.
- Call get_weather when the user mentions a day, sunset, or rain.
- Recommend 2–3 trails. For each: one line on why it fits, the difficulty level with its reasons, estimated time, and how to get there.
- Be concise and warm. No markdown headers. Use short bullets.
- Finish with a line exactly like: RECOMMENDED: id1, id2, id3

Today is {today}. User profile: {profile}.
"""


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic()  # reads ANTHROPIC_API_KEY


def run(messages: list[ChatMessage], profile: dict | None = None) -> ChatResponse:
    if os.getenv("DEMO_MODE") == "1":
        return _demo(messages)

    client = _client()
    system = SYSTEM.format(today=dt.date.today().isoformat(), profile=json.dumps(profile or {}))
    convo = [{"role": m.role, "content": m.content} for m in messages]
    tool_log: list[dict] = []

    for _ in range(MAX_TURNS):
        resp = client.messages.create(
            model=MODEL, max_tokens=1200, system=system, tools=TOOLS, messages=convo
        )
        if resp.stop_reason != "tool_use":
            text = "".join(b.text for b in resp.content if b.type == "text")
            return _finalize(text, tool_log)

        convo.append({"role": "assistant", "content": resp.content})
        results = []
        for block in resp.content:
            if block.type != "tool_use":
                continue
            fn = REGISTRY[block.name]
            out = fn(**block.input)
            tool_log.append({"tool": block.name, "input": block.input, "output": out})
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(out)})
        convo.append({"role": "user", "content": results})

    return _finalize("I couldn't finish planning — try rephrasing your request.", tool_log)


def _finalize(text: str, tool_log: list[dict]) -> ChatResponse:
    ids: list[str] = []
    m = re.search(r"RECOMMENDED:\s*(.+)", text)
    if m:
        ids = [s.strip() for s in m.group(1).split(",") if s.strip()]
        text = text[: m.start()].rstrip()
    # Guardrail: only ids that exist AND were returned by a search this turn
    seen = {t["id"] for log in tool_log if log["tool"] == "search_trails" for t in log["output"]["trails"]}
    ids = [i for i in ids if i in seen and store.get(i)]
    return ChatResponse(reply=text, recommended_ids=ids, trails=[store.get(i) for i in ids], tool_log=tool_log)


def _demo(messages: list[ChatMessage]) -> ChatResponse:
    """Offline fallback so the demo never dies. Picks by crude keyword match."""
    last = messages[-1].content.lower()
    car_free = "no car" in last or "没车" in last or "bus" in last
    easy = any(w in last for w in ["easy", "beginner", "轻松", "easier"])
    res = store.search(car_free=car_free or None, max_level=2 if easy else 3, limit=3)
    lines = ["Here's what I'd pick (offline demo mode):"]
    for t in res:
        lines.append(f"• {t.name} — Level {t.difficulty.level} ({t.difficulty.label}): " + "; ".join(t.difficulty.reasons))
    return ChatResponse(reply="\n".join(lines), recommended_ids=[t.id for t in res], trails=res, tool_log=[{"tool": "demo", "input": {}, "output": {}}])
