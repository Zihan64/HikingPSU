"""HikingPSU backend.

Loads backend/.env on import, so `uvicorn app.main:app` works without `export $(cat .env | xargs)`.
Variables already set in the real environment (e.g. on Render/Railway) win over the file.
"""
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
except ImportError:  # python-dotenv not installed: fall back to the real environment only
    pass
