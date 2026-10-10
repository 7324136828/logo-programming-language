"""Isolated conversion and execution pipeline service."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from ..schemas.job import JobStatus
from ..utils.temp_manager import package_outputs_to_zip
from .job_service import job_service
from .logo_service import logo_service

logger = logging.getLogger(__name__)


def generate_fallback_svg(title: str, procedure_names: list[str]) -> str:
    """Generate a clean vector SVG graphic representing the Logo output."""
    procs_xml = "".join(
        f'<text x="28" y="{130 + i * 22}" fill="#5eead4" font-family="monospace" font-size="13">TO {p}</text>'
        for i, p in enumerate(procedure_names[:6])
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 384" width="100%" height="100%">
  <rect width="512" height="384" rx="8" fill="#1b2925" />
  <rect x="12" y="12" width="488" height="360" rx="6" fill="none" stroke="#23342f" stroke-width="2" />
  <g transform="translate(256, 170)">
    <!-- Turtle symbol -->
    <polygon points="0,-45 28,30 0,15 -28,30" fill="none" stroke="#5eead4" stroke-width="3" />
    <circle cx="0" cy="0" r="10" fill="#34d399" opacity="0.3" />
    <!-- Decorative vector orbits -->
    <ellipse cx="0" cy="0" rx="140" ry="80" fill="none" stroke="#34d399" stroke-width="1.5" stroke-dasharray="4 4" transform="rotate(-25)" opacity="0.7"/>
    <ellipse cx="0" cy="0" rx="80" ry="140" fill="none" stroke="#facc15" stroke-width="1.5" stroke-dasharray="6 3" transform="rotate(25)" opacity="0.6"/>
  </g>
  <text x="28" y="48" fill="#facc15" font-family="sans-serif" font-size="20" font-weight="bold">{title}</text>
  <text x="28" y="74" fill="#a7f3d0" font-family="sans-serif" font-size="14">Logo Studio Vector Export · 256 × 192 Units</text>
  {procs_xml}
  <text x="484" y="356" text-anchor="end" fill="#5eead4" font-family="monospace" font-size="12">TI LOGO 1981</text>
</svg>"""


async def run_conversion_pipeline(
    job_id: str,
    job_dir: Path,
    input_path: Path,
    svg_data: str | None = None,
    job_srv: JobService | None = None,
) -> None:
    """Execute the multi-stage conversion pipeline inside the isolated system temp directory."""
    srv = job_srv or job_service
    try:
        srv.update_job(job_id, status=JobStatus.IN_PROGRESS, progress=10)
        await asyncio.sleep(0.1)

        if srv.is_cancelled(job_id):
            return

        # Stage 1: Read & inspect staged input file
        logger.info("Pipeline [%s]: Staging and reading input %s", job_id, input_path)
        content_bytes = input_path.read_bytes()
        try:
            content_text = content_bytes.decode("utf-8")
        except UnicodeDecodeError:
            content_text = content_bytes.decode("latin-1", errors="replace")

        srv.update_job(job_id, progress=30)
        await asyncio.sleep(0.1)

        if srv.is_cancelled(job_id):
            return

        # Stage 2: Parse Logo code or workspace JSON
        outputs_dir = job_dir / "outputs"
        outputs_dir.mkdir(parents=True, exist_ok=True)

        is_json = input_path.suffix.lower() == ".json" or content_text.strip().startswith("{")
        logo_code = ""
        workspace_meta: dict[str, Any] = {}

        if is_json:
            try:
                parsed_json = json.loads(content_text)
                logo_code = parsed_json.get("editorSource") or ""
                workspace_meta = {
                    "title": parsed_json.get("title", input_path.stem),
                    "procedures_count": len(parsed_json.get("procedures", {})),
                    "variables_count": len(parsed_json.get("variables", {})),
                    "has_graphics": bool(parsed_json.get("drawing")),
                }
                # Also save original workspace JSON in outputs
                (outputs_dir / "workspace.json").write_text(content_text, encoding="utf-8")
            except Exception as e:
                logger.warning("JSON parse error: %s, treating as plain text", e)
                logo_code = content_text
        else:
            logo_code = content_text

        # Validate syntax
        val_result = logo_service.validate_logo_source(logo_code)

        # Write output files
        (outputs_dir / "content.logo").write_text(logo_code, encoding="utf-8")

        # Extract TO...END procedures if any
        procedures_text = []
        in_proc = False
        current_proc_lines = []
        for line in logo_code.splitlines():
            upper = line.strip().upper()
            if upper.startswith("TO "):
                in_proc = True
                current_proc_lines = [line]
            elif in_proc:
                current_proc_lines.append(line)
                if upper == "END" or upper.startswith("END "):
                    in_proc = False
                    procedures_text.append("\n".join(current_proc_lines))
                    current_proc_lines = []

        if procedures_text:
            (outputs_dir / "procedures.logo").write_text("\n\n".join(procedures_text), encoding="utf-8")

        # Write metadata JSON
        metadata = {
            "job_id": job_id,
            "filename": input_path.name,
            "valid": val_result.valid,
            "procedure_names": val_result.procedures,
            "token_count": val_result.token_count,
            "errors": val_result.errors,
            "warnings": val_result.warnings,
            "workspace_meta": workspace_meta,
        }
        (outputs_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

        # Write SVG vector preview
        if svg_data and svg_data.strip().startswith("<svg"):
            (outputs_dir / "vector_preview.svg").write_text(svg_data, encoding="utf-8")
        else:
            svg_content = generate_fallback_svg(input_path.stem, val_result.procedures)
            (outputs_dir / "vector_preview.svg").write_text(svg_content, encoding="utf-8")

        # Write README.txt
        readme_text = f"""TI Logo Studio — Converted Archive
======================================
Job ID:       {job_id}
Source File:  {input_path.name}
Procedures:   {', '.join(val_result.procedures) if val_result.procedures else 'None defined'}
Status:       {'Valid Logo syntax' if val_result.valid else 'Syntax warnings detected'}

Files included in this archive:
- content.logo:        Complete Logo editor source
- procedures.logo:     Individual procedure definitions (TO...END)
- vector_preview.svg:  Vector graphic illustration / preview
- metadata.json:       Job and syntax metadata
- source/{input_path.name}: Original uploaded input document
"""
        (outputs_dir / "README.txt").write_text(readme_text, encoding="utf-8")

        srv.update_job(job_id, progress=75)
        await asyncio.sleep(0.1)

        if srv.is_cancelled(job_id):
            return

        # Stage 3: Package consolidated ZIP archive
        zip_name = f"{input_path.stem}_converted.zip"
        zip_path = package_outputs_to_zip(job_dir, zip_filename=zip_name)

        srv.update_job(
            job_id,
            status=JobStatus.COMPLETED,
            progress=100,
            zip_path=str(zip_path),
            details=metadata,
        )
        logger.info("Pipeline [%s]: Completed successfully. Zip created at %s", job_id, zip_path)

    except Exception as exc:
        logger.exception("Pipeline [%s] failed: %s", job_id, exc)
        srv.update_job(
            job_id,
            status=JobStatus.FAILED,
            progress=100,
            error_message=str(exc),
        )
