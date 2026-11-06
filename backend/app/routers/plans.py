from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
from typing import Any, Dict, List, Optional
import urllib.parse
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import TMP_WORK_DIR, get_session
from app.models.schema import Plan, User
from app.services.auth import (
    create_access_token,
    extract_bearer_token,
    get_current_user_id,
    get_optional_user_id,
    get_supabase_config,
    hash_password,
    is_auth_enabled,
    is_supabase_enabled,
    verify_password,
    verify_token,
)
from app.services.dwg_converter import ensure_dxf, load_ezdxf_doc
from app.services.dxf_parser import (
    VALID_DISCIPLINES,
    clean_raw_data_to_sheet,
    crop_dxf_file_to_bbox,
    extract_dxf_raw_entities,
    infer_discipline,
    infer_project_name,
    match_sheet_for_pdf,
    merge_dwg_views_to_single_plan,
    render_sheet_to_pdf_bytes,
)
from app.services.storage import (
    delete_object,
    get_local_cached_path,
    get_object_bytes,
    get_storage_backend_name,
    put_object,
)

router = APIRouter(prefix="/api", tags=["plans"])


class SheetUpdateRequest(BaseModel):
    id: str
    name: str
    description: Optional[str] = ""
    bbox: Optional[Dict[str, float]] = None


class RenameProjectRequest(BaseModel):
    new_name: str


class UpdatePlanRequest(BaseModel):
    name: Optional[str] = None
    project_name: Optional[str] = None
    discipline: Optional[str] = None
    active_sheet_id: Optional[str] = None
    scale_to_m: Optional[float] = None
    sheets: Optional[List[Dict[str, Any]]] = None
    structural_estimate: Optional[Dict[str, Any]] = None


class SaveStructuralEstimateRequest(BaseModel):
    structural_estimate: Dict[str, Any]


class AuthPayload(BaseModel):
    email: str
    password: str


class UpdateProfileRequest(BaseModel):
    default_unit: Optional[str] = None


def _build_summary(cleaned_raw: Dict[str, Any]) -> Dict[str, Any]:
    stats = cleaned_raw.get("cleanup_stats", {})
    return {
        "unit_name": cleaned_raw.get("unit_name", "m"),
        "scale_to_m": cleaned_raw.get("scale_to_m", 1.0),
        "layers_count": len(cleaned_raw.get("layers", [])),
        "lines_count": len(cleaned_raw.get("lines", [])),
        "polylines_count": len(cleaned_raw.get("polylines", [])),
        "texts_count": len(cleaned_raw.get("texts", [])),
        "cleaned_primitives": stats.get("cleaned_primitives", 0),
        "original_primitives": stats.get("original_primitives", 0),
        "removed_primitives": stats.get("removed_primitives", 0),
        "total_sheets_in_dwg": stats.get("total_sheets_in_dwg", 0),
        "is_cropped": stats.get("is_cropped", False),
    }


def _serialize_plan(plan: Plan) -> Dict[str, Any]:
    return {
        "id": plan.id,
        "name": plan.name,
        "project_name": plan.project_name or "Default Project",
        "discipline": plan.discipline or "architectural",
        "share_token": plan.share_token,
        "dwg_filename": plan.dwg_filename,
        "has_dwg": bool(plan.dwg_key and plan.parsed_json_key),
        "pdf_filename": plan.pdf_filename,
        "has_pdf": bool(plan.pdf_key),
        "active_sheet_id": plan.active_sheet_id,
        "active_sheet_name": plan.active_sheet_name,
        "match_reason": plan.match_reason,
        "sheets": json.loads(plan.sheets_json or "[]"),
        "summary": json.loads(plan.summary_json or "{}"),
        "structural_estimate": json.loads(getattr(plan, "structural_estimate_json", "{}") or "{}"),
        "unit_name": plan.unit_name,
        "scale_to_m": plan.scale_to_m,
        "storage_backend": plan.storage_backend,
        "created_at": plan.created_at.isoformat(),
        "updated_at": plan.updated_at.isoformat(),
    }


