from collections import deque
from datetime import datetime, timezone
import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import traceback
from typing import Any, Dict, List, Optional

LOG_DIR = Path(__file__).resolve().parent.parent.parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "app.log"

# Circular buffer for real-time interactive log inspection (last 1000 items)
_MAX_BUFFER = 1000
_LOG_BUFFER: deque = deque(maxlen=_MAX_BUFFER)
_LOG_COUNTER = 0


class StructuredLogRecord:
    def __init__(
        self,
        id: int,
        timestamp: str,
        level: str,
        logger: str,
        message: str,
        traceback_str: Optional[str] = None,
        extra: Optional[Dict[str, Any]] = None,
    ):
        self.id = id
        self.timestamp = timestamp
        self.level = level
        self.logger = logger
        self.message = message
        self.traceback = traceback_str
        self.extra = extra or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "level": self.level,
            "logger": self.logger,
            "message": self.message,
            "traceback": self.traceback,
            "extra": self.extra,
        }


class AppMemoryLogHandler(logging.Handler):
    """Intercepts standard logging records into the structured circular buffer."""

    def emit(self, record: logging.LogRecord) -> None:
        global _LOG_COUNTER
        try:
            tb_str = None
            if record.exc_info:
                tb_str = "".join(traceback.format_exception(*record.exc_info))

            _LOG_COUNTER += 1
            ts = datetime.now(timezone.utc).isoformat()
            log_item = StructuredLogRecord(
                id=_LOG_COUNTER,
                timestamp=ts,
                level=record.levelname,
                logger=record.name,
                message=record.getMessage(),
                traceback_str=tb_str,
            )
            _LOG_BUFFER.append(log_item)
        except Exception:
            self.handleError(record)


# Initialize logging
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

# 1. Console handler
console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] %(name)s: %(message)s"))
root_logger.addHandler(console_handler)

# 2. Rotating file handler (up to 5MB, 3 backups)
file_handler = RotatingFileHandler(str(LOG_FILE), maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
file_handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s"))
root_logger.addHandler(file_handler)

# 3. In-memory buffer handler for interactive frontend viewing
mem_handler = AppMemoryLogHandler()
root_logger.addHandler(mem_handler)

app_logger = logging.getLogger("planvault")


def log_event(
    level: str,
    message: str,
    logger_name: str = "planvault",
    exc: Optional[BaseException] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    logger = logging.getLogger(logger_name)
    lvl = getattr(logging, level.upper(), logging.INFO)
    exc_info = (type(exc), exc, exc.__traceback__) if exc else None
    logger.log(lvl, message, exc_info=exc_info, extra=extra)


def get_logs(
    level: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 150,
) -> Dict[str, Any]:
    records: List[StructuredLogRecord] = list(_LOG_BUFFER)
    # Most recent first
    records.reverse()

    if level and level.upper() != "ALL":
        target = level.upper()
        records = [r for r in records if r.level == target]

    if search and search.strip():
        q = search.strip().lower()
        records = [
            r
            for r in records
            if q in r.message.lower() or q in r.logger.lower() or (r.traceback and q in r.traceback.lower())
        ]

    total_matched = len(records)
    records = records[:limit]

    # Calculate level breakdown counts
    counts = {"ALL": len(_LOG_BUFFER), "ERROR": 0, "WARNING": 0, "INFO": 0}
    for r in _LOG_BUFFER:
        if r.level in counts:
            counts[r.level] += 1

    return {
        "total": total_matched,
        "counts": counts,
        "log_file": str(LOG_FILE),
        "logs": [r.to_dict() for r in records],
    }


def clear_logs() -> None:
    _LOG_BUFFER.clear()
    try:
        LOG_FILE.write_text("")
    except Exception:
        pass
