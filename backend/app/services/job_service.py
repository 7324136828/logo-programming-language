"""Job persistence service using SQLite."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from ..config import get_database_path
from ..schemas.job import JobResponse, JobStatus
from ..utils.temp_manager import cleanup_job_directory


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


from contextlib import closing

class JobService:
    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or get_database_path()
        self._cancellation_events: dict[str, asyncio.Event] = {}

    def _connect(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), timeout=30)
        conn.row_factory = sqlite3.Row
        return closing(conn)

    def initialize(self) -> None:
        """Create the jobs table and required indices if not present."""
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    completed_at TEXT,
                    error_message TEXT,
                    temp_dir TEXT,
                    zip_path TEXT,
                    details_json TEXT
                )
                """
            )
            conn.commit()

    def register_job_event(self, job_id: str) -> asyncio.Event:
        event = asyncio.Event()
        self._cancellation_events[job_id] = event
        return event

    def is_cancelled(self, job_id: str) -> bool:
        event = self._cancellation_events.get(job_id)
        return event.is_set() if event else False

    def create_job(
        self,
        job_id: str,
        filename: str,
        file_size: int,
        temp_dir: str,
        initial_status: JobStatus = JobStatus.QUEUED,
    ) -> JobResponse:
        created_at = _utc_now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO jobs (id, filename, file_size, status, progress, created_at, temp_dir)
                VALUES (?, ?, ?, ?, 0, ?, ?)
                """,
                (job_id, filename, file_size, initial_status.value, created_at, temp_dir),
            )
            conn.commit()
        return self.get_job(job_id)  # type: ignore

    def get_job(self, job_id: str) -> Optional[JobResponse]:
        with self._connect() as conn:
            cur = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
            row = cur.fetchone()
            if not row:
                return None
            return self._row_to_model(row)

    def list_jobs(self) -> list[JobResponse]:
        with self._connect() as conn:
            cur = conn.execute("SELECT * FROM jobs ORDER BY created_at DESC")
            rows = cur.fetchall()
            return [self._row_to_model(row) for row in rows]

    def update_job(
        self,
        job_id: str,
        status: Optional[JobStatus] = None,
        progress: Optional[int] = None,
        error_message: Optional[str] = None,
        zip_path: Optional[str] = None,
        details: Optional[dict[str, Any]] = None,
    ) -> Optional[JobResponse]:
        updates: list[str] = []
        params: list[Any] = []

        if status is not None:
            updates.append("status = ?")
            params.append(status.value)
            if status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.DISCARDED):
                updates.append("completed_at = ?")
                params.append(_utc_now_iso())

        if progress is not None:
            updates.append("progress = ?")
            params.append(progress)

        if error_message is not None:
            updates.append("error_message = ?")
            params.append(error_message)

        if zip_path is not None:
            updates.append("zip_path = ?")
            params.append(zip_path)

        if details is not None:
            updates.append("details_json = ?")
            params.append(json.dumps(details))

        if not updates:
            return self.get_job(job_id)

        params.append(job_id)
        query = f"UPDATE jobs SET {', '.join(updates)} WHERE id = ?"
        with self._connect() as conn:
            conn.execute(query, params)
            conn.commit()

        return self.get_job(job_id)

    def discard_job(self, job_id: str) -> Optional[JobResponse]:
        """Cancel active job, purge temp directory, and update status to discarded."""
        if job_id in self._cancellation_events:
            self._cancellation_events[job_id].set()

        job = self.get_job(job_id)
        if not job:
            return None

        if job.temp_dir:
            cleanup_job_directory(job.temp_dir)

        return self.update_job(
            job_id,
            status=JobStatus.DISCARDED,
            error_message="Job discarded by user",
        )

    def delete_job(self, job_id: str) -> bool:
        job = self.get_job(job_id)
        if not job:
            return False
        if job.temp_dir:
            cleanup_job_directory(job.temp_dir)
        with self._connect() as conn:
            conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            conn.commit()
        if job_id in self._cancellation_events:
            del self._cancellation_events[job_id]
        return True

    def _row_to_model(self, row: sqlite3.Row) -> JobResponse:
        details = None
        if row["details_json"]:
            try:
                details = json.loads(row["details_json"])
            except Exception:
                details = None

        has_zip = bool(row["zip_path"] and Path(row["zip_path"]).is_file())
        return JobResponse(
            id=row["id"],
            filename=row["filename"],
            file_size=row["file_size"],
            status=JobStatus(row["status"]),
            progress=row["progress"],
            created_at=row["created_at"],
            completed_at=row["completed_at"],
            error_message=row["error_message"],
            temp_dir=row["temp_dir"],
            has_zip=has_zip,
            details=details,
        )


job_service = JobService()