def _process_dwg_for_plan(
    plan: Plan,
    dwg_bytes: bytes,
    dwg_filename: str,
    pdf_bytes: Optional[bytes] = None,
    pdf_filename: str = "",
    custom_sheets: Optional[List[Dict[str, Any]]] = None,
    preferred_active_sheet_id: Optional[str] = None,
) -> Dict[str, Any]:
    work_dir = TMP_WORK_DIR / f"plan_{plan.id}"
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        safe_dwg_name = Path(dwg_filename).name
        orig_path = work_dir / safe_dwg_name
        orig_path.write_bytes(dwg_bytes)

        dxf_path, _ = ensure_dxf(orig_path, work_dir)
        doc = load_ezdxf_doc(dxf_path)
        full_raw = extract_dxf_raw_entities(dxf_path, doc=doc)

        matched_sheet = None
        reason = ""

        if custom_sheets:
            sheets_to_use = custom_sheets
            if len(sheets_to_use) == 1:
                matched_sheet = sheets_to_use[0]
                sheet_id = matched_sheet["id"]
                reason = f"User selected sheet view: {matched_sheet.get('name', 'Selected view')}"
                full_raw["sheets"] = sheets_to_use
                cleaned_raw = clean_raw_data_to_sheet(full_raw, sheet_id, custom_sheet=matched_sheet)
                cleaned_raw["sheets"] = sheets_to_use
                cleaned_raw["bbox_full"] = matched_sheet["bbox"]
                full_raw = dict(cleaned_raw)
            else:
                # 2+ sheets selected: isolate and merge only those selected sheets side-by-side, discarding all other clutter
                merged_subset = merge_dwg_views_to_single_plan(
                    sheets_to_use,
                    {"file_0": {"filename": safe_dwg_name, "raw_data": full_raw}},
                )
                full_raw = merged_subset
                sheets_to_use = full_raw.get("sheets", sheets_to_use)
                matched_sheet = None
                sheet_id = "all"
                reason = f"Merged {len(sheets_to_use)} selected sheet views"
                cleaned_raw = clean_raw_data_to_sheet(full_raw, "all")
        else:
            sheets_to_use = full_raw.get("sheets", [])
            full_raw["sheets"] = sheets_to_use
            if preferred_active_sheet_id:
                matched_sheet = next((s for s in sheets_to_use if s["id"] == preferred_active_sheet_id), None)
                if matched_sheet:
                    reason = f"User selected sheet: {matched_sheet.get('name', 'Selected view')}"

            if not matched_sheet:
                matched_sheet, reason = match_sheet_for_pdf(
                    sheets=sheets_to_use,
                    raw_texts=full_raw.get("texts", []),
                    pdf_bytes=pdf_bytes,
                    pdf_filename=pdf_filename,
                )
            sheet_id = matched_sheet["id"] if matched_sheet else None
            cleaned_raw = clean_raw_data_to_sheet(full_raw, sheet_id, custom_sheet=matched_sheet)

        # Defer cleaned DXF file export until user requests /file/dxf download
        plan.cleaned_dxf_key = None

        prefix = f"plans/plan_{plan.id}"
        plan.dwg_filename = safe_dwg_name
        plan.dwg_key = put_object(f"{prefix}/{safe_dwg_name}", dwg_bytes)
        plan.full_parsed_json_key = put_object(
            f"{prefix}/full_parsed.json",
            json.dumps(full_raw).encode("utf-8"),
            content_type="application/json",
        )
        plan.parsed_json_key = put_object(
            f"{prefix}/cleaned_parsed.json",
            json.dumps(cleaned_raw).encode("utf-8"),
            content_type="application/json",
        )

        plan.active_sheet_id = sheet_id or "all"
        plan.active_sheet_name = matched_sheet["name"] if matched_sheet else "Full Drawing View"
        plan.match_reason = reason
        plan.sheets_json = json.dumps(sheets_to_use)
        plan.unit_name = cleaned_raw.get("unit_name", "m")
        plan.scale_to_m = float(cleaned_raw.get("scale_to_m", 1.0))
        plan.summary_json = json.dumps(_build_summary(cleaned_raw))
        plan.storage_backend = get_storage_backend_name()
        return cleaned_raw
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def _resolve_uid(user_id: Any) -> Optional[str]:
    return user_id if isinstance(user_id, str) else None


def _get_owned_plan(session: Session, plan_id: int, user_id: Optional[str]) -> Plan:
    uid = _resolve_uid(user_id)
    plan = session.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if uid:
        if plan.user_id and plan.user_id != uid:
            raise HTTPException(status_code=404, detail="Plan not found")
        if plan.user_id is None:
            plan.user_id = uid
            session.add(plan)
            session.commit()
    return plan


@router.get("/auth/config")
def get_auth_config():
    cfg = get_supabase_config()
    return {
        "enabled": True,
        "type": "foss",
        "supabase_enabled": is_supabase_enabled(),
        "supabase_url": cfg["url"],
        "supabase_anon_key": cfg["anon_key"],
    }


@router.post("/auth/signup")
def auth_signup(payload: AuthPayload, session: Session = Depends(get_session)):
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email address is required")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists")

    pwd_hash, salt = hash_password(payload.password)
    user = User(email=email, password_hash=pwd_hash, salt=salt, default_unit="m")
    session.add(user)
    session.commit()
    session.refresh(user)

    token = create_access_token(user.id, user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "default_unit": user.default_unit,
        },
    }


@router.post("/auth/signin")
def auth_signin(payload: AuthPayload, session: Session = Depends(get_session)):
    email = payload.email.strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if not user or not verify_password(payload.password, user.salt, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(user.id, user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "default_unit": user.default_unit,
        },
    }


@router.get("/auth/me")
def get_auth_profile(
    session: Session = Depends(get_session),
    user_id: str = Depends(get_current_user_id),
):
    user = session.get(User, user_id)
    if not user:
        if not is_supabase_enabled():
            raise HTTPException(status_code=401, detail="User account not found, please sign in again")
        return {"id": user_id, "email": "", "default_unit": "m"}
    return {
        "id": user.id,
        "email": user.email,
        "default_unit": user.default_unit,
    }


