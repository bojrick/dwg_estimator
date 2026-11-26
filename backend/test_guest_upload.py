import json
import math
import os
import shutil
import socket
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

_TMP_DIR = tempfile.TemporaryDirectory(prefix="planvault_guest_test_")
os.environ["STORAGE_DIR"] = _TMP_DIR.name
os.environ.pop("DATABASE_URL", None)

import ezdxf  # noqa: E402
import uvicorn  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import plans as plans_router_mod  # noqa: E402
from app.services import dwg_converter as dwg_converter_mod  # noqa: E402
from app.services.dxf_parser import extract_dxf_raw_entities  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
SAMPLE_DWG_1 = (
    REPO_ROOT
    / "storage"
    / "cloud"
    / "plans"
    / "plan_7"
    / "S-01--R1--FIRST TO FIFTH FLOOR PLAN_26072026.dwg"
)
SAMPLE_DWG_2 = (
    REPO_ROOT
    / "storage"
    / "cloud"
    / "plans"
    / "plan_19"
    / "sources"
    / "STAIRCASE-1-ST-CF-01-20260301.dwg"
)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _post_multipart(
    base_url: str,
    path: str,
    files=None,
    fields=None,
    timeout: int = 30,
):
    boundary = f"----PlanVaultBoundary{int(time.time() * 1000)}"
    chunks = []
    for name, value in (fields or []):
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")
    for field_name, filename, content_bytes in (files or []):
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n".encode("utf-8")
        )
        chunks.append(content_bytes)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(chunks)

    req = urllib.request.Request(
        f"{base_url}{path}",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = raw
        return exc.code, parsed


def test_ensure_dxf_non_utf8_stderr():
    with tempfile.TemporaryDirectory(prefix="dwg_conv_test_") as td:
        td_path = Path(td)
        fake_bin = td_path / "fake_dwg2dxf.py"
        fake_bin.write_text(
            "#!/usr/bin/env python3\n"
            "import sys\n"
            "sys.stderr.buffer.write(b'Bad layer name: \\xff\\xfe\\x80\\n')\n"
            "sys.exit(1)\n",
            encoding="utf-8",
        )
        fake_bin.chmod(0o755)
        fake_dwg = td_path / "sample.dwg"
        fake_dwg.write_bytes(b"AC1024dummy")

        orig_find_binary = dwg_converter_mod.find_binary
        dwg_converter_mod.find_binary = lambda name: str(fake_bin) if name == "dwg2dxf" else orig_find_binary(name)
        try:
            raised = None
            try:
                dwg_converter_mod.ensure_dxf(fake_dwg, td_path / "out")
            except RuntimeError as exc:
                raised = exc
            assert raised is not None, "Expected RuntimeError on failed dwg2dxf conversion"
            assert "failed to convert" in str(raised)
        finally:
            dwg_converter_mod.find_binary = orig_find_binary


def test_non_finite_floats_sanitized_in_dxf():
    with tempfile.TemporaryDirectory(prefix="dxf_nan_test_") as td:
        doc = ezdxf.new("R2010")
        msp = doc.modelspace()
        msp.add_line((0, 0), (10, 0))
        msp.add_line((1, 2), (3, 4))
        dxf_nan = Path(td) / "nan_coords.dxf"
        doc.saveas(str(dxf_nan))
        raw_txt = dxf_nan.read_text(encoding="utf-8")
        # Replace exact Y=4.0 of second line with nan
        raw_txt = raw_txt.replace("\n 21\n4.0\n", "\n 21\nnan\n", 1)
        dxf_nan.write_text(raw_txt, encoding="utf-8")

        loaded = dwg_converter_mod.load_ezdxf_doc(dxf_nan)
        extracted = extract_dxf_raw_entities(dxf_nan, doc=loaded)
        # Ensure strict JSON serialization (allow_nan=False) succeeds and finite line remains
        serialized = json.dumps(extracted, allow_nan=False)
        assert serialized
        assert len(extracted["lines"]) == 1
        assert math.isfinite(extracted["lines"][0]["start"][0])


def test_guest_upload_endpoints_http():
    assert SAMPLE_DWG_1.exists(), f"Missing sample DWG: {SAMPLE_DWG_1}"
    assert SAMPLE_DWG_2.exists(), f"Missing sample DWG: {SAMPLE_DWG_2}"
    dwg1_bytes = SAMPLE_DWG_1.read_bytes()
    dwg2_bytes = SAMPLE_DWG_2.read_bytes()

    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{port}"

    for _ in range(50):
        try:
            with urllib.request.urlopen(f"{base_url}/api/health", timeout=2) as r:
                if r.status == 200:
                    break
        except Exception:
            time.sleep(0.05)

    try:
        # 1. Valid real DWG upload
        st, data = _post_multipart(
            base_url,
            "/api/plans/preview-guest",
            files=[("dwg_file", SAMPLE_DWG_1.name, dwg1_bytes)],
        )
        assert st == 200, f"Expected 200, got {st}: {data}"
        assert data["dwg_filename"] == SAMPLE_DWG_1.name
        assert len(data["raw_data"]["lines"]) > 0
        assert len(data["sheets"]) >= 1

        # 2. Uppercase .DWG and Windows-style path in filename
        st, data = _post_multipart(
            base_url,
            "/api/plans/preview-guest",
            files=[("dwg_file", r"C:\drawings\Test Plan.DWG", dwg2_bytes)],
        )
        assert st == 200, f"Expected 200 for uppercase .DWG, got {st}: {data}"
        assert data["dwg_filename"] == "Test Plan.DWG"

        # 3. Empty 0-byte upload returns 400 with JSON detail
        st, data = _post_multipart(
            base_url,
            "/api/plans/preview-guest",
            files=[("dwg_file", "empty.dwg", b"")],
        )
        assert st == 400 and isinstance(data, dict) and "empty" in data.get("detail", "").lower(), (st, data)

        # 4. Unsupported extension returns 400
        st, data = _post_multipart(
            base_url,
            "/api/plans/preview-guest",
            files=[("dwg_file", "notes.txt", b"hello")],
        )
        assert st == 400 and isinstance(data, dict) and "detail" in data, (st, data)

        # 5. Corrupt DWG bytes return 400 JSON (never 500)
        st, data = _post_multipart(
            base_url,
            "/api/plans/preview-guest",
            files=[("dwg_file", "corrupt.dwg", b"NOT_A_REAL_DWG_HEADER_1234567890")],
        )
        assert st == 400 and isinstance(data, dict) and "detail" in data, (st, data)

        # 6. Unwritable TMP_WORK_DIR falls back to system tempdir cleanly
        orig_tmp_dir = plans_router_mod.TMP_WORK_DIR
        blocker_file = Path(_TMP_DIR.name) / "not_a_dir"
        blocker_file.write_text("blocker")
        plans_router_mod.TMP_WORK_DIR = blocker_file / "subdir"
        try:
            st, data = _post_multipart(
                base_url,
                "/api/plans/preview-guest",
                files=[("dwg_file", SAMPLE_DWG_2.name, dwg2_bytes)],
            )
            assert st == 200, f"Expected fallback 200, got {st}: {data}"
        finally:
            plans_router_mod.TMP_WORK_DIR = orig_tmp_dir

        # 7. Synthetic DXF with NaN float returns 200 strict JSON
        doc = ezdxf.new("R2010")
        msp = doc.modelspace()
        msp.add_line((0, 0), (5, 5))
        msp.add_line((1, 1), (4, 4))
        tmp_dxf = Path(_TMP_DIR.name) / "guest_nan.dxf"
        doc.saveas(str(tmp_dxf))
        dxf_text = tmp_dxf.read_text(encoding="utf-8").replace("\n 21\n4.0\n", "\n 21\nnan\n", 1)
        st, data = _post_multipart(
            base_url,
            "/api/plans/preview-guest",
            files=[("dwg_file", "guest_nan.dxf", dxf_text.encode("utf-8"))],
        )
        assert st == 200, f"Expected 200 for NaN DXF, got {st}: {data}"
        assert len(data["raw_data"]["lines"]) == 1

        # 8. Multi-file preview with identical filename (collision safety)
        st, multi = _post_multipart(
            base_url,
            "/api/plans/preview-multi",
            files=[
                ("dwg_files", "same_name.dwg", dwg1_bytes),
                ("dwg_files", "same_name.dwg", dwg2_bytes),
            ],
        )
        assert st == 200, f"Expected 200 for preview-multi, got {st}: {multi}"
        assert len(multi["files"]) == 2
        assert multi["files"][0]["file_id"] == "file_0"
        assert multi["files"][1]["file_id"] == "file_1"

        # 9. Merge-preview with 2 files and selected sheets
        sheet0 = multi["files"][0]["sheets"][0]
        sheet1 = multi["files"][1]["sheets"][0]
        st, merged = _post_multipart(
            base_url,
            "/api/plans/merge-preview",
            fields=[
                ("sheets_json", json.dumps([sheet0, sheet1])),
                ("active_sheet_id", sheet0["id"]),
            ],
            files=[
                ("dwg_files", SAMPLE_DWG_1.name, dwg1_bytes),
                ("dwg_files", SAMPLE_DWG_2.name, dwg2_bytes),
            ],
        )
        assert st == 200, f"Expected 200 for merge-preview, got {st}: {merged}"
        assert len(merged["sheets"]) == 2
        assert len(merged["raw_data"]["lines"]) > 0
        assert len(merged["full_raw_data"]["lines"]) > 0
    finally:
        server.should_exit = True
        thread.join(timeout=3)


if __name__ == "__main__":
    try:
        test_ensure_dxf_non_utf8_stderr()
        test_non_finite_floats_sanitized_in_dxf()
        test_guest_upload_endpoints_http()
        print("✓ ALL GUEST UPLOAD TESTS PASSED!")
    finally:
        _TMP_DIR.cleanup()
