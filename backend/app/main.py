from contextlib import asynccontextmanager
import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from app.database import CLOUD_FALLBACK_DIR, engine, init_db
from app.models.schema import Plan
from app.routers.plans import _build_summary, router as plans_router
from app.services.dxf_parser import (
    clean_raw_data_to_sheet,
    crop_dxf_file_to_bbox,
    match_sheet_for_pdf,
    render_sheet_to_pdf_bytes,
)
from app.services.storage import get_storage_backend_name, put_object


def seed_preserved_plan_if_empty() -> None:
    preserve_dir = CLOUD_FALLBACK_DIR / "seed_preserve"
    dwg_path = preserve_dir / "1086 mansa  BLOCK - A+B   working plan.dwg"
    dxf_path = preserve_dir / "1086 mansa  BLOCK - A+B   working plan_clean.dxf"
    parsed_path = preserve_dir / "plan_6_parsed.json"
    if not (dwg_path.exists() and dxf_path.exists() and parsed_path.exists()):
        return

    with Session(engine) as session:
        if session.exec(select(Plan)).first():
            return

        full_raw = json.loads(parsed_path.read_text())
        sheets = full_raw.get("sheets", [])
        # Pick Ground Floor Working Plan (sheet_19) and generate its associated PDF
        ground_sheet = next(
            (s for s in sheets if "GROUND FLOOR" in s["name"].upper()),
            sheets[0] if sheets else None,
        )
        sheet_id = ground_sheet["id"] if ground_sheet else None
        cleaned_raw = clean_raw_data_to_sheet(full_raw, sheet_id)
        pdf_bytes = render_sheet_to_pdf_bytes(
            cleaned_raw,
            ground_sheet["name"] if ground_sheet else "1086 Mansa Working Plan",
        )
        pdf_name = "1086_Mansa_GROUND_FLOOR_WORKING_PLAN_BLOCK_A+B.pdf"

        matched_sheet, reason = match_sheet_for_pdf(
            sheets=sheets,
            raw_texts=full_raw.get("texts", []),
            pdf_bytes=pdf_bytes,
            pdf_filename=pdf_name,
        )

        plan = Plan(
            name=matched_sheet["name"] if matched_sheet else "1086 Mansa Working Plan",
            dwg_filename=dwg_path.name,
            pdf_filename=pdf_name,
            active_sheet_id=matched_sheet["id"] if matched_sheet else "all",
            active_sheet_name=matched_sheet["name"] if matched_sheet else "Full View",
            match_reason=reason,
            sheets_json=json.dumps(sheets),
            summary_json=json.dumps(_build_summary(cleaned_raw)),
            unit_name=cleaned_raw.get("unit_name", "m"),
            scale_to_m=float(cleaned_raw.get("scale_to_m", 1.0)),
            storage_backend=get_storage_backend_name(),
        )
        session.add(plan)
        session.commit()
        session.refresh(plan)

        prefix = f"plans/plan_{plan.id}"
        cropped_dxf_tmp = preserve_dir / "seeded_cropped.dxf"
        if matched_sheet:
            crop_dxf_file_to_bbox(dxf_path, cropped_dxf_tmp, matched_sheet["bbox"])
        else:
            cropped_dxf_tmp = dxf_path

        plan.dwg_key = put_object(f"{prefix}/{dwg_path.name}", dwg_path.read_bytes())
        plan.cleaned_dxf_key = put_object(
            f"{prefix}/cleaned_view.dxf",
            cropped_dxf_tmp.read_bytes(),
            content_type="application/dxf",
        )
        plan.full_parsed_json_key = put_object(
            f"{prefix}/full_parsed.json",
            parsed_path.read_bytes(),
            content_type="application/json",
        )
        plan.parsed_json_key = put_object(
            f"{prefix}/cleaned_parsed.json",
            json.dumps(cleaned_raw).encode("utf-8"),
            content_type="application/json",
        )
        plan.pdf_key = put_object(f"{prefix}/{pdf_name}", pdf_bytes, content_type="application/pdf")

        session.add(plan)
        session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_preserved_plan_if_empty()
    yield


app = FastAPI(
    title="Plan Vault PWA API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(plans_router)


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "service": "plan-vault-pwa",
        "storage_backend": get_storage_backend_name(),
    }
