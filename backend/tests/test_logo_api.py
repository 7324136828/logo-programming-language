"""Unit and integration tests for Logo Studio API endpoints."""

from __future__ import annotations

import io
import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.main import create_app


class LogoApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_logo.db"
        self.client = TestClient(create_app(self.db_path))

    def tearDown(self):
        import gc, shutil
        self.client.close()
        del self.client
        gc.collect()
        shutil.rmtree(self.temp_dir.name, ignore_errors=True)

    def test_health_check(self):
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("TI Logo Studio", data["service"])

    def test_samplers_list_and_details(self):
        resp = self.client.get("/api/samplers")
        self.assertEqual(resp.status_code, 200)
        samplers = resp.json()
        self.assertEqual(len(samplers), 10)
        titles = [s["title"] for s in samplers]
        self.assertIn("A_FROG", titles)
        self.assertIn("A_COLORS", titles)

        resp_single = self.client.get("/api/samplers/a_frog")
        self.assertEqual(resp_single.status_code, 200)
        self.assertEqual(resp_single.json()["id"], "a_frog")

    def test_logo_validation(self):
        valid_source = """
        TO SQUARE :SIZE
          REPEAT 4 [FD :SIZE RT 90]
        END
        SQUARE 50
        """
        resp = self.client.post("/api/logo/validate", json={"source": valid_source})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["valid"])
        self.assertIn("SQUARE", data["procedures"])

        invalid_source = "REPEAT 4 [FD 50 RT 90"  # Missing closing bracket
        resp_err = self.client.post("/api/logo/validate", json={"source": invalid_source})
        self.assertEqual(resp_err.status_code, 200)
        data_err = resp_err.json()
        self.assertFalse(data_err["valid"])
        self.assertTrue(len(data_err["errors"]) > 0)

    def test_job_lifecycle_upload_and_zip_download(self):
        code_content = b"; Sample Logo Program\nTO TRIANGLE\n  REPEAT 3 [FD 60 RT 120]\nEND\nCS TRIANGLE\n"
        files = {"file": ("test_program.logo", io.BytesIO(code_content), "text/plain")}

        create_resp = self.client.post("/api/jobs", files=files)
        self.assertEqual(create_resp.status_code, 200)
        job = create_resp.json()
        job_id = job["id"]
        self.assertEqual(job["filename"], "test_program.logo")

        # Poll until complete
        for _ in range(30):
            status_resp = self.client.get(f"/api/jobs/{job_id}")
            self.assertEqual(status_resp.status_code, 200)
            status_data = status_resp.json()
            if status_data["status"] == "completed":
                break
            time.sleep(0.1)

        self.assertEqual(status_data["status"], "completed")
        self.assertEqual(status_data["progress"], 100)
        self.assertTrue(status_data["has_zip"])

        # Test download zip
        dl_resp = self.client.get(f"/api/jobs/{job_id}/download-zip")
        self.assertEqual(dl_resp.status_code, 200)
        self.assertEqual(dl_resp.headers["content-type"], "application/zip")
        self.assertTrue(len(dl_resp.content) > 50)

    def test_job_discard(self):
        code_content = b"CS REPEAT 100 [FD 10 RT 5]"
        files = {"file": ("to_discard.logo", io.BytesIO(code_content), "text/plain")}
        create_resp = self.client.post("/api/jobs", files=files)
        job_id = create_resp.json()["id"]

        discard_resp = self.client.post(f"/api/jobs/{job_id}/discard")
        self.assertEqual(discard_resp.status_code, 200)
        self.assertEqual(discard_resp.json()["status"], "discarded")

        job_info = self.client.get(f"/api/jobs/{job_id}").json()
        self.assertEqual(job_info["status"], "discarded")

    def test_workspace_export_zip(self):
        payload = {
            "title": "Solar Orbit",
            "editor_source": "TO SUN\n  SC 11 REPEAT 36 [FD 5 RT 10]\nEND",
            "workspace_json": '{"title":"Solar Orbit","version":1}',
            "svg_preview": '<svg><circle cx="50" cy="50" r="40" fill="yellow"/></svg>',
        }
        resp = self.client.post("/api/workspace/export-zip", json=payload)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["content-type"], "application/zip")
        self.assertTrue(len(resp.content) > 100)


if __name__ == "__main__":
    unittest.main()
