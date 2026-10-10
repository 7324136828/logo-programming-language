"""Isolated system temporary directory lifecycle manager."""

from __future__ import annotations

import logging
import os
import shutil
import time
import zipfile
from pathlib import Path
from typing import Optional

from ..config import get_temp_root

logger = logging.getLogger(__name__)


def create_job_directory(job_id: str) -> Path:
    """Create an isolated job directory under the system temporary directory."""
    base = get_temp_root()
    job_dir = base / job_id
    (job_dir / "inputs").mkdir(parents=True, exist_ok=True)
    (job_dir / "work").mkdir(parents=True, exist_ok=True)
    (job_dir / "outputs").mkdir(parents=True, exist_ok=True)
    (job_dir / "archive").mkdir(parents=True, exist_ok=True)
    return job_dir


def package_outputs_to_zip(job_dir: Path | str, zip_filename: str = "conversion_output.zip") -> Path:
    """Package all output files in job_dir/outputs into job_dir/archive/<zip_filename>."""
    job_path = Path(job_dir)
    outputs_dir = job_path / "outputs"
    archive_dir = job_path / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)

    zip_path = archive_dir / zip_filename
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        if outputs_dir.exists():
            for file_path in outputs_dir.rglob("*"):
                if file_path.is_file():
                    arcname = file_path.relative_to(outputs_dir)
                    zf.write(file_path, arcname=arcname)
        # Also include input file if available
        inputs_dir = job_path / "inputs"
        if inputs_dir.exists():
            for file_path in inputs_dir.rglob("*"):
                if file_path.is_file():
                    zf.write(file_path, arcname=f"source/{file_path.name}")
    return zip_path


def cleanup_job_directory(job_dir: Optional[Path | str]) -> bool:
    """Safely purge the isolated job temporary directory."""
    if not job_dir:
        return False
    path = Path(job_dir)
    if path.is_dir():
        try:
            shutil.rmtree(path, ignore_errors=True)
            return True
        except Exception as e:
            logger.warning("Failed to remove temp directory %s: %s", path, e)
            return False
    return False


def purge_stale_temp_directories(max_age_seconds: int = 86400) -> int:
    """Purge temporary directories older than max_age_seconds."""
    base = get_temp_root()
    now = time.time()
    purged = 0
    if not base.is_dir():
        return 0
    for item in base.iterdir():
        if item.is_dir():
            try:
                mtime = item.stat().st_mtime
                if now - mtime > max_age_seconds:
                    shutil.rmtree(item, ignore_errors=True)
                    purged += 1
            except Exception:
                continue
    return purged