@router.patch("/auth/profile")
def update_auth_profile(
    req: UpdateProfileRequest,
    session: Session = Depends(get_session),
    user_id: str = Depends(get_current_user_id),
):
    user = session.get(User, user_id)
    if not user:
        # Create minimal user record if it was a Supabase ID
        user = User(id=user_id, email="", password_hash="", salt="", default_unit="m")
        session.add(user)
    if req.default_unit and req.default_unit in ("m", "mm", "ft", "in"):
        user.default_unit = req.default_unit
        user.updated_at = datetime.now(timezone.utc)
        session.add(user)
        session.commit()
        session.refresh(user)
    return {
        "id": user.id,
        "email": user.email,
        "default_unit": user.default_unit,
    }


@router.post("/plans/preview-guest")
async def preview_guest_cad(
    dwg_file: UploadFile = File(...),
):
    if not dwg_file.filename:
        raise HTTPException(status_code=400, detail="CAD file is required")
    ext = Path(dwg_file.filename).suffix.lower()
    if ext not in (".dwg", ".dxf"):
        raise HTTPException(status_code=400, detail="CAD file must be .dwg or .dxf")

    dwg_bytes = await dwg_file.read()
    temp_dir = Path(TMP_WORK_DIR) / f"guest_{datetime.now(timezone.utc).timestamp()}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    in_path = temp_dir / Path(dwg_file.filename).name
    in_path.write_bytes(dwg_bytes)

    try:
        dxf_path, _ = ensure_dxf(in_path, temp_dir)
        doc = load_ezdxf_doc(dxf_path)
        raw_data = extract_dxf_raw_entities(dxf_path, doc=doc)
        cleaned_raw = clean_raw_data_to_sheet(raw_data, None)
        summary = _build_summary(cleaned_raw)

        return {
            "name": Path(dwg_file.filename).stem.replace("_", " ").strip(),
            "dwg_filename": Path(dwg_file.filename).name,
            "raw_data": cleaned_raw,
            "summary": summary,
            "sheets": cleaned_raw.get("sheets", []),
            "unit_name": cleaned_raw.get("unit_name", "m"),
            "scale_to_m": cleaned_raw.get("scale_to_m", 1.0),
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/plans/preview-multi")
async def preview_multi_cad(
    dwg_files: List[UploadFile] = File(...),
):
    valid_files = [f for f in dwg_files if f.filename and Path(f.filename).suffix.lower() in (".dwg", ".dxf")]
    if not valid_files:
        raise HTTPException(status_code=400, detail="At least one .dwg or .dxf file is required")

    temp_dir = Path(TMP_WORK_DIR) / f"multi_preview_{datetime.now(timezone.utc).timestamp()}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    out_files = []
    try:
        for idx, f in enumerate(valid_files):
            f_bytes = await f.read()
            f_name = Path(f.filename).name
            in_path = temp_dir / f_name
            in_path.write_bytes(f_bytes)
            dxf_path, _ = ensure_dxf(in_path, temp_dir)
            doc = load_ezdxf_doc(dxf_path)
            raw_data = extract_dxf_raw_entities(dxf_path, doc=doc)
            cleaned_raw = clean_raw_data_to_sheet(raw_data, None)
            summary = _build_summary(cleaned_raw)
            file_id = f"file_{idx}"
            out_files.append({
                "file_id": file_id,
                "fileId": file_id,
                "filename": f_name,
                "name": Path(f.filename).stem.replace("_", " ").strip(),
                "raw_data": cleaned_raw,
                "rawData": cleaned_raw,
                "summary": summary,
                "sheets": [
                    {
                        **s,
                        "id": f"{file_id}__{s.get('id', f'sheet_{s_idx + 1}')}",
                        "file_id": file_id,
                        "source_file": f_name,
                    }
                    for s_idx, s in enumerate(cleaned_raw.get("sheets", []))
                ],
                "unit_name": cleaned_raw.get("unit_name", "m"),
                "scale_to_m": cleaned_raw.get("scale_to_m", 1.0),
            })
        return {"files": out_files}
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/plans/merge-preview")
async def merge_preview_cad(
    dwg_files: List[UploadFile] = File(...),
    sheets_json: str = Form(...),
    active_sheet_id: Optional[str] = Form(None),
):
    valid_files = [f for f in dwg_files if f.filename and Path(f.filename).suffix.lower() in (".dwg", ".dxf")]
    if not valid_files:
        raise HTTPException(status_code=400, detail="At least one .dwg or .dxf file is required")

    try:
        selected_sheets = json.loads(sheets_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid sheets_json format")

    temp_dir = Path(TMP_WORK_DIR) / f"merge_preview_{datetime.now(timezone.utc).timestamp()}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    files_data = {}
    try:
        for idx, f in enumerate(valid_files):
            f_bytes = await f.read()
            f_name = Path(f.filename).name
            in_path = temp_dir / f_name
            in_path.write_bytes(f_bytes)
            dxf_path, _ = ensure_dxf(in_path, temp_dir)
            doc = load_ezdxf_doc(dxf_path)
            raw_data = extract_dxf_raw_entities(dxf_path, doc=doc)
            cleaned_raw = clean_raw_data_to_sheet(raw_data, None)
            file_id = f"file_{idx}"
            files_data[file_id] = {
                "file_id": file_id,
                "filename": f_name,
                "raw_data": cleaned_raw,
            }
            files_data[f_name] = files_data[file_id]

        merged_full = merge_dwg_views_to_single_plan(selected_sheets, files_data)
        merged_sheets = merged_full.get("sheets", [])
        target_sheet_id = merged_sheets[0]["id"] if len(merged_sheets) == 1 else "all"
        cleaned_raw = clean_raw_data_to_sheet(merged_full, target_sheet_id)
        summary = _build_summary(cleaned_raw)

        return {
            "name": "Merged CAD Plan",
            "raw_data": cleaned_raw,
            "full_raw_data": merged_full,
            "summary": summary,
            "sheets": merged_sheets,
            "active_sheet_id": target_sheet_id,
            "unit_name": "m",
            "scale_to_m": 1.0,
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.get("/plans")
def list_plans(
    session: Session = Depends(get_session),
    user_id: Optional[str] = Depends(get_current_user_id),
):
    uid = _resolve_uid(user_id)
    if uid:
        # Claim pre-auth legacy plans for the user signing in
        unclaimed = session.exec(select(Plan).where(Plan.user_id == None)).all()  # noqa: E711
        for p in unclaimed:
            p.user_id = uid
            session.add(p)
        if unclaimed:
            session.commit()
        stmt = select(Plan).where((Plan.user_id == uid) | (Plan.user_id == None)).order_by(Plan.updated_at.desc())
    else:
        stmt = select(Plan).order_by(Plan.updated_at.desc())

    plans = session.exec(stmt).all()
    projects = sorted({p.project_name or "Default Project" for p in plans})
    return {
        "storage_backend": get_storage_backend_name(),
        "projects": projects,
        "plans": [_serialize_plan(p) for p in plans],
    }


@router.post("/plans")
async def create_plan(
    dwg_files: Optional[List[UploadFile]] = File(None),
    dwg_file: Optional[UploadFile] = File(None),
    pdf_file: Optional[UploadFile] = File(None),
    name: Optional[str] = Form(None),
    project_name: Optional[str] = Form(None),
    discipline: Optional[str] = Form(None),
    sheets_json: Optional[str] = Form(None),
    active_sheet_id: Optional[str] = Form(None),
    session: Session = Depends(get_session),
    user_id: Optional[str] = Depends(get_current_user_id),
):
    uid = _resolve_uid(user_id)
    collected_dwgs: List[UploadFile] = []
    if dwg_files:
        collected_dwgs.extend([f for f in dwg_files if f and f.filename])
    if dwg_file and dwg_file.filename and dwg_file not in collected_dwgs:
        collected_dwgs.append(dwg_file)

    if not collected_dwgs and not pdf_file:
        raise HTTPException(status_code=400, detail="Please upload a DWG/DXF file, a PDF file, or both.")

    dwg_name = ""
    for f in collected_dwgs:
        ext = Path(f.filename).suffix.lower()
        if ext not in (".dwg", ".dxf"):
            raise HTTPException(status_code=400, detail=f"CAD file {f.filename} must be .dwg or .dxf")
    if collected_dwgs:
        dwg_name = Path(collected_dwgs[0].filename).name

    pdf_bytes: Optional[bytes] = None
    pdf_name = ""
    if pdf_file and pdf_file.filename:
        ext = Path(pdf_file.filename).suffix.lower()
        if ext != ".pdf":
            raise HTTPException(status_code=400, detail="Associated document must be a .pdf file")
        pdf_name = Path(pdf_file.filename).name
        pdf_bytes = await pdf_file.read()

    default_title = (
        (name or "").strip()
        or Path(pdf_name or dwg_name).stem.replace("_", " ").strip()
        or "Untitled Plan"
    )

    proj_stmt = select(Plan).where(Plan.user_id == uid) if uid else select(Plan)
    existing_projects = [
        p.project_name
        for p in session.exec(proj_stmt).all()
        if p.project_name and p.project_name != "Default Project"
    ]
    resolved_project = (
        (project_name or "").strip()
        or infer_project_name(dwg_name or pdf_name or default_title, existing_projects)
    )
    raw_disc = (discipline or "").strip().lower()
    resolved_discipline = (
        raw_disc
        if raw_disc in VALID_DISCIPLINES
        else infer_discipline(dwg_name, pdf_name, default_title)
    )

    plan = Plan(
        user_id=uid,
        name=default_title,
        project_name=resolved_project,
        discipline=resolved_discipline,
        storage_backend=get_storage_backend_name(),
    )
    session.add(plan)
    session.commit()
    session.refresh(plan)

    prefix = f"plans/plan_{plan.id}"
    cleaned_raw: Optional[Dict[str, Any]] = None

    try:
        if pdf_bytes:
            plan.pdf_filename = pdf_name
            plan.pdf_key = put_object(f"{prefix}/{pdf_name}", pdf_bytes, content_type="application/pdf")

        if len(collected_dwgs) > 1:
            temp_dir = Path(TMP_WORK_DIR) / f"plan_{plan.id}_merge_{datetime.now(timezone.utc).timestamp()}"
            temp_dir.mkdir(parents=True, exist_ok=True)
            try:
                files_data = {}
                for idx, f in enumerate(collected_dwgs):
                    f_bytes = await f.read()
                    f_name = Path(f.filename).name
                    f_path = temp_dir / f_name
                    f_path.write_bytes(f_bytes)
                    dxf_path, _ = ensure_dxf(f_path, temp_dir)
                    doc = load_ezdxf_doc(dxf_path)
                    raw_entities = extract_dxf_raw_entities(dxf_path, doc=doc)
                    cleaned_entities = clean_raw_data_to_sheet(raw_entities, None)
                    file_id = f"file_{idx}"
                    files_data[file_id] = {
                        "file_id": file_id,
                        "filename": f_name,
                        "raw_data": cleaned_entities,
                        "bytes": f_bytes,
                    }
                    files_data[f_name] = files_data[file_id]

                custom_sheets_parsed = []
                if sheets_json and sheets_json.strip():
                    try:
                        custom_sheets_parsed = json.loads(sheets_json)
                    except Exception:
                        pass
                if not custom_sheets_parsed:
                    for f_id, f_data in files_data.items():
                        if not f_id.startswith("file_"):
                            continue
                        for s in f_data["raw_data"].get("sheets", []):
                            custom_sheets_parsed.append({
                                **s,
                                "source_file": f_data["filename"],
                                "file_id": f_id,
                            })

                merged_full_raw = merge_dwg_views_to_single_plan(custom_sheets_parsed, files_data)
                merged_sheets = merged_full_raw.get("sheets", [])
                target_sheet_id = merged_sheets[0]["id"] if len(merged_sheets) == 1 else "all"
                cleaned_raw = clean_raw_data_to_sheet(merged_full_raw, target_sheet_id)

                primary_name = collected_dwgs[0].filename
                plan.dwg_filename = f"{len(collected_dwgs)} DWG Files ({primary_name} + {len(collected_dwgs)-1} others)"
                plan.dwg_key = put_object(f"{prefix}/{primary_name}", files_data["file_0"]["bytes"])
                for f_id, f_data in files_data.items():
                    if f_id.startswith("file_"):
                        put_object(f"{prefix}/sources/{f_data['filename']}", f_data["bytes"])

                plan.full_parsed_json_key = put_object(
                    f"{prefix}/full_parsed.json",
                    json.dumps(merged_full_raw).encode("utf-8"),
                    content_type="application/json",
                )
                plan.parsed_json_key = put_object(
                    f"{prefix}/cleaned_parsed.json",
                    json.dumps(cleaned_raw).encode("utf-8"),
                    content_type="application/json",
                )
                active_sheet = cleaned_raw.get("active_sheet")
                plan.active_sheet_id = active_sheet["id"] if active_sheet else "all"
                plan.active_sheet_name = active_sheet["name"] if active_sheet else f"Merged ({len(merged_sheets)} Views)"
                plan.match_reason = f"Merged {len(merged_sheets)} views from {len(collected_dwgs)} DWG files"
                plan.sheets_json = json.dumps(merged_sheets)
                plan.unit_name = "m"
                plan.scale_to_m = 1.0
                plan.summary_json = json.dumps(_build_summary(cleaned_raw))
                plan.storage_backend = get_storage_backend_name()
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)
        elif len(collected_dwgs) == 1:
            dwg_f = collected_dwgs[0]
            dwg_bytes = await dwg_f.read()
            dwg_name = Path(dwg_f.filename).name
            custom_sheets_parsed = None
            if sheets_json and sheets_json.strip():
                try:
                    custom_sheets_parsed = json.loads(sheets_json)
                except Exception:
                    pass

            cleaned_raw = _process_dwg_for_plan(
                plan=plan,
                dwg_bytes=dwg_bytes,
                dwg_filename=dwg_name,
                pdf_bytes=pdf_bytes,
                pdf_filename=pdf_name,
                custom_sheets=custom_sheets_parsed,
                preferred_active_sheet_id=active_sheet_id,
            )
            if not (name or "").strip() and plan.active_sheet_name and plan.active_sheet_name != "Full Drawing View":
                plan.name = plan.active_sheet_name

        plan.updated_at = datetime.now(timezone.utc)
        session.add(plan)
        session.commit()
        session.refresh(plan)
    except Exception as exc:
        session.delete(plan)
        session.commit()
        raise HTTPException(status_code=400, detail=str(exc))

    return {
        "plan": _serialize_plan(plan),
        "raw": cleaned_raw,
    }


def _load_plan_payload(plan: Plan) -> Dict[str, Any]:
    raw_data = None
    if plan.parsed_json_key:
        try:
            raw_data = json.loads(get_object_bytes(plan.parsed_json_key).decode("utf-8"))
        except Exception:
            raw_data = None
    return {
        "plan": _serialize_plan(plan),
        "raw": raw_data,
    }


@router.get("/plans/{plan_id}")
def get_plan(
    plan_id: int,
    session: Session = Depends(get_session),
    user_id: Optional[str] = Depends(get_current_user_id),
):
    plan = _get_owned_plan(session, plan_id, user_id)
    return _load_plan_payload(plan)


@router.get("/plans/share/{share_token}")
def get_shared_plan(share_token: str, session: Session = Depends(get_session)):
    plan = session.exec(select(Plan).where(Plan.share_token == share_token)).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Shared plan link not found")
    return _load_plan_payload(plan)


@router.post("/plans/{plan_id}/pdf")
async def attach_or_replace_pdf(
    plan_id: int,
    pdf_file: UploadFile = File(...),
    session: Session = Depends(get_session),
    user_id: Optional[str] = Depends(get_current_user_id),
):
    """Uploads or replaces the associated PDF for a Plan and re-cleans the DWG to match the PDF view."""
    plan = _get_owned_plan(session, plan_id, user_id)

    if not pdf_file.filename or Path(pdf_file.filename).suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="Please upload a valid .pdf file")

    pdf_name = Path(pdf_file.filename).name
    pdf_bytes = await pdf_file.read()
    prefix = f"plans/plan_{plan.id}"

    if plan.pdf_key and plan.pdf_key != f"{prefix}/{pdf_name}":
        delete_object(plan.pdf_key)

    plan.pdf_filename = pdf_name
    plan.pdf_key = put_object(f"{prefix}/{pdf_name}", pdf_bytes, content_type="application/pdf")

    cleaned_raw = None
    if plan.full_parsed_json_key:
        try:
            full_raw = json.loads(get_object_bytes(plan.full_parsed_json_key).decode("utf-8"))
            matched_sheet, reason = match_sheet_for_pdf(
                sheets=full_raw.get("sheets", []),
                raw_texts=full_raw.get("texts", []),
                pdf_bytes=pdf_bytes,
                pdf_filename=pdf_name,
            )
            sheet_id = matched_sheet["id"] if matched_sheet else plan.active_sheet_id
            cleaned_raw = clean_raw_data_to_sheet(full_raw, sheet_id, override_scale_to_m=plan.scale_to_m)
            plan.parsed_json_key = put_object(
                f"{prefix}/cleaned_parsed.json",
                json.dumps(cleaned_raw).encode("utf-8"),
                content_type="application/json",
            )
            if matched_sheet:
                plan.active_sheet_id = matched_sheet["id"]
                plan.active_sheet_name = matched_sheet["name"]
            plan.match_reason = reason
            plan.summary_json = json.dumps(_build_summary(cleaned_raw))
        except Exception:
            pass

    plan.updated_at = datetime.now(timezone.utc)
    session.add(plan)
    session.commit()
    session.refresh(plan)
    return {
        "plan": _serialize_plan(plan),
        "raw": cleaned_raw,
    }


@router.post("/plans/{plan_id}/dwg")
async def attach_or_replace_dwg(
    plan_id: int,
    dwg_file: UploadFile = File(...),
    session: Session = Depends(get_session),
    user_id: Optional[str] = Depends(get_current_user_id),
):
    """Uploads or replaces the DWG/DXF file for a Plan and cleans it to match the associated PDF."""
    plan = _get_owned_plan(session, plan_id, user_id)

    if not dwg_file.filename or Path(dwg_file.filename).suffix.lower() not in (".dwg", ".dxf"):
        raise HTTPException(status_code=400, detail="Please upload a .dwg or .dxf file")

    dwg_name = Path(dwg_file.filename).name
    dwg_bytes = await dwg_file.read()

    pdf_bytes = None
    if plan.pdf_key:
        try:
            pdf_bytes = get_object_bytes(plan.pdf_key)
        except Exception:
            pdf_bytes = None

    try:
        cleaned_raw = _process_dwg_for_plan(
            plan=plan,
            dwg_bytes=dwg_bytes,
            dwg_filename=dwg_name,
            pdf_bytes=pdf_bytes,
            pdf_filename=plan.pdf_filename or "",
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    plan.updated_at = datetime.now(timezone.utc)
    session.add(plan)
    session.commit()
    session.refresh(plan)
    return {
        "plan": _serialize_plan(plan),
        "raw": cleaned_raw,
    }


@router.post("/plans/{plan_id}/generate-pdf")
def generate_associated_pdf_from_dwg(
    plan_id: int,
    session: Session = Depends(get_session),
    user_id: Optional[str] = Depends(get_current_user_id),
):
    """Generates a clean vector PDF matching the isolated DWG sheet when the user hasn't uploaded one yet."""
    plan = _get_owned_plan(session, plan_id, user_id)
    if not plan.parsed_json_key:
        raise HTTPException(status_code=404, detail="Plan DWG data not found")

    cleaned_raw = json.loads(get_object_bytes(plan.parsed_json_key).decode("utf-8"))
    pdf_bytes = render_sheet_to_pdf_bytes(cleaned_raw, plan.active_sheet_name or plan.name)
    safe_stem = "".join(c if c.isalnum() or c in " -_" else "_" for c in (plan.active_sheet_name or plan.name)).strip()
    pdf_name = f"{safe_stem or 'Plan_View'}.pdf"
    prefix = f"plans/plan_{plan.id}"

    plan.pdf_filename = pdf_name
    plan.pdf_key = put_object(f"{prefix}/{pdf_name}", pdf_bytes, content_type="application/pdf")
    plan.updated_at = datetime.now(timezone.utc)
    session.add(plan)
    session.commit()
    session.refresh(plan)
    return {"plan": _serialize_plan(plan)}


@router.patch("/plans/{plan_id}")
def update_plan_view_or_units(
    plan_id: int,
    req: UpdatePlanRequest,
    session: Session = Depends(get_session),
    user_id: Optional[str] = Depends(get_current_user_id),
):
    """Updates plan name, switches which sheet view from the DWG is isolated, or calibrates measurement units."""
    plan = _get_owned_plan(session, plan_id, user_id)

    if req.name is not None and req.name.strip():
        plan.name = req.name.strip()
    if req.project_name is not None and req.project_name.strip():
        plan.project_name = req.project_name.strip()
    if req.discipline is not None and req.discipline.strip().lower() in VALID_DISCIPLINES:
        plan.discipline = req.discipline.strip().lower()
    if req.sheets is not None:
        plan.sheets_json = json.dumps(req.sheets)
    if req.structural_estimate is not None:
        plan.structural_estimate_json = json.dumps(req.structural_estimate)

    cleaned_raw = None
    if (req.sheets is not None or req.active_sheet_id is not None or req.scale_to_m is not None) and plan.full_parsed_json_key:
        full_raw = json.loads(get_object_bytes(plan.full_parsed_json_key).decode("utf-8"))
        if req.sheets is not None:
            full_raw["sheets"] = req.sheets
            prefix = f"plans/plan_{plan.id}"
            plan.full_parsed_json_key = put_object(
                f"{prefix}/full_parsed.json",
                json.dumps(full_raw).encode("utf-8"),
                content_type="application/json",
            )

        target_sheet_id = req.active_sheet_id if req.active_sheet_id is not None else plan.active_sheet_id
        target_scale = req.scale_to_m if req.scale_to_m is not None else plan.scale_to_m

        cleaned_raw = clean_raw_data_to_sheet(
            full_raw,
            sheet_id=target_sheet_id,
            override_scale_to_m=target_scale,
        )
        prefix = f"plans/plan_{plan.id}"
        plan.parsed_json_key = put_object(
            f"{prefix}/cleaned_parsed.json",
            json.dumps(cleaned_raw).encode("utf-8"),
            content_type="application/json",
        )
        active_sheet = cleaned_raw.get("active_sheet")
        plan.active_sheet_id = active_sheet["id"] if active_sheet else "all"
        plan.active_sheet_name = active_sheet["name"] if active_sheet else "Full Uncropped Modelspace"
        if req.active_sheet_id is not None or req.sheets is not None:
            plan.cleaned_dxf_key = None
            plan.match_reason = (
                f"Isolated view: {active_sheet['name']}"
                if active_sheet
                else "Showing full uncropped DWG modelspace"
            )
        plan.unit_name = cleaned_raw.get("unit_name", plan.unit_name)
        plan.scale_to_m = float(cleaned_raw.get("scale_to_m", plan.scale_to_m))
        plan.summary_json = json.dumps(_build_summary(cleaned_raw))

    plan.updated_at = datetime.now(timezone.utc)
    session.add(plan)
    session.commit()
    session.refresh(plan)

    if cleaned_raw is None and plan.parsed_json_key:
        cleaned_raw = json.loads(get_object_bytes(plan.parsed_json_key).decode("utf-8"))

    return {
        "plan": _serialize_plan(plan),
        "raw": cleaned_raw,
    }


@router.get("/plans/{plan_id}/structural-estimate")
def get_structural_estimate(
    plan_id: int,
    share: Optional[str] = None,
    session: Session = Depends(get_session),
    user_id: Optional[str] = Depends(get_current_user_id),
):
    if share:
        plan = session.exec(select(Plan).where(Plan.id == plan_id, Plan.share_token == share)).first()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
    else:
        plan = _get_owned_plan(session, plan_id, user_id)
    return {
        "plan_id": plan.id,
        "structural_estimate": json.loads(getattr(plan, "structural_estimate_json", "{}") or "{}"),
    }


@router.put("/plans/{plan_id}/structural-estimate")
def save_structural_estimate(
    plan_id: int,
    req: SaveStructuralEstimateRequest,
    session: Session = Depends(get_session),
    user_id: Optional[str] = Depends(get_current_user_id),
):
    plan = _get_owned_plan(session, plan_id, user_id)
    plan.structural_estimate_json = json.dumps(req.structural_estimate)
    plan.updated_at = datetime.now(timezone.utc)
    session.add(plan)
    session.commit()
    session.refresh(plan)
    return {
        "status": "ok",
        "plan_id": plan.id,
        "structural_estimate": json.loads(plan.structural_estimate_json or "{}"),
        "updated_at": plan.updated_at.isoformat(),
    }


@router.get("/plans/{plan_id}/file/{kind}")
def get_plan_file(
    plan_id: int,
    kind: str,
    share: Optional[str] = None,
    token: Optional[str] = None,
    authorization: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
):
    plan = session.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    if is_auth_enabled() and not (share and share == plan.share_token):
        raw_token = extract_bearer_token(authorization if isinstance(authorization, str) else None) or token
        if not raw_token:
            raise HTTPException(status_code=401, detail="Authentication required")
        uid = verify_supabase_token(raw_token)["id"]
        if plan.user_id and plan.user_id != uid:
            raise HTTPException(status_code=404, detail="Plan not found")

    if kind == "pdf":
        if not plan.pdf_key:
            raise HTTPException(status_code=404, detail="No PDF attached to this plan")
        path = get_local_cached_path(plan.pdf_key)
        return FileResponse(
            str(path),
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{plan.pdf_filename or "plan.pdf"}"'},
        )
    if kind == "dwg":
        if not plan.dwg_key:
            raise HTTPException(status_code=404, detail="No DWG attached to this plan")
        path = get_local_cached_path(plan.dwg_key)
        return FileResponse(str(path), filename=plan.dwg_filename or path.name)
    if kind == "dxf":
        if not plan.cleaned_dxf_key and plan.dwg_key:
            work_dir = TMP_WORK_DIR / f"dxf_export_{plan.id}"
            work_dir.mkdir(parents=True, exist_ok=True)
            try:
                dwg_src = get_local_cached_path(plan.dwg_key)
                dxf_path, _ = ensure_dxf(dwg_src, work_dir)
                cleaned_dxf_path = work_dir / f"plan_{plan.id}_cleaned.dxf"
                sheets = json.loads(plan.sheets_json or "[]")
                matched = next((s for s in sheets if s.get("id") == plan.active_sheet_id), None)
                if matched and matched.get("bbox"):
                    crop_dxf_file_to_bbox(dxf_path, cleaned_dxf_path, matched["bbox"])
                else:
                    shutil.copy2(dxf_path, cleaned_dxf_path)
                plan.cleaned_dxf_key = put_object(
                    f"plans/plan_{plan.id}/cleaned_view.dxf",
                    cleaned_dxf_path.read_bytes(),
                    content_type="application/dxf",
                )
                session.add(plan)
                session.commit()
            finally:
                shutil.rmtree(work_dir, ignore_errors=True)
        if not plan.cleaned_dxf_key:
            raise HTTPException(status_code=404, detail="No cleaned DXF available")
        path = get_local_cached_path(plan.cleaned_dxf_key)
        stem = Path(plan.dwg_filename or "plan").stem
        return FileResponse(str(path), filename=f"{stem}_cleaned.dxf")

    raise HTTPException(status_code=400, detail="Unsupported file kind")


@router.delete("/plans/{plan_id}")
def delete_plan(
    plan_id: int,
    session: Session = Depends(get_session),
    user_id: Optional[str] = Depends(get_current_user_id),
):
    plan = _get_owned_plan(session, plan_id, user_id)

    for key in (
        plan.dwg_key,
        plan.cleaned_dxf_key,
        plan.full_parsed_json_key,
        plan.parsed_json_key,
        plan.pdf_key,
    ):
        delete_object(key)

    session.delete(plan)
    session.commit()
    return {"deleted": True, "id": plan_id}


@router.patch("/projects/{project_name}")
def rename_project(
    project_name: str,
    req: RenameProjectRequest,
    session: Session = Depends(get_session),
    user_id: Optional[str] = Depends(get_current_user_id),
):
    uid = _resolve_uid(user_id)
    decoded_name = urllib.parse.unquote(project_name).strip()
    new_name = req.new_name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty")

    if uid:
        stmt = select(Plan).where((Plan.project_name == decoded_name) & ((Plan.user_id == uid) | (Plan.user_id == None)))
    else:
        stmt = select(Plan).where(Plan.project_name == decoded_name)
    plans = session.exec(stmt).all()
    if not plans:
        raise HTTPException(status_code=404, detail="Project not found or contains no plans")

    for p in plans:
        p.project_name = new_name
        p.updated_at = datetime.now(timezone.utc)
        session.add(p)
    session.commit()
    return {"renamed": True, "old_name": decoded_name, "new_name": new_name, "count": len(plans)}


@router.delete("/projects/{project_name}")
def delete_project(
    project_name: str,
    session: Session = Depends(get_session),
    user_id: Optional[str] = Depends(get_current_user_id),
):
    uid = _resolve_uid(user_id)
    decoded_name = urllib.parse.unquote(project_name).strip()

    if uid:
        stmt = select(Plan).where((Plan.project_name == decoded_name) & ((Plan.user_id == uid) | (Plan.user_id == None)))
    else:
        stmt = select(Plan).where(Plan.project_name == decoded_name)
    plans = session.exec(stmt).all()
    if not plans:
        raise HTTPException(status_code=404, detail="Project not found or contains no plans")

    count = len(plans)
    for plan in plans:
        for key in (
            plan.dwg_key,
            plan.cleaned_dxf_key,
            plan.full_parsed_json_key,
            plan.parsed_json_key,
            plan.pdf_key,
        ):
            delete_object(key)
        session.delete(plan)

    session.commit()
    return {"deleted": True, "project_name": decoded_name, "count": count}


