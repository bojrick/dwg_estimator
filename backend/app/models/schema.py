from datetime import datetime, timezone
import secrets
import uuid
from typing import Optional
from sqlmodel import SQLModel, Field


class User(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    salt: str
    default_unit: str = Field(default="m")  # "m", "mm", "ft", "in"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Plan(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[str] = Field(default=None, index=True)
    name: str = Field(index=True)
    project_name: str = Field(default="Default Project", index=True)
    discipline: str = Field(default="architectural", index=True)
    share_token: str = Field(
        default_factory=lambda: secrets.token_urlsafe(8),
        index=True,
        unique=True,
    )
    dwg_filename: Optional[str] = Field(default=None)
    dwg_key: Optional[str] = Field(default=None)
    cleaned_dxf_key: Optional[str] = Field(default=None)
    full_parsed_json_key: Optional[str] = Field(default=None)
    parsed_json_key: Optional[str] = Field(default=None)

    pdf_filename: Optional[str] = Field(default=None)
    pdf_key: Optional[str] = Field(default=None)

    active_sheet_id: Optional[str] = Field(default=None)
    active_sheet_name: str = Field(default="Full Plan View")
    match_reason: str = Field(default="")
    sheets_json: str = Field(default="[]")
    summary_json: str = Field(default="{}")

    unit_name: str = Field(default="m")
    scale_to_m: float = Field(default=1.0)
    storage_backend: str = Field(default="cloud")

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
