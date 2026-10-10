"""FastAPI entry point for the Logo Studio Full-Stack Application."""

from __future__ import annotations

import logging
import os
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict

from .config import get_cors_origins, get_database_path, get_temp_root
from .schemas.job import JobCreateDirect, JobResponse, JobStatus
from .schemas.logo import (
    LogoValidateRequest,
    LogoValidateResponse,
    SamplerItem,
    WorkspaceExportRequest,
)
from .services.job_service import JobService, job_service
from .services.logo_service import logo_service
from .services.pipeline import run_conversion_pipeline
from .store import CounterState, CounterStore
from .utils.temp_manager import (
    cleanup_job_directory,
    create_job_directory,
    package_outputs_to_zip,
    purge_stale_temp_directories,
)

logger = logging.getLogger(__name__)


class CounterResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    count: int
    updated_at: str


def get_job_srv(request: Request) -> JobService:
    return request.app.state.job_service


def get_counter_store(request: Request) -> CounterStore:
    return request.app.state.counter_store


def create_app(database_path: Path | None = None) -> FastAPI:
    db_path = database_path or get_database_path()
    job_srv = JobService(db_path)
    counter_srv = CounterStore(db_path)
    job_srv.initialize()
    counter_srv.initialize()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        purge_stale_temp_directories(max_age_seconds=86400)
        yield

    app = FastAPI(
        title="TI Logo Studio API",
        description="Production API backend for TI Logo Studio, featuring isolated workspace conversions, persistent jobs, samplers, and geometry verification.",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state.job_service = job_srv
    app.state.counter_store = counter_srv

    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # -------------------------------------------------------------
    # Health & Diagnostics
    # -------------------------------------------------------------
    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "TI Logo Studio API",
            "version": "1.0.0",
        }

    # -------------------------------------------------------------
    # Jobs & Conversion Pipeline (Pillar 2 & 3)
    # -------------------------------------------------------------
    @app.post("/api/convert", response_model=JobResponse)
    @app.post("/api/jobs", response_model=JobResponse)
    async def create_conversion_job(
        background_tasks: BackgroundTasks,
        file: Optional[UploadFile] = File(None),
        code: Optional[str] = Form(None),
        title: Optional[str] = Form(None),
        svg: Optional[str] = Form(None),
        jobs: JobService = Depends(get_job_srv),
    ) -> JobResponse:
        job_id = str(uuid.uuid4())
        job_dir = create_job_directory(job_id)
        inputs_dir = job_dir / "inputs"

        filename = "workspace.logo"
        file_size = 0

        if file is not None and file.filename:
            filename = file.filename
            input_path = inputs_dir / filename
            with open(input_path, "wb") as f:
                shutil.copyfileobj(file.file, f)
            file_size = input_path.stat().st_size
        elif code:
            filename = f"{(title or 'pasted_code').lower().replace(' ', '_')}.logo"
            input_path = inputs_dir / filename
            input_path.write_text(code, encoding="utf-8")
            file_size = len(code.encode("utf-8"))
        else:
            raise HTTPException(status_code=400, detail="Must provide either a file upload or code text")

        job_resp = jobs.create_job(
            job_id=job_id,
            filename=filename,
            file_size=file_size,
            temp_dir=str(job_dir),
            initial_status=JobStatus.QUEUED,
        )
        jobs.register_job_event(job_id)

        background_tasks.add_task(
            run_conversion_pipeline,
            job_id=job_id,
            job_dir=job_dir,
            input_path=input_path,
            svg_data=svg,
            job_srv=jobs,
        )

        return job_resp

    @app.post("/api/jobs/direct", response_model=JobResponse)
    async def create_direct_job(
        payload: JobCreateDirect,
        background_tasks: BackgroundTasks,
        jobs: JobService = Depends(get_job_srv),
    ) -> JobResponse:
        job_id = str(uuid.uuid4())
        job_dir = create_job_directory(job_id)
        filename = payload.filename or "pasted_program.logo"
        input_path = job_dir / "inputs" / filename
        input_path.write_text(payload.content, encoding="utf-8")
        file_size = len(payload.content.encode("utf-8"))

        job_resp = jobs.create_job(
            job_id=job_id,
            filename=filename,
            file_size=file_size,
            temp_dir=str(job_dir),
            initial_status=JobStatus.QUEUED,
        )
        jobs.register_job_event(job_id)

        background_tasks.add_task(
            run_conversion_pipeline,
            job_id=job_id,
            job_dir=job_dir,
            input_path=input_path,
            svg_data=None,
            job_srv=jobs,
        )

        return job_resp

    @app.get("/api/jobs", response_model=list[JobResponse])
    def list_jobs(jobs: JobService = Depends(get_job_srv)) -> list[JobResponse]:
        return jobs.list_jobs()

    @app.get("/api/jobs/{job_id}", response_model=JobResponse)
    def get_job(job_id: str, jobs: JobService = Depends(get_job_srv)) -> JobResponse:
        job = jobs.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job

    @app.post("/api/jobs/{job_id}/discard")
    def discard_job(job_id: str, jobs: JobService = Depends(get_job_srv)) -> dict[str, str]:
        job = jobs.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        jobs.discard_job(job_id)
        return {"job_id": job_id, "status": "discarded", "detail": "Temporary folder purged"}

    @app.delete("/api/jobs/{job_id}")
    def delete_job(job_id: str, jobs: JobService = Depends(get_job_srv)) -> dict[str, str]:
        job = jobs.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        jobs.delete_job(job_id)
        return {"job_id": job_id, "status": "deleted"}

    @app.get("/api/jobs/{job_id}/download-zip")
    def download_job_zip(job_id: str, jobs: JobService = Depends(get_job_srv)):
        job = jobs.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        if job.status != JobStatus.COMPLETED:
            raise HTTPException(
                status_code=400,
                detail=f"Job is not completed yet (current status: {job.status.value})",
            )

        if not job.temp_dir:
            raise HTTPException(status_code=404, detail="Job temporary directory not found")

        archive_dir = Path(job.temp_dir) / "archive"
        zip_files = list(archive_dir.glob("*.zip")) if archive_dir.is_dir() else []
        if not zip_files or not zip_files[0].is_file():
            # Attempt to re-package if outputs exist
            outputs_dir = Path(job.temp_dir) / "outputs"
            if outputs_dir.is_dir():
                zip_path = package_outputs_to_zip(Path(job.temp_dir))
            else:
                raise HTTPException(status_code=404, detail="ZIP archive not found")
        else:
            zip_path = zip_files[0]

        stem = Path(job.filename).stem or "workspace"
        return FileResponse(
            path=str(zip_path),
            filename=f"{stem}_converted.zip",
            media_type="application/zip",
        )

    # -------------------------------------------------------------
    # Logo Language, Samplers & Workspace Packaging
    # -------------------------------------------------------------
    @app.get("/api/samplers", response_model=list[SamplerItem])
    def list_samplers() -> list[SamplerItem]:
        return logo_service.list_samplers()

    @app.get("/api/samplers/starters", response_model=list[SamplerItem])
    def list_starters() -> list[SamplerItem]:
        return logo_service.list_starters()

    @app.get("/api/samplers/{sampler_id}", response_model=SamplerItem)
    def get_sampler(sampler_id: str) -> SamplerItem:
        sampler = logo_service.get_sampler(sampler_id)
        if not sampler:
            raise HTTPException(status_code=404, detail="Sampler not found")
        return sampler

    @app.post("/api/logo/validate", response_model=LogoValidateResponse)
    def validate_logo(payload: LogoValidateRequest) -> LogoValidateResponse:
        return logo_service.validate_logo_source(payload.source)

    @app.post("/api/workspace/export-zip")
    def export_workspace_zip(payload: WorkspaceExportRequest):
        temp_id = str(uuid.uuid4())
        job_dir = create_job_directory(temp_id)
        outputs_dir = job_dir / "outputs"

        try:
            slug = payload.title.lower().replace(" ", "-") or "workspace"
            if payload.editor_source:
                (outputs_dir / f"{slug}.logo").write_text(payload.editor_source, encoding="utf-8")
            if payload.workspace_json:
                (outputs_dir / f"{slug}-workspace.json").write_text(
                    payload.workspace_json, encoding="utf-8"
                )
            if payload.svg_preview:
                (outputs_dir / f"{slug}-vector.svg").write_text(
                    payload.svg_preview, encoding="utf-8"
                )

            readme = f"TI Logo Studio Export: {payload.title}\nGenerated with TI Logo Studio Web Application.\n"
            (outputs_dir / "README.txt").write_text(readme, encoding="utf-8")

            zip_path = package_outputs_to_zip(job_dir, zip_filename=f"{slug}_bundle.zip")
            return FileResponse(
                path=str(zip_path),
                filename=f"{slug}_bundle.zip",
                media_type="application/zip",
            )
        except Exception as e:
            cleanup_job_directory(job_dir)
            raise HTTPException(status_code=500, detail=str(e))

    # -------------------------------------------------------------
    # Legacy Counter Endpoints (Maintained for Backward Compatibility)
    # -------------------------------------------------------------
    @app.get("/api/counter", response_model=CounterResponse)
    def read_counter(
        counter_store: CounterStore = Depends(get_counter_store),
    ) -> CounterState:
        return counter_store.get()

    @app.post("/api/counter/click", response_model=CounterResponse)
    def record_click(
        counter_store: CounterStore = Depends(get_counter_store),
    ) -> CounterState:
        return counter_store.increment()

    @app.delete("/api/counter", response_model=CounterResponse)
    def clear_counter(
        counter_store: CounterStore = Depends(get_counter_store),
    ) -> CounterState:
        return counter_store.reset()

    return app


app = create_app()
