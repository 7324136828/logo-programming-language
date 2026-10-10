"""Pydantic schemas for conversion and execution jobs."""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    DISCARDED = "discarded"


class JobResponse(BaseModel):
    id: str
    filename: str
    file_size: int
    status: JobStatus
    progress: int = Field(ge=0, le=100)
    created_at: str
    completed_at: Optional[str] = None
    error_message: Optional[str] = None
    temp_dir: Optional[str] = None
    has_zip: bool = False
    details: Optional[dict[str, Any]] = None


class JobCreateDirect(BaseModel):
    filename: Optional[str] = "workspace.logo"
    content: str
    title: Optional[str] = "Uploaded Logo Program"
