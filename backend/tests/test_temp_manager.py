"""Unit tests for isolated system temporary directory lifecycle manager."""

from __future__ import annotations

import unittest
from pathlib import Path

from backend.app.utils.temp_manager import (
    cleanup_job_directory,
    create_job_directory,
    package_outputs_to_zip,
)


class TempManagerTests(unittest.TestCase):
    def test_create_and_cleanup_job_directory(self):
        job_id = "test-job-uuid-12345"
        job_dir = create_job_directory(job_id)
        self.assertTrue(job_dir.is_dir())
        self.assertTrue((job_dir / "inputs").is_dir())
        self.assertTrue((job_dir / "work").is_dir())
        self.assertTrue((job_dir / "outputs").is_dir())
        self.assertTrue((job_dir / "archive").is_dir())

        # Test packaging zip
        (job_dir / "outputs" / "sample.txt").write_text("Hello Logo", encoding="utf-8")
        zip_path = package_outputs_to_zip(job_dir, "test.zip")
        self.assertTrue(zip_path.is_file())

        # Test cleanup
        cleaned = cleanup_job_directory(job_dir)
        self.assertTrue(cleaned)
        self.assertFalse(job_dir.exists())


if __name__ == "__main__":
    unittest.main()
