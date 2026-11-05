import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import inspect, text
from sqlmodel import SQLModel, Session, create_engine, select

BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / "backend" / ".env")
load_dotenv(BASE_DIR / ".env")

STORAGE_DIR = Path(os.getenv("STORAGE_DIR", str(BASE_DIR / "storage")))
CLOUD_FALLBACK_DIR = STORAGE_DIR / "cloud"
TMP_WORK_DIR = STORAGE_DIR / "tmp"

STORAGE_DIR.mkdir(parents=True, exist_ok=True)
CLOUD_FALLBACK_DIR.mkdir(parents=True, exist_ok=True)
TMP_WORK_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = STORAGE_DIR / "plan_vault.db"
_raw_db_url = (os.getenv("DATABASE_URL") or "").strip()
if _raw_db_url.startswith("postgres://"):
    _raw_db_url = "postgresql://" + _raw_db_url[len("postgres://") :]
DATABASE_URL = _raw_db_url or f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    pool_pre_ping=not DATABASE_URL.startswith("sqlite"),
    echo=False,
)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    with engine.begin() as conn:
        cols = {c["name"] for c in inspect(conn).get_columns("plan")}
        if "project_name" not in cols:
            conn.execute(text("ALTER TABLE plan ADD COLUMN project_name VARCHAR NOT NULL DEFAULT 'Default Project'"))
        if "discipline" not in cols:
            conn.execute(text("ALTER TABLE plan ADD COLUMN discipline VARCHAR NOT NULL DEFAULT 'architectural'"))
        if "user_id" not in cols:
            conn.execute(text("ALTER TABLE plan ADD COLUMN user_id VARCHAR"))

    from app.models.schema import Plan
    from app.services.dxf_parser import infer_discipline, infer_project_name

    with Session(engine) as session:
        plans = session.exec(select(Plan).order_by(Plan.id)).all()
        known_projects = [p.project_name for p in plans if p.project_name and p.project_name != "Default Project"]
        dirty = False
        for p in plans:
            src_name = p.dwg_filename or p.pdf_filename or p.name
            if not p.project_name or p.project_name == "Default Project":
                inferred_proj = infer_project_name(src_name, known_projects)
                if inferred_proj != p.project_name:
                    p.project_name = inferred_proj
                    if inferred_proj not in known_projects and inferred_proj != "Default Project":
                        known_projects.append(inferred_proj)
                    dirty = True
            inferred_disc = infer_discipline(p.dwg_filename, p.pdf_filename, p.name)
            if p.discipline == "architectural" and inferred_disc != "architectural":
                p.discipline = inferred_disc
                dirty = True
        if dirty:
            session.commit()


def get_session():
    with Session(engine) as session:
        yield session
