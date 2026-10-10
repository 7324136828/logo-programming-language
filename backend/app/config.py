"""Configuration settings for Logo Studio API."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def get_database_path() -> Path:
    raw = os.environ.get("LOGO_DB_PATH", os.environ.get("COUNTER_DB_PATH", "data/logo_studio.db"))
    configured = Path(raw).expanduser()
    return configured if configured.is_absolute() else PROJECT_ROOT / configured


def get_cors_origins() -> list[str]:
    value = os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
    )
    return [origin.strip() for origin in value.split(",") if origin.strip()]


def get_temp_root() -> Path:
    configured = os.environ.get("PROD_TEMP_DIR")
    if configured:
        p = Path(configured)
    else:
        p = Path(tempfile.gettempdir()) / "prod_jobs"
    p.mkdir(parents=True, exist_ok=True)
    return p
