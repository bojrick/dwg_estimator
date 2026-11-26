import shutil
import subprocess
from pathlib import Path
from typing import Tuple
import ezdxf
from ezdxf import recover


def find_binary(name: str) -> str:
    path = shutil.which(name)
    if path:
        return path
    for prefix in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]:
        candidate = Path(prefix) / name
        if candidate.exists():
            return str(candidate)
    raise FileNotFoundError(f"Required binary '{name}' not found in PATH or Homebrew.")


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
        if target_dxf.exists():
            target_dxf.unlink()

        cmd = [dwg2dxf_bin, "-y", "-o", str(target_dxf), str(input_path.resolve())]
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(output_dir.resolve()),
                capture_output=True,
                text=True,
                errors="replace",
                timeout=180,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"DWG conversion timed out for {input_path.name}") from exc

        # LibreDWG sometimes writes <stem>.dxf in cwd if -o behaves differently across versions
        if not (target_dxf.exists() and target_dxf.stat().st_size > 0):
            fallback = output_dir / f"{input_path.stem}.dxf"
            if fallback.exists() and fallback.stat().st_size > 0:
                target_dxf = fallback

        if not (target_dxf.exists() and target_dxf.stat().st_size > 0):
            err_msg = (proc.stderr or proc.stdout or "").strip()
            snippet = err_msg[-400:] if len(err_msg) > 400 else err_msg
            raise RuntimeError(
                f"LibreDWG dwg2dxf failed to convert {input_path.name} (exit {proc.returncode}): {snippet or 'empty output'}"
            )

        # Skip redundant recover+saveas here; load_ezdxf_doc handles recover fallback on read
        return target_dxf, "Converted DWG to DXF via LibreDWG"

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
            capture_output=True,
            text=True,
            errors="replace",
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

