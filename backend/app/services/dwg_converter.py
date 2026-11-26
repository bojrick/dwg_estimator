import contextlib
import gc
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional, Tuple
import ezdxf
from ezdxf import recover

try:
    import fcntl
except ImportError:
    fcntl = None  # type: ignore


def find_binary(name: str) -> str:
    path = shutil.which(name)
    if path:
        return path
    for prefix in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]:
        candidate = Path(prefix) / name
        if candidate.exists():
            return str(candidate)
    raise FileNotFoundError(f"Required binary '{name}' not found in PATH or Homebrew.")


@contextlib.contextmanager
def _dwg_convert_lock():
    """Serialize heavy dwg2dxf subprocesses across Gunicorn workers to prevent OOM spikes."""
    if fcntl is None:
        yield
        return
    base = Path(os.getenv("STORAGE_DIR", tempfile.gettempdir()))
    lock_path = base / ".dwg_convert.lock"
    try:
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        fh = lock_path.open("a+")
    except OSError:
        fh = (Path(tempfile.gettempdir()) / "planvault_dwg_convert.lock").open("a+")
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        fh.close()


def _run_dwg2dxf(
    dwg2dxf_bin: str,
    input_path: Path,
    output_dir: Path,
    target_dxf: Path,
    extra_args: List[str],
) -> Tuple[Optional[Path], int, str]:
    if target_dxf.exists():
        target_dxf.unlink()
    stderr_path = output_dir / ".dwg2dxf.stderr"
    cmd = [dwg2dxf_bin, "-v0", *extra_args, "-y", "-o", str(target_dxf), str(input_path.resolve())]
    try:
        with stderr_path.open("wb") as err_fh:
            proc = subprocess.run(
                cmd,
                cwd=str(output_dir.resolve()),
                stdout=subprocess.DEVNULL,
                stderr=err_fh,
                timeout=180,
            )
    except subprocess.TimeoutExpired as exc:
        stderr_path.unlink(missing_ok=True)
        raise RuntimeError(f"DWG conversion timed out for {input_path.name}") from exc

    resolved_dxf = target_dxf
    if not (resolved_dxf.exists() and resolved_dxf.stat().st_size > 0):
        fallback = output_dir / f"{input_path.stem}.dxf"
        if fallback.exists() and fallback.stat().st_size > 0:
            resolved_dxf = fallback

    if resolved_dxf.exists() and resolved_dxf.stat().st_size > 0:
        stderr_path.unlink(missing_ok=True)
        return resolved_dxf, proc.returncode, ""

    tail_text = ""
    try:
        size = stderr_path.stat().st_size
        with stderr_path.open("rb") as err_fh:
            if size > 4096:
                err_fh.seek(-4096, os.SEEK_END)
            tail_text = err_fh.read().decode("utf-8", errors="replace").strip()
    except OSError:
        pass
    finally:
        stderr_path.unlink(missing_ok=True)
    return None, proc.returncode, tail_text


def ensure_dxf(input_path: Path, output_dir: Path) -> Tuple[Path, str]:
    """
    Accepts either a .dwg or .dxf file.
    If .dwg, uses LibreDWG `dwg2dxf` to convert it to .dxf.
    Validates that `ezdxf` can read the resulting DXF (using recover.readfile fallback).
    Returns (dxf_path, status_message).
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    ext = input_path.suffix.lower()

    if ext == ".dxf":
        target_dxf = output_dir / input_path.name
        if input_path.resolve() != target_dxf.resolve():
            shutil.copy2(input_path, target_dxf)
        return target_dxf, "Direct DXF file loaded"

    if ext == ".dwg":
        dwg2dxf_bin = find_binary("dwg2dxf")
        target_dxf = (output_dir / f"{input_path.stem}.dxf").resolve()
        gc.collect()

        with _dwg_convert_lock():
            dxf_out, rc1, err1 = _run_dwg2dxf(dwg2dxf_bin, input_path, output_dir, target_dxf, [])
            if dxf_out is not None:
                return dxf_out, "Converted DWG to DXF via LibreDWG"

            # Retry with --minimal to skip CLASSES/OBJECTS dictionaries (e.g. DGN LSINTERNALCOMPONENT bloat)
            gc.collect()
            dxf_out, rc2, err2 = _run_dwg2dxf(
                dwg2dxf_bin, input_path, output_dir, target_dxf, ["--minimal"]
            )
            if dxf_out is not None:
                return dxf_out, "Converted DWG to DXF via LibreDWG (--minimal)"

            oda_bin = shutil.which("ODAFileConverter") or (
                "/usr/bin/ODAFileConverter" if Path("/usr/bin/ODAFileConverter").exists() else None
            )
            if oda_bin:
                try:
                    from ezdxf.addons import odafc

                    odafc.convert(str(input_path), str(target_dxf), replace=True)
                    if target_dxf.exists() and target_dxf.stat().st_size > 0:
                        return target_dxf, "Converted DWG to DXF via ODA File Converter"
                except Exception:
                    pass

        if rc1 == -9 or rc2 == -9:
            raise RuntimeError(
                f"DWG conversion ran out of server memory (exit -9) for {input_path.name}. "
                "This drawing likely has heavy AutoCAD proxy/DGN linestyle bloat (e.g. LSINTERNALCOMPONENT). "
                "Save as .DXF or run PURGE (DGN) in AutoCAD before uploading, or increase server RAM/swap."
            )
        err_msg = err2 or err1
        snippet = err_msg[-400:] if len(err_msg) > 400 else err_msg
        raise RuntimeError(
            f"LibreDWG dwg2dxf failed to convert {input_path.name} (exit {rc2}): {snippet or 'empty output'}"
        )

    raise ValueError(f"Unsupported CAD format '{ext}'. Please provide a .dwg or .dxf file.")


def convert_dxf_to_dwg(dxf_path: Path, dwg_path: Path) -> bool:
    """
    Uses LibreDWG `dxf2dwg` to create a binary .dwg file from a .dxf file.
    """
    try:
        dxf2dwg_bin = find_binary("dxf2dwg")
        if dwg_path.exists():
            dwg_path.unlink()
        subprocess.run(
            [dxf2dwg_bin, "-y", "-o", str(dwg_path), str(dxf_path)],
            cwd=str(dwg_path.parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
        return dwg_path.exists()
    except Exception:
        return False


def load_ezdxf_doc(dxf_path: Path):
    """Safely loads an ezdxf Document using standard readfile with recover fallback."""
    try:
        return ezdxf.readfile(str(dxf_path))
    except Exception:
        doc, _ = recover.readfile(str(dxf_path))
        return doc

