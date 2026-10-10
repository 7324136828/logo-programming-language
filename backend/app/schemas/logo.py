"""Pydantic schemas for Logo operations, samplers, and workspace exports."""

from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel


class LogoValidateRequest(BaseModel):
    source: str


class LogoValidateResponse(BaseModel):
    valid: bool
    errors: list[str] = []
    warnings: list[str] = []
    procedures: list[str] = []
    token_count: int = 0


class SamplerItem(BaseModel):
    id: str
    title: str
    description: str
    instructions: str
    has_graphics: bool = False
    preview_command: str = ""
    starter_commands: list[str] = []
    tags: list[str] = []


class WorkspaceExportRequest(BaseModel):
    title: str = "workspace"
    editor_source: str = ""
    workspace_json: Optional[str] = None
    svg_preview: Optional[str] = None
    png_base64: Optional[str] = None
