import math
import re
import zlib
from collections import Counter
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
import ezdxf
from ezdxf import colors
from ezdxf import path as ezpath
from ezdxf.math import bulge_to_arc
from app.services.dwg_converter import load_ezdxf_doc


LAYER_ROLE_KEYWORDS: Dict[str, List[str]] = {
    "wall": ["WALL", "A-WALL", "BRICK", "MASONRY", "PARTITION", "ARCH-WALL", "MUR", "PERA WALL"],
    "column": ["COL", "S-COL", "COLUMN", "PILLAR", "RCC-COL"],
    "beam": ["BEAM", "S-BEAM", "PLINTH", "LINTEL", "RCC-BEAM"],
    "dimension": ["DIM", "A-ANNO-DIMS", "MEAS"],
    "text": ["TEXT", "ANNO", "LABEL", "ROOM", "NOTE", "SCHEDULE", "SECT", "TITEL", "TITLE", "LVL"],
}

VALID_DISCIPLINES = ("architectural", "electrical", "structural", "plumbing", "fire")

DISCIPLINE_PATTERNS: List[Tuple[str, re.Pattern]] = [
    ("electrical", re.compile(r"(?:^|[\s_\-\.])(elec\w*|power|lighting|conduit|wiring|panel|switch\w*|sldb|mddb)(?:$|[\s_\-\.])", re.I)),
    ("structural", re.compile(r"(?:^|[\s_\-\.])(struct\w*|column\w*|col|beam\w*|footing\w*|foundation\w*|rcc|slab|khunt|centerline|lintel|plinth)(?:$|[\s_\-\.])", re.I)),
    ("plumbing", re.compile(r"(?:^|[\s_\-\.])(plumb\w*|sanitary|drain\w*|sewer\w*|water|pipe\w*|phe|stp|ugt|oht)(?:$|[\s_\-\.])", re.I)),
    ("fire", re.compile(r"(?:^|[\s_\-\.])(fire\w*|sprinkler\w*|hydrant\w*|smoke|alarm\w*|hose|fhc)(?:$|[\s_\-\.])", re.I)),
]

_PROJECT_STOP_RE = re.compile(
    r"\b(block|working|plan|layout|ground|first|second|third|fourth|1st|2nd|3rd|4th|terrace|typical|floor|sheet|"
    r"elec\w*|struct\w*|plumb\w*|fire\w*|arch\w*|section\w*|elevation\w*|detail\w*|centerline|column\w*|footing\w*)\b",
    re.I,
)


def infer_discipline(*names: Optional[str]) -> str:
    combined = " ".join(Path(n).stem if "." in n else n for n in names if n)
    for disc, pattern in DISCIPLINE_PATTERNS:
        if pattern.search(combined):
            return disc
    return "architectural"


def infer_project_name(filename: Optional[str], existing_projects: Optional[List[str]] = None) -> str:
    if not filename:
        return "Default Project"
    stem = Path(filename).stem.replace("_", " ").replace("-", " ")
    m = _PROJECT_STOP_RE.search(stem)
    prefix = stem[: m.start()] if m else stem
    cleaned = " ".join(prefix.split()).strip()
    if not cleaned:
        return "Default Project"
    titled = " ".join(w if w.isupper() and len(w) > 1 else w.capitalize() for w in cleaned.split())
    if existing_projects:
        low = titled.lower()
        for proj in existing_projects:
            if proj and proj != "Default Project":
                pl = proj.lower()
                if pl == low or pl.startswith(low + " ") or low.startswith(pl + " "):
                    return proj
    return titled

INSUNITS_TO_SCALE_M: Dict[int, Tuple[str, float]] = {
    0: ("unitless", 1.0),
    1: ("in", 0.0254),
    2: ("ft", 0.3048),
    4: ("mm", 0.001),
    5: ("cm", 0.01),
    6: ("m", 1.0),
}

SCALE_M_TO_UNIT_NAME: List[Tuple[float, str]] = [
    (1.0, "m"),
    (0.01, "cm"),
    (0.001, "mm"),
    (0.3048, "ft"),
    (0.0254, "in"),
]

ACI_BRIGHT_PALETTE: Dict[int, str] = {
    1: "#ff5252",   # Red
    2: "#facc15",   # Yellow
    3: "#4ade80",   # Green
    4: "#22d3ee",   # Cyan
    5: "#60a5fa",   # Blue
    6: "#e879f9",   # Magenta
    7: "#f1f5f9",   # White / Default
    8: "#94a3b8",   # Dark Grey
    9: "#cbd5e1",   # Light Grey
    30: "#fb923c",  # Orange
    40: "#f59e0b",  # Amber/Gold
}


def aci_to_hex(aci: Optional[int]) -> str:
    """Converts an AutoCAD Color Index (ACI 1..255) into a high-contrast hex color for dark CAD canvas."""
    if aci is None:
        return "#f1f5f9"
    code = abs(int(aci))
    if code in (0, 7, 256):
        return "#f1f5f9"
    if code in ACI_BRIGHT_PALETTE:
        return ACI_BRIGHT_PALETTE[code]
    if 1 <= code <= 255:
        try:
            r, g, b = colors.aci2rgb(code)
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            if lum < 65:
                boost = int(65 - lum) + 35
                r = min(255, r + boost)
                g = min(255, g + boost)
                b = min(255, b + boost)
            return f"#{r:02x}{g:02x}{b:02x}"
        except Exception:
            pass
    return "#f1f5f9"


def clean_cad_text(raw: str) -> str:
    """Translates AutoCAD %% control codes and strips MTEXT formatting codes."""
    if not raw:
        return ""
    s = raw
    s = re.sub(r"%%[cC]", "Ø", s)
    s = re.sub(r"%%[dD]", "°", s)
    s = re.sub(r"%%[pP]", "±", s)
    s = re.sub(r"%%[uUoO]", "", s)
    s = re.sub(r"\\[A-Za-z][^;]*;", "", s)
    s = s.replace("\\P", "\n").replace("{", "").replace("}", "")
    return s.strip()


def classify_layer_name(layer_name: str) -> str:
    upper = layer_name.upper()
    for role, keywords in LAYER_ROLE_KEYWORDS.items():
        for kw in keywords:
            if kw in upper:
                return role
    return "unclassified"


def _expand_lwpolyline_points(entity) -> Tuple[List[List[float]], bool]:
    """Extracts [x, y] vertices from an LWPOLYLINE, interpolating any bulged (arc) segments."""
    pts_xyb = list(entity.get_points("xyb"))
    is_closed = bool(entity.closed)
    if len(pts_xyb) < 2:
        return [], is_closed

    has_bulge = any(abs(p[2]) > 1e-3 for p in pts_xyb)
    if not has_bulge:
        pts = [[round(float(p[0]), 4), round(float(p[1]), 4)] for p in pts_xyb]
        if len(pts) >= 3 and math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 1e-3:
            is_closed = True
        return pts, is_closed

    out_pts: List[List[float]] = []
    n = len(pts_xyb)
    seg_count = n if is_closed else n - 1
    for i in range(seg_count):
        x1, y1, b = float(pts_xyb[i][0]), float(pts_xyb[i][1]), float(pts_xyb[i][2])
        x2, y2, _ = float(pts_xyb[(i + 1) % n][0]), float(pts_xyb[(i + 1) % n][1]), float(pts_xyb[(i + 1) % n][2])
        out_pts.append([round(x1, 4), round(y1, 4)])
        if abs(b) > 1e-3 and math.hypot(x2 - x1, y2 - y1) > 1e-5:
            try:
                center, _, _, radius = bulge_to_arc((x1, y1), (x2, y2), b)
                cx, cy = float(center[0]), float(center[1])
                r = float(radius)
                inc_angle = 4.0 * math.atan(b)
                a0 = math.atan2(y1 - cy, x1 - cx)
                steps = max(4, min(14, int(abs(inc_angle) / (math.pi / 12))))
                for s in range(1, steps):
                    ang = a0 + inc_angle * (s / steps)
                    out_pts.append([round(cx + r * math.cos(ang), 4), round(cy + r * math.sin(ang), 4)])
            except Exception:
                pass
    if not is_closed:
        out_pts.append([round(float(pts_xyb[-1][0]), 4), round(float(pts_xyb[-1][1]), 4)])
    return out_pts, is_closed


def _detect_drawing_sheets(
    raw_polylines: List[Dict[str, Any]],
    raw_texts: List[Dict[str, Any]],
    scale_to_m: float,
) -> List[Dict[str, Any]]:
    """
    Detects individual CAD drawing sheets / titleblock frames arranged in Modelspace
    (common in working drawings where multiple floor plans, sections, and elevations
    sit side-by-side in one DWG file).
    """
    candidate_frames: List[Tuple[float, float, float, float, str, int]] = []
    min_sheet_span = 12.0 / max(scale_to_m, 1e-5)
    max_sheet_span = 260.0 / max(scale_to_m, 1e-5)

    for pl in raw_polylines:
        pts = pl.get("points", [])
        if len(pts) < 4:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        minx, maxx = min(xs), max(xs)
        miny, maxy = min(ys), max(ys)
        w = maxx - minx
        h = maxy - miny
        if not (min_sheet_span <= w <= max_sheet_span and min_sheet_span <= h <= max_sheet_span):
            continue

        on_perim = sum(
            1
            for p in pts
            if min(abs(p[0] - minx), abs(p[0] - maxx)) < w * 0.08
            or min(abs(p[1] - miny), abs(p[1] - maxy)) < h * 0.08
        )
        if on_perim < len(pts) * 0.75:
            continue

        lyr_u = pl["layer"].upper()
        is_title_layer = any(k in lyr_u for k in ["TITEL", "TITLE", "BORDER", "FRAME", "SHEET"])
        priority = 1 if is_title_layer else 2
        candidate_frames.append((minx, miny, maxx, maxy, pl["layer"], priority))

    candidate_frames.sort(key=lambda f: (f[5], (f[2] - f[0]) * (f[3] - f[1])))

    deduped_frames: List[Tuple[float, float, float, float, str]] = []
    for (x1, y1, x2, y2, lyr, prio) in candidate_frames:
        w, h = x2 - x1, y2 - y1
        tol_x, tol_y = w * 0.12, h * 0.12
        if any(
            abs(fx1 - x1) < tol_x and abs(fy1 - y1) < tol_y and abs(fx2 - x2) < tol_x and abs(fy2 - y2) < tol_y
            for (fx1, fy1, fx2, fy2, _) in deduped_frames
        ):
            continue
        if prio > 1:
            overlaps_existing = any(
                not (x2 < fx1 or x1 > fx2 or y2 < fy1 or y1 > fy2)
                for (fx1, fy1, fx2, fy2, _) in deduped_frames
            )
            if overlaps_existing:
                continue
        deduped_frames.append((x1, y1, x2, y2, lyr))

    if not deduped_frames:
        return []

    title_keywords = [
        "WORKING PLAN",
        "FLOOR PLAN",
        "CENTERLINE PLAN",
        "LINEOUT PLAN",
        "KHUNT PLAN",
        "LAYOUT PLAN",
        "FRAMING PLAN",
        "STRUCTURAL",
        "BEAM",
        "COLUMN",
        "FOOTING",
        "FOUNDATION",
        "PLINTH",
        "SLAB",
        "SCHEDULE",
        "REINFORCEMENT",
        "ELEVATION",
        "SECTION",
        "DETAIL",
    ]

    sheets: List[Dict[str, Any]] = []
    for idx, (x1, y1, x2, y2, lyr) in enumerate(deduped_frames):
        in_texts = [
            t for t in raw_texts if x1 <= t["x"] <= x2 and y1 <= t["y"] <= y2 and len(t["text"]) >= 3
        ]
        if len(in_texts) < 2:
            continue

        main_title = None
        main_title_prio = 99
        block_label = None
        room_keywords_found = 0
        structural_keywords_found = 0
        title_block_candidates: List[str] = []

        w_frame = max(1.0, x2 - x1)
        h_frame = max(1.0, y2 - y1)

        for t in in_texts:
            tu = t["text"].upper().strip()
            t_lyr_u = t["layer"].upper()
            is_title_lyr = any(k in t_lyr_u for k in ["TITEL", "TITLE", "BORDER", "SHEET", "HEADER"])
            in_title_corner = (t["x"] >= x1 + 0.55 * w_frame) or (t["y"] <= y1 + 0.25 * h_frame)
            if (is_title_lyr or in_title_corner) and 3 <= len(tu) <= 80:
                if t["text"].strip() not in title_block_candidates and len(title_block_candidates) < 15:
                    title_block_candidates.append(t["text"].strip())

            if any(k in tu for k in ["COMMENCEMENT", "CONSIDER", "DIMENSION", "AMBIGUITY", "ARCHITECT", "SLAB LVL", "FINISHED FLOOR"]):
                continue
            if "BLOCK" in tu and len(tu) <= 28 and (is_title_lyr or block_label is None):
                block_label = t["text"]
            elif any(k in tu for k in title_keywords) and len(tu) <= 64:
                prio = 1 if is_title_lyr else (2 if in_title_corner else 3)
                if main_title is None or prio < main_title_prio:
                    main_title = t["text"]
                    main_title_prio = prio
            if any(rk in tu for rk in ["BED ROOM", "KITCHEN", "TOILET", "LIVING", "DRG.ROOM", "DINING"]):
                room_keywords_found += 1
            if any(sk in tu for sk in ["STIRRUP", "REBAR", "C/C", "T12", "T16", "T20", "FE500", "M25"]):
                structural_keywords_found += 1

        if not main_title:
            if room_keywords_found >= 2:
                main_title = "ARCHITECTURAL FLOOR PLAN"
            elif structural_keywords_found >= 2:
                main_title = f"STRUCTURAL SHEET {idx + 1}"
            elif block_label:
                main_title = f"DRAWING SHEET ({block_label})"
            elif len(in_texts) >= 5:
                main_title = title_block_candidates[0] if title_block_candidates else f"DRAWING SHEET {idx + 1}"
            else:
                continue

        tu_main = main_title.upper()
        if any(k in tu_main for k in ["GROUND", "1ST", "2ND", "3RD", "4TH", "5TH", "TYPICAL", "TERRACE", "FLOOR PLAN", "WORKING PLAN"]):
            category = "floor_plan"
            sort_order = 1
        elif any(k in tu_main for k in ["CENTERLINE", "LINEOUT", "KHUNT", "COLUMN", "FOOTING", "FOUNDATION", "BEAM", "PLINTH", "SLAB", "FRAMING", "SCHEDULE", "STRUCTURAL"]):
            category = "structural_plan"
            sort_order = 2
        elif "SECTION" in tu_main or "DETAIL" in tu_main:
            category = "section"
            sort_order = 3
        elif "ELEVATION" in tu_main:
            category = "elevation"
            sort_order = 4
        else:
            category = "other"
            sort_order = 5

        display_name = f"{main_title} ({block_label})" if block_label and block_label not in main_title else main_title
        sheets.append({
            "id": f"sheet_{idx + 1}",
            "name": display_name,
            "title": main_title,
            "subtitle": block_label or "",
            "category": category,
            "sort_order": sort_order,
            "layer": lyr,
            "title_block_texts": title_block_candidates[:12],
            "bbox": {
                "min_x": round(x1, 3),
                "min_y": round(y1, 3),
                "max_x": round(x2, 3),
                "max_y": round(y2, 3),
                "width": round(x2 - x1, 3),
                "height": round(y2 - y1, 3),
            },
            "text_count": len(in_texts),
        })

    sheets.sort(key=lambda s: (s["sort_order"], -s["bbox"]["min_y"], s["bbox"]["min_x"]))
    for i, s in enumerate(sheets):
        s["index"] = i + 1
    return sheets


def extract_dxf_raw_entities(
    dxf_path: Path,
    override_scale_to_m: Optional[float] = None,
    doc: Any = None,
) -> Dict[str, Any]:
    """
    Reads a DXF file via ezdxf and extracts all geometric primitives, layers, blocks, dimensions,
    hatches, texts, and detected sheet frames.
    """
    if doc is None:
        doc = load_ezdxf_doc(dxf_path)
    msp = doc.modelspace()

    insunits = int(doc.header.get("$INSUNITS", 0) or 0)
    dxf_version = doc.header.get("$ACADVER", "AC1024")
    header_unit_name, header_scale_to_m = INSUNITS_TO_SCALE_M.get(insunits, ("unitless", 1.0))

    layer_stats: Dict[str, Dict[str, Any]] = {}
    for layer in doc.layers:
        lname = layer.dxf.name
        raw_aci = getattr(layer.dxf, "color", 7)
        is_off = raw_aci < 0 or layer.is_off() or layer.is_frozen()
        color_hex = aci_to_hex(raw_aci)
        layer_stats[lname] = {
            "name": lname,
            "role": classify_layer_name(lname),
            "color": abs(int(raw_aci or 7)),
            "color_hex": color_hex,
            "is_off_in_cad": bool(is_off),
            "entity_count": 0,
            "entity_types": {},
        }

    def ensure_layer(lname: str) -> Dict[str, Any]:
        if lname not in layer_stats:
            layer_stats[lname] = {
                "name": lname,
                "role": classify_layer_name(lname),
                "color": 7,
                "color_hex": "#f1f5f9",
                "is_off_in_cad": False,
                "entity_count": 0,
                "entity_types": {},
            }
        return layer_stats[lname]

    def record_layer(lname: str, etype: str):
        info = ensure_layer(lname)
        info["entity_count"] += 1
        info["entity_types"][etype] = info["entity_types"].get(etype, 0) + 1

    def resolve_color_hex(entity, lname: str, inherited_hex: Optional[str] = None) -> str:
        ent_col = getattr(entity.dxf, "color", 256)
        if ent_col not in (None, 0, 256):
            return aci_to_hex(ent_col)
        if ent_col == 0 and inherited_hex:
            return inherited_hex
        return ensure_layer(lname)["color_hex"]

    raw_lines: List[Dict[str, Any]] = []
    raw_polylines: List[Dict[str, Any]] = []
    raw_arcs_circles: List[Dict[str, Any]] = []
    raw_inserts: List[Dict[str, Any]] = []
    raw_texts: List[Dict[str, Any]] = []
    raw_hatches: List[Dict[str, Any]] = []
    raw_tables: List[Dict[str, Any]] = []

    all_x: List[float] = []
    all_y: List[float] = []
    top_level_counts: Counter = Counter()
    expanded_counts: Counter = Counter()

    def process_primitive(
        entity,
        parent_layer: Optional[str] = None,
        parent_color_hex: Optional[str] = None,
        source_kind: str = "modelspace",
        block_name: Optional[str] = None,
        depth: int = 0,
        bbox_collector: Optional[List[List[float]]] = None,
    ):
        etype = entity.dxftype()
        raw_lname = getattr(entity.dxf, "layer", "0") or "0"
        lname = parent_layer if (raw_lname == "0" and parent_layer) else raw_lname
        linfo = ensure_layer(lname)
        role = linfo["role"]
        color_hex = resolve_color_hex(entity, lname, parent_color_hex)

        if depth == 0:
            top_level_counts[etype] += 1
            record_layer(lname, etype)
        else:
            expanded_counts[etype] += 1

        def _finite(*vals: float) -> bool:
            return all(math.isfinite(v) for v in vals)

        def collect_pt(px: float, py: float):
            if math.isfinite(px) and math.isfinite(py):
                all_x.append(px)
                all_y.append(py)
                if bbox_collector is not None:
                    bbox_collector[0].append(px)
                    bbox_collector[1].append(py)

        try:
            if etype == "LINE":
                s = entity.dxf.start
                e = entity.dxf.end
                x1, y1 = round(float(s.x), 4), round(float(s.y), 4)
                x2, y2 = round(float(e.x), 4), round(float(e.y), 4)
                if _finite(x1, y1, x2, y2) and math.hypot(x2 - x1, y2 - y1) > 1e-6:
                    item: Dict[str, Any] = {
                        "layer": lname,
                        "role": role,
                        "color": color_hex,
                        "start": [x1, y1],
                        "end": [x2, y2],
                    }
                    if source_kind != "modelspace":
                        item["source"] = source_kind
                    if block_name:
                        item["block"] = block_name
                    raw_lines.append(item)
                    collect_pt(x1, y1)
                    collect_pt(x2, y2)

            elif etype in ("LWPOLYLINE", "POLYLINE"):
                if etype == "LWPOLYLINE":
                    pts, is_closed = _expand_lwpolyline_points(entity)
                else:
                    pts = []
                    for v in entity.vertices:
                        loc = v.dxf.location
                        pts.append([round(float(loc.x), 4), round(float(loc.y), 4)])
                    is_closed = bool(entity.is_closed)
                    if len(pts) >= 3 and _finite(pts[0][0], pts[0][1], pts[-1][0], pts[-1][1]) and math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 1e-3:
                        is_closed = True

                pts = [p for p in pts if _finite(p[0], p[1])]
                if len(pts) >= 2:
                    item = {
                        "layer": lname,
                        "role": role,
                        "color": color_hex,
                        "points": pts,
                        "closed": is_closed,
                    }
                    if source_kind != "modelspace":
                        item["source"] = source_kind
                    if block_name:
                        item["block"] = block_name
                    raw_polylines.append(item)
                    for p in pts:
                        collect_pt(p[0], p[1])

            elif etype in ("SPLINE", "ELLIPSE"):
                pts = [
                    [round(float(v.x), 4), round(float(v.y), 4)]
                    for v in entity.flattening(0.05, segments=6)
                    if _finite(float(v.x), float(v.y))
                ]
                if len(pts) >= 2:
                    item = {
                        "layer": lname,
                        "role": role,
                        "color": color_hex,
                        "points": pts,
                        "closed": bool(getattr(entity, "closed", False)),
                        "source": etype.lower() if source_kind == "modelspace" else source_kind,
                    }
                    if block_name:
                        item["block"] = block_name
                    raw_polylines.append(item)
                    for p in pts:
                        collect_pt(p[0], p[1])

            elif etype in ("CIRCLE", "ARC"):
                c = entity.dxf.center
                r = round(float(entity.dxf.radius), 4)
                cx, cy = round(float(c.x), 4), round(float(c.y), 4)
                if _finite(cx, cy, r) and r > 1e-5:
                    if etype == "ARC":
                        sa = float(entity.dxf.start_angle)
                        ea = float(entity.dxf.end_angle)
                        if not _finite(sa, ea):
                            sa, ea = 0.0, 360.0
                    item = {
                        "type": etype,
                        "layer": lname,
                        "role": role,
                        "color": color_hex,
                        "center": [cx, cy],
                        "radius": r,
                    }
                    if etype == "ARC":
                        item["start_angle"] = round(sa, 2)
                        item["end_angle"] = round(ea, 2)
                    if source_kind != "modelspace":
                        item["source"] = source_kind
                    if block_name:
                        item["block"] = block_name
                    raw_arcs_circles.append(item)
                    collect_pt(cx, cy)

            elif etype in ("TEXT", "MTEXT", "ATTRIB"):
                if etype in ("TEXT", "ATTRIB"):
                    txt = clean_cad_text(getattr(entity.dxf, "text", ""))
                    loc = entity.dxf.insert
                    ht = float(getattr(entity.dxf, "height", 0.2) or 0.2)
                    rot = float(getattr(entity.dxf, "rotation", 0.0) or 0.0)
                else:
                    txt = clean_cad_text(entity.plain_text())
                    loc = entity.dxf.insert
                    ht = float(getattr(entity.dxf, "char_height", 0.2) or 0.2)
                    rot = float(getattr(entity.dxf, "rotation", 0.0) or 0.0)

                if not math.isfinite(ht):
                    ht = 0.2
                if not math.isfinite(rot):
                    rot = 0.0
                if txt:
                    tx, ty = round(float(loc.x), 4), round(float(loc.y), 4)
                    if _finite(tx, ty):
                        item = {
                            "layer": lname,
                            "role": role,
                            "color": color_hex,
                            "text": txt,
                            "x": tx,
                            "y": ty,
                            "height": round(ht, 4),
                            "rotation": round(rot, 2),
                        }
                        if source_kind != "modelspace":
                            item["source"] = source_kind
                        if block_name:
                            item["block"] = block_name
                        raw_texts.append(item)
                        collect_pt(tx, ty)

            elif etype in ("SOLID", "TRACE"):
                pts = []
                for vname in ("vtx0", "vtx1", "vtx2", "vtx3"):
                    if hasattr(entity.dxf, vname):
                        v = getattr(entity.dxf, vname)
                        vx, vy = float(v.x), float(v.y)
                        if _finite(vx, vy):
                            pt = [round(vx, 4), round(vy, 4)]
                            if not pts or pt != pts[-1]:
                                pts.append(pt)
                if len(pts) >= 3:
                    raw_hatches.append({
                        "layer": lname,
                        "role": role,
                        "color": color_hex,
                        "points": pts,
                        "source": source_kind,
                    })
                    for p in pts:
                        collect_pt(p[0], p[1])

            elif etype == "HATCH":
                for p_idx, hpath in enumerate(entity.paths):
                    if p_idx > 40:
                        break
                    pts = []
                    if hasattr(hpath, "vertices"):
                        for v in hpath.vertices:
                            vx, vy = float(v[0]), float(v[1])
                            if _finite(vx, vy):
                                pts.append([round(vx, 4), round(vy, 4)])
                    else:
                        try:
                            ep = ezpath.from_hatch_boundary_path(hpath)
                            pts = [
                                [round(float(v.x), 4), round(float(v.y), 4)]
                                for v in ep.flattening(0.08, segments=6)
                                if _finite(float(v.x), float(v.y))
                            ]
                        except Exception:
                            pts = []
                    if 3 <= len(pts) <= 300:
                        raw_hatches.append({
                            "layer": lname,
                            "role": role,
                            "color": color_hex,
                            "points": pts,
                        })

            elif etype == "INSERT" and depth < 3:
                bname = getattr(entity.dxf, "name", "BLOCK")
                rot = float(getattr(entity.dxf, "rotation", 0.0) or 0.0)
                if not math.isfinite(rot):
                    rot = 0.0
                ins = entity.dxf.insert
                ix, iy = round(float(ins.x), 4), round(float(ins.y), 4)
                if not _finite(ix, iy):
                    return

                blk_coords: List[List[float]] = [[], []]
                try:
                    for ve in entity.virtual_entities():
                        process_primitive(
                            ve,
                            parent_layer=lname,
                            parent_color_hex=color_hex,
                            source_kind="block",
                            block_name=bname,
                            depth=depth + 1,
                            bbox_collector=blk_coords,
                        )
                    for attrib in getattr(entity, "attribs", []):
                        process_primitive(
                            attrib,
                            parent_layer=lname,
                            parent_color_hex=color_hex,
                            source_kind="block",
                            block_name=bname,
                            depth=depth + 1,
                            bbox_collector=blk_coords,
                        )
                except Exception:
                    pass

                if blk_coords[0] and blk_coords[1]:
                    b_minx, b_maxx = min(blk_coords[0]), max(blk_coords[0])
                    b_miny, b_maxy = min(blk_coords[1]), max(blk_coords[1])
                    world_pos = [round((b_minx + b_maxx) / 2.0, 4), round((b_miny + b_maxy) / 2.0, 4)]
                    w_raw = round(b_maxx - b_minx, 4)
                    d_raw = round(b_maxy - b_miny, 4)
                    bbox_list = [round(b_minx, 4), round(b_miny, 4), round(b_maxx, 4), round(b_maxy, 4)]
                else:
                    world_pos = [ix, iy]
                    w_raw = 0.0
                    d_raw = 0.0
                    bbox_list = [ix, iy, ix, iy]
                    collect_pt(ix, iy)

                if depth == 0:
                    raw_inserts.append({
                        "layer": lname,
                        "role": role,
                        "color": color_hex,
                        "block_name": bname,
                        "pos": world_pos,
                        "insert_pt": [ix, iy],
                        "bbox": bbox_list,
                        "rotation": round(rot, 2),
                        "width_raw": w_raw,
                        "depth_raw": d_raw,
                    })

            elif etype in ("DIMENSION", "LEADER") and depth < 2:
                src_label = "dimension" if etype == "DIMENSION" else "leader"
                try:
                    for ve in entity.virtual_entities():
                        process_primitive(
                            ve,
                            parent_layer=lname,
                            parent_color_hex=color_hex,
                            source_kind=src_label,
                            block_name=None,
                            depth=depth + 1,
                            bbox_collector=bbox_collector,
                        )
                except Exception:
                    pass

            elif etype in ("ACAD_TABLE", "TABLE"):
                try:
                    from ezdxf.entities import read_acad_table_content
                    matrix = read_acad_table_content(entity)
                    if matrix and len(matrix) >= 2:
                        raw_tables.append({
                            "layer": lname,
                            "role": role,
                            "color": color_hex,
                            "headers": [str(c or "").strip() for c in matrix[0]],
                            "rows": [[str(c or "").strip() for c in r] for r in matrix[1:]],
                            "source": source_kind,
                        })
                except Exception:
                    pass

        except Exception:
            pass

    for entity in msp:
        process_primitive(entity, depth=0)

    if all_x and all_y:
        sx = sorted(all_x)
        sy = sorted(all_y)
        n_pts = len(sx)
        full_min_x, full_max_x = sx[0], sx[-1]
        full_min_y, full_max_y = sy[0], sy[-1]

        if n_pts >= 200:
            p_low = max(0, int(n_pts * 0.002))
            p_high = min(n_pts - 1, int(n_pts * 0.998))
            rob_min_x, rob_max_x = sx[p_low], sx[p_high]
            rob_min_y, rob_max_y = sy[p_low], sy[p_high]
            rob_span_x = max(1e-3, rob_max_x - rob_min_x)
            rob_span_y = max(1e-3, rob_max_y - rob_min_y)
            min_x = rob_min_x if (rob_min_x - full_min_x) > rob_span_x * 0.5 else full_min_x
            max_x = rob_max_x if (full_max_x - rob_max_x) > rob_span_x * 0.5 else full_max_x
            min_y = rob_min_y if (rob_min_y - full_min_y) > rob_span_y * 0.5 else full_min_y
            max_y = rob_max_y if (full_max_y - rob_max_y) > rob_span_y * 0.5 else full_max_y
        else:
            min_x, max_x = full_min_x, full_max_x
            min_y, max_y = full_min_y, full_max_y
    else:
        min_x = min_y = full_min_x = full_min_y = 0.0
        max_x = max_y = full_max_x = full_max_y = 10.0

    unit_name = header_unit_name
    scale_to_m = header_scale_to_m
    unit_detection_reason = f"DXF Header $INSUNITS={insunits} ({header_unit_name})"

    if override_scale_to_m is not None:
        scale_to_m = override_scale_to_m
        unit_name = next((n for s, n in SCALE_M_TO_UNIT_NAME if abs(s - scale_to_m) < 1e-5), "m")
        unit_detection_reason = "User manual unit override"
    else:
        explicit_unit = None
        for t in raw_texts:
            tu = t["text"].upper()
            if "DIMENSION" in tu and ("IN MT" in tu or "IN METER" in tu or "IN METRE" in tu):
                explicit_unit = ("m", 1.0, f"General Note: '{t['text'][:50]}'")
                break
            if "DIMENSION" in tu and ("IN MM" in tu or "IN MILLIMETER" in tu):
                explicit_unit = ("mm", 0.001, f"General Note: '{t['text'][:50]}'")
                break

        wall_lens = [
            math.hypot(l["end"][0] - l["start"][0], l["end"][1] - l["start"][1])
            for l in raw_lines
            if l["role"] == "wall" and l.get("source") != "dimension"
        ]
        col_dims = []
        for pl in raw_polylines:
            if pl["role"] == "column" and len(pl["points"]) >= 4:
                pxs = [p[0] for p in pl["points"]]
                pys = [p[1] for p in pl["points"]]
                cw, cd = max(pxs) - min(pxs), max(pys) - min(pys)
                if cw > 1e-4 and cd > 1e-4:
                    col_dims.append(min(cw, cd))

        if explicit_unit is not None:
            unit_name, scale_to_m, unit_detection_reason = explicit_unit
        elif col_dims:
            col_dims.sort()
            med_col = col_dims[len(col_dims) // 2]
            if 0.15 <= med_col <= 1.2:
                unit_name, scale_to_m = "m", 1.0
                unit_detection_reason = f"Column width median = {med_col:.2f} units (Meters)"
            elif 15.0 <= med_col <= 120.0:
                unit_name, scale_to_m = "cm", 0.01
                unit_detection_reason = f"Column width median = {med_col:.1f} units (Centimeters)"
            elif 150.0 <= med_col <= 1500.0:
                unit_name, scale_to_m = "mm", 0.001
                unit_detection_reason = f"Column width median = {med_col:.0f} units (Millimeters)"
        elif wall_lens:
            wall_lens.sort()
            med_wall = wall_lens[len(wall_lens) // 2]
            if 0.25 <= med_wall <= 12.0:
                unit_name, scale_to_m = "m", 1.0
                unit_detection_reason = f"Wall segment median = {med_wall:.2f} units (Meters)"
            elif 25.0 <= med_wall <= 250.0:
                unit_name, scale_to_m = "cm", 0.01
                unit_detection_reason = f"Wall segment median = {med_wall:.1f} units (Centimeters)"
            elif med_wall > 250.0:
                unit_name, scale_to_m = "mm", 0.001
                unit_detection_reason = f"Wall segment median = {med_wall:.0f} units (Millimeters)"
        elif insunits == 0:
            bbox_span = max(max_x - min_x, max_y - min_y)
            if bbox_span > 1500:
                unit_name, scale_to_m = "mm", 0.001
                unit_detection_reason = f"Drawing span = {bbox_span:.0f} units (inferred Millimeters)"
            elif bbox_span > 150:
                unit_name, scale_to_m = "cm", 0.01
                unit_detection_reason = f"Drawing span = {bbox_span:.1f} units (inferred Centimeters)"
            else:
                unit_name, scale_to_m = "m", 1.0
                unit_detection_reason = f"Drawing span = {bbox_span:.2f} units (inferred Meters)"

    detected_sheets = _detect_drawing_sheets(raw_polylines, raw_texts, scale_to_m)

    active_layers = [v for v in layer_stats.values() if v["entity_count"] > 0]
    active_layers.sort(key=lambda x: -x["entity_count"])

    return {
        "unit_name": unit_name,
        "scale_to_m": scale_to_m,
        "unit_detection_reason": unit_detection_reason,
        "dxf_version": dxf_version,
        "header_insunits": insunits,
        "bbox_raw": {
            "min_x": round(min_x, 3),
            "min_y": round(min_y, 3),
            "max_x": round(max_x, 3),
            "max_y": round(max_y, 3),
            "width": round(max_x - min_x, 3),
            "height": round(max_y - min_y, 3),
        },
        "bbox_full": {
            "min_x": round(full_min_x, 3),
            "min_y": round(full_min_y, 3),
            "max_x": round(full_max_x, 3),
            "max_y": round(full_max_y, 3),
        },
        "diagnostics": {
            "top_level_entity_counts": dict(top_level_counts),
            "expanded_primitive_counts": dict(expanded_counts),
            "total_top_level_entities": sum(top_level_counts.values()),
            "total_rendered_primitives": (
                len(raw_lines) + len(raw_polylines) + len(raw_arcs_circles) + len(raw_texts) + len(raw_hatches)
            ),
            "layers_count": len(active_layers),
            "blocks_definitions_count": len(doc.blocks),
            "sheets_detected_count": len(detected_sheets),
        },
        "sheets": detected_sheets,
        "layers": active_layers,
        "lines": raw_lines,
        "polylines": raw_polylines,
        "arcs_circles": raw_arcs_circles,
        "inserts": raw_inserts,
        "texts": raw_texts,
        "hatches": raw_hatches,
        "tables": raw_tables,
    }


def extract_pdf_text_and_aspect(pdf_bytes: bytes, pdf_filename: str = "") -> Tuple[str, Optional[float]]:
    """
    Extracts plain text strings and page aspect ratio (width/height) from a PDF using stdlib zlib + regex.
    shortcut: parses standard FlateDecode/ASCII text streams; scanned image-only PDFs fall back to filename & aspect ratio.
    """
    chunks: List[str] = [Path(pdf_filename).stem.replace("_", " ").replace("-", " ")]
    aspect: Optional[float] = None

    mb = re.search(rb"/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]", pdf_bytes)
    if mb:
        try:
            w = abs(float(mb.group(3)) - float(mb.group(1)))
            h = abs(float(mb.group(4)) - float(mb.group(2)))
            if w > 1 and h > 1:
                aspect = w / h
        except Exception:
            pass

    def _collect_text_ops(buf: bytes):
        for m in re.finditer(rb"\(([^()\\]{2,120})\)", buf):
            try:
                s = m.group(1).decode("latin-1", errors="ignore").strip()
                if sum(c.isalnum() for c in s) >= 2:
                    chunks.append(s)
            except Exception:
                pass

    _collect_text_ops(pdf_bytes[:200000])
    for sm in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", pdf_bytes, re.DOTALL):
        raw_stream = sm.group(1)
        if len(raw_stream) > 2_000_000:
            continue
        try:
            decompressed = zlib.decompress(raw_stream)
            _collect_text_ops(decompressed)
        except Exception:
            pass

    return " ".join(chunks).upper(), aspect


def match_sheet_for_pdf(
    sheets: List[Dict[str, Any]],
    raw_texts: List[Dict[str, Any]],
    pdf_bytes: Optional[bytes] = None,
    pdf_filename: str = "",
) -> Tuple[Optional[Dict[str, Any]], str]:
    """
    Finds the sheet in a multi-sheet DWG that matches the uploaded PDF view.
    If no PDF text matches (or no PDF is uploaded yet), defaults to the primary Floor Plan sheet.
    """
    if not sheets:
        return None, "Single view DWG (full drawing shown)"

    if len(sheets) == 1:
        return sheets[0], f"Cleaned to sheet border: {sheets[0]['name']}"

    if pdf_bytes or pdf_filename:
        pdf_text_u, pdf_aspect = extract_pdf_text_and_aspect(pdf_bytes or b"", pdf_filename)
        best_sheet = None
        best_score = -1.0

        for s in sheets:
            score = 0.0
            s_name_u = s["name"].upper()
            s_title_u = s.get("title", "").upper()

            if s_title_u and s_title_u in pdf_text_u:
                score += 50.0
            if s_name_u and s_name_u in pdf_text_u:
                score += 40.0

            # Token overlap on key architectural/structural sheet identifiers
            tokens = [tok for tok in re.split(r"[^A-Z0-9]+", s_name_u) if len(tok) >= 2]
            for tok in tokens:
                if re.search(rf"\b{re.escape(tok)}\b", pdf_text_u):
                    score += 8.0 if tok in ("GROUND", "1ST", "2ND", "3RD", "4TH", "5TH", "TYPICAL", "TERRACE", "CENTERLINE", "LINEOUT", "KHUNT", "SECTION", "ELEVATION") else 3.0

            # Check distinct text callouts inside this sheet bbox
            b = s["bbox"]
            sheet_texts = [
                t["text"].upper()
                for t in raw_texts
                if b["min_x"] <= t["x"] <= b["max_x"] and b["min_y"] <= t["y"] <= b["max_y"] and 4 <= len(t["text"]) <= 40
            ]
            matched_inner = sum(1 for st in sheet_texts[:80] if st in pdf_text_u)
            score += min(25.0, matched_inner * 2.5)

            if pdf_aspect and b["height"] > 0:
                s_aspect = b["width"] / b["height"]
                if abs(s_aspect - pdf_aspect) < 0.25:
                    score += 4.0

            if score > best_score:
                best_score = score
                best_sheet = s

        if best_sheet and best_score >= 10.0:
            return best_sheet, f"Matched PDF view: {best_sheet['name']} (isolated 1 of {len(sheets)} plans in DWG)"

    primary = sheets[0]
    return primary, f"Cleaned DWG to primary view: {primary['name']} (1 of {len(sheets)} plans in DWG)"


def clean_raw_data_to_sheet(
    full_raw: Dict[str, Any],
    sheet_id: Optional[str],
    override_scale_to_m: Optional[float] = None,
    custom_sheet: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Crops and cleans parsed DWG entities so only the target sheet view (matching the PDF or custom window) is shown,
    discarding all other plans, elevations, sections, and stray modelspace entities outside the sheet.
    """
    sheets = full_raw.get("sheets", [])
    target_sheet = custom_sheet
    if not target_sheet and sheet_id and sheet_id != "all":
        target_sheet = next((s for s in sheets if s["id"] == sheet_id), None)

    scale_to_m = override_scale_to_m if override_scale_to_m is not None else full_raw.get("scale_to_m", 1.0)
    unit_name = next((n for s, n in SCALE_M_TO_UNIT_NAME if abs(s - scale_to_m) < 1e-5), full_raw.get("unit_name", "m"))
    orig_total = full_raw.get("diagnostics", {}).get("total_rendered_primitives", 0)

    if not target_sheet:
        out = dict(full_raw)
        out["scale_to_m"] = scale_to_m
        out["unit_name"] = unit_name
        out["active_sheet"] = None
        out["cleanup_stats"] = {
            "is_cropped": False,
            "original_primitives": orig_total,
            "cleaned_primitives": orig_total,
            "total_sheets_in_dwg": len(sheets),
        }
        return out

    b = target_sheet["bbox"]
    bw = b.get("width", abs(b["max_x"] - b["min_x"]))
    bh = b.get("height", abs(b["max_y"] - b["min_y"]))
    pad_x = max(0.5, bw * 0.025)
    pad_y = max(0.5, bh * 0.025)
    x1, y1 = b["min_x"] - pad_x, b["min_y"] - pad_y
    x2, y2 = b["max_x"] + pad_x, b["max_y"] + pad_y

    def in_box(px: float, py: float) -> bool:
        return x1 <= px <= x2 and y1 <= py <= y2

    lines = [
        ln for ln in full_raw.get("lines", [])
        if in_box(ln["start"][0], ln["start"][1]) and in_box(ln["end"][0], ln["end"][1])
    ]
    polylines = [
        pl for pl in full_raw.get("polylines", [])
        if pl.get("points") and all(in_box(pt[0], pt[1]) for pt in pl["points"])
    ]
    arcs_circles = [
        ac for ac in full_raw.get("arcs_circles", [])
        if in_box(ac["center"][0], ac["center"][1])
    ]
    texts = [
        t for t in full_raw.get("texts", [])
        if in_box(t["x"], t["y"])
    ]
    inserts = [
        ins for ins in full_raw.get("inserts", [])
        if in_box(ins["pos"][0], ins["pos"][1])
    ]
    hatches = [
        h for h in full_raw.get("hatches", [])
        if h.get("points") and in_box(h["points"][0][0], h["points"][0][1])
    ]

    layer_counts: Counter = Counter()
    for coll in (lines, polylines, arcs_circles, texts, hatches):
        for item in coll:
            layer_counts[item["layer"]] += 1

    cleaned_layers = []
    for lyr in full_raw.get("layers", []):
        cnt = layer_counts.get(lyr["name"], 0)
        if cnt > 0:
            cleaned_layers.append({**lyr, "entity_count": cnt})
    cleaned_layers.sort(key=lambda x: -x["entity_count"])

    cleaned_total = len(lines) + len(polylines) + len(arcs_circles) + len(texts) + len(hatches)

    return {
        "unit_name": unit_name,
        "scale_to_m": scale_to_m,
        "unit_detection_reason": full_raw.get("unit_detection_reason", ""),
        "dxf_version": full_raw.get("dxf_version", ""),
        "bbox_raw": b,
        "bbox_full": full_raw.get("bbox_full", b),
        "active_sheet": target_sheet,
        "cleanup_stats": {
            "is_cropped": True,
            "sheet_id": target_sheet["id"],
            "sheet_name": target_sheet["name"],
            "original_primitives": orig_total,
            "cleaned_primitives": cleaned_total,
            "removed_primitives": max(0, orig_total - cleaned_total),
            "total_sheets_in_dwg": len(sheets),
        },
        "diagnostics": {
            **full_raw.get("diagnostics", {}),
            "total_rendered_primitives": cleaned_total,
            "layers_count": len(cleaned_layers),
        },
        "sheets": sheets,
        "layers": cleaned_layers,
        "lines": lines,
        "polylines": polylines,
        "arcs_circles": arcs_circles,
        "inserts": inserts,
        "texts": texts,
        "hatches": hatches,
        "tables": full_raw.get("tables", []),
    }


def crop_dxf_file_to_bbox(src_dxf: Path, dst_dxf: Path, bbox: Dict[str, float], doc: Any = None) -> None:
    """Writes a cleaned DXF file containing only modelspace entities inside bbox."""
    if doc is None:
        doc = load_ezdxf_doc(src_dxf)
    msp = doc.modelspace()
    pad_x = max(0.5, bbox["width"] * 0.025)
    pad_y = max(0.5, bbox["height"] * 0.025)
    x1, y1 = bbox["min_x"] - pad_x, bbox["min_y"] - pad_y
    x2, y2 = bbox["max_x"] + pad_x, bbox["max_y"] + pad_y

    def _entity_anchor(e) -> Optional[Tuple[float, float]]:
        et = e.dxftype()
        try:
            if et == "LINE":
                return (float(e.dxf.start.x), float(e.dxf.start.y))
            if et == "LWPOLYLINE":
                pts = list(e.get_points("xy"))
                return (float(pts[0][0]), float(pts[0][1])) if pts else None
            if et in ("CIRCLE", "ARC"):
                return (float(e.dxf.center.x), float(e.dxf.center.y))
            if et in ("TEXT", "MTEXT", "INSERT"):
                return (float(e.dxf.insert.x), float(e.dxf.insert.y))
        except Exception:
            return None
        return None

    to_delete = []
    for ent in msp:
        pt = _entity_anchor(ent)
        if pt is not None and not (x1 <= pt[0] <= x2 and y1 <= pt[1] <= y2):
            to_delete.append(ent)

    for ent in to_delete:
        try:
            msp.delete_entity(ent)
        except Exception:
            pass

    dst_dxf.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(str(dst_dxf))


def render_sheet_to_pdf_bytes(cleaned_raw: Dict[str, Any], title: str) -> bytes:
    """
    Renders a cleaned CAD view into a lightweight vector PDF (with dark blueprint background
    and embedded title/room texts) so every plan has a viewable PDF matching its isolated DWG view.
    """
    b = cleaned_raw["bbox_raw"]
    w_cad = max(1e-3, b["width"])
    h_cad = max(1e-3, b["height"])
    page_w = 842.0
    page_h = max(420.0, min(1190.0, round(page_w * (h_cad / w_cad), 1)))
    margin = 28.0
    scale = min((page_w - 2 * margin) / w_cad, (page_h - 2 * margin) / h_cad)
    ox = margin + ((page_w - 2 * margin) - w_cad * scale) / 2.0
    oy = margin + ((page_h - 2 * margin) - h_cad * scale) / 2.0

    def tx(x: float) -> float:
        return ox + (x - b["min_x"]) * scale

    def ty(y: float) -> float:
        return oy + (y - b["min_y"]) * scale

    ops: List[str] = [
        "0.04 0.08 0.16 rg",
        f"0 0 {page_w:.1f} {page_h:.1f} re f",
        "0.45 w",
        "0.75 0.86 0.98 RG",
    ]

    for ln in cleaned_raw.get("lines", [])[:6000]:
        x1, y1 = tx(ln["start"][0]), ty(ln["start"][1])
        x2, y2 = tx(ln["end"][0]), ty(ln["end"][1])
        ops.append(f"{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    ops.append("0.65 w 0.35 0.78 0.98 RG")
    for pl in cleaned_raw.get("polylines", [])[:3000]:
        pts = pl.get("points", [])
        if len(pts) < 2:
            continue
        segs = [f"{tx(pts[0][0]):.2f} {ty(pts[0][1]):.2f} m"]
        for p in pts[1:]:
            segs.append(f"{tx(p[0]):.2f} {ty(p[1]):.2f} l")
        segs.append("s" if pl.get("closed") else "S")
        ops.append(" ".join(segs))

    ops.append("0.95 0.97 1.0 rg")
    safe_title = re.sub(r"[^A-Za-z0-9 ._()+-]", "", title)[:80]
    ops.append(f"BT /F1 11 Tf {margin:.1f} {page_h - 20:.1f} Td ({safe_title}) Tj ET")

    for t in cleaned_raw.get("texts", [])[:350]:
        clean_t = re.sub(r"[^A-Za-z0-9 .:/+-]", "", t.get("text", ""))[:40].strip()
        if not clean_t:
            continue
        px, py = tx(t["x"]), ty(t["y"])
        fsize = max(5.0, min(11.0, (t.get("height", 0.25) or 0.25) * scale))
        ops.append(f"BT /F1 {fsize:.1f} Tf {px:.2f} {py:.2f} Td ({clean_t}) Tj ET")

    stream_bytes = zlib.compress("\n".join(ops).encode("latin-1"))

    objs: List[bytes] = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        f"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_w:.1f} {page_h:.1f}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n".encode("latin-1"),
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n",
        f"5 0 obj\n<< /Length {len(stream_bytes)} /Filter /FlateDecode >>\nstream\n".encode("latin-1") + stream_bytes + b"\nendstream\nendobj\n",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets: List[int] = []
    for o in objs:
        offsets.append(len(out))
        out.extend(o)
    xref_pos = len(out)
    out.extend(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode("latin-1"))
    for off in offsets:
        out.extend(f"{off:010d} 00000 n \n".encode("latin-1"))
    out.extend(
        f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("latin-1")
    )
    return bytes(out)


def merge_dwg_views_to_single_plan(
    selected_sheets: List[Dict[str, Any]],
    files_data: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Merges selected sheet views from one or multiple DWG/DXF files into a single unified plan modelspace.
    Each sheet view is isolated, normalized to meters, and laid out side-by-side with clean spacing
    so the user can view individual sheets or zoom out to see all floors in one unified plan.
    """
    if not selected_sheets:
        first_file = next(iter(files_data.values()), {}) if files_data else {}
        return dict(first_file.get("raw_data", {}))

    new_lines: List[Dict[str, Any]] = []
    new_polylines: List[Dict[str, Any]] = []
    new_arcs_circles: List[Dict[str, Any]] = []
    new_texts: List[Dict[str, Any]] = []
    new_hatches: List[Dict[str, Any]] = []
    new_inserts: List[Dict[str, Any]] = []
    merged_sheets: List[Dict[str, Any]] = []

    current_cursor_x = 0.0

    # Index files by both file_id and filename for resilient lookup
    file_lookup: Dict[str, Dict[str, Any]] = {}
    for k, v in files_data.items():
        file_lookup[k] = v
        fn = v.get("filename")
        if fn:
            file_lookup[fn] = v

    for idx, s in enumerate(selected_sheets):
        file_key = s.get("file_id") or s.get("source_file") or s.get("filename")
        file_info = file_lookup.get(file_key)
        if not file_info:
            file_info = next(iter(files_data.values()), {})

        source_raw = file_info.get("raw_data", {})
        scale_to_m = float(source_raw.get("scale_to_m", 1.0) or 1.0)

        # Crop entities to this sheet's boundary in its native coordinates
        has_matching_sheet = any(x.get("id") == s.get("id") for x in source_raw.get("sheets", []))
        cropped = clean_raw_data_to_sheet(
            source_raw,
            sheet_id=s.get("id"),
            custom_sheet=s if (s.get("is_custom_window") or not has_matching_sheet) else None,
        )

        b = s.get("bbox") or cropped.get("bbox_raw") or {"min_x": 0, "min_y": 0, "max_x": 50, "max_y": 50, "width": 50, "height": 50}
        orig_min_x = float(b["min_x"])
        orig_min_y = float(b["min_y"])
        orig_max_x = float(b["max_x"])
        orig_max_y = float(b["max_y"])

        # Convert to meters
        scaled_min_x = orig_min_x * scale_to_m
        scaled_min_y = orig_min_y * scale_to_m
        scaled_max_x = orig_max_x * scale_to_m
        scaled_max_y = orig_max_y * scale_to_m
        w = max(0.5, abs(scaled_max_x - scaled_min_x))
        h = max(0.5, abs(scaled_max_y - scaled_min_y))

        # Position at current cursor on baseline y = 0
        target_min_x = current_cursor_x
        target_max_x = current_cursor_x + w
        target_min_y = 0.0
        target_max_y = h
        dx = target_min_x - scaled_min_x
        dy = target_min_y - scaled_min_y

        for ln in cropped.get("lines", []):
            new_lines.append({
                "layer": ln.get("layer", "0"),
                "color": ln.get("color", "#f1f5f9"),
                "start": [ln["start"][0] * scale_to_m + dx, ln["start"][1] * scale_to_m + dy],
                "end": [ln["end"][0] * scale_to_m + dx, ln["end"][1] * scale_to_m + dy],
            })

        for pl in cropped.get("polylines", []):
            new_pts = [[pt[0] * scale_to_m + dx, pt[1] * scale_to_m + dy] for pt in pl.get("points", [])]
            new_polylines.append({
                "layer": pl.get("layer", "0"),
                "color": pl.get("color", "#f1f5f9"),
                "closed": pl.get("closed", False),
                "points": new_pts,
            })

        for ac in cropped.get("arcs_circles", []):
            new_arcs_circles.append({
                "layer": ac.get("layer", "0"),
                "color": ac.get("color", "#f1f5f9"),
                "type": ac.get("type", "CIRCLE"),
                "center": [ac["center"][0] * scale_to_m + dx, ac["center"][1] * scale_to_m + dy],
                "radius": ac["radius"] * scale_to_m,
                "start_angle": ac.get("start_angle", 0),
                "end_angle": ac.get("end_angle", 360),
            })

        for t in cropped.get("texts", []):
            new_texts.append({
                "layer": t.get("layer", "0"),
                "color": t.get("color", "#f1f5f9"),
                "text": t.get("text", ""),
                "x": t["x"] * scale_to_m + dx,
                "y": t["y"] * scale_to_m + dy,
                "height": (t.get("height", 0.25) or 0.25) * scale_to_m,
                "rotation": t.get("rotation", 0),
            })

        for hatch in cropped.get("hatches", []):
            new_h_pts = [[pt[0] * scale_to_m + dx, pt[1] * scale_to_m + dy] for pt in hatch.get("points", [])]
            new_hatches.append({
                "layer": hatch.get("layer", "0"),
                "color": hatch.get("color", "#f1f5f9"),
                "points": new_h_pts,
            })

        for ins in cropped.get("inserts", []):
            new_inserts.append({
                "layer": ins.get("layer", "0"),
                "name": ins.get("name", ""),
                "pos": [ins["pos"][0] * scale_to_m + dx, ins["pos"][1] * scale_to_m + dy],
            })

        sheet_id = s.get("id") or f"sheet_{idx + 1}"
        merged_sheets.append({
            "id": sheet_id,
            "name": s.get("name") or f"Sheet {idx + 1}",
            "description": s.get("description", ""),
            "source_file": file_info.get("filename") or s.get("source_file", ""),
            "bbox": {
                "min_x": round(target_min_x, 3),
                "min_y": round(target_min_y, 3),
                "max_x": round(target_max_x, 3),
                "max_y": round(target_max_y, 3),
                "width": round(w, 3),
                "height": round(h, 3),
            },
            "is_custom_window": s.get("is_custom_window", False),
        })

        # Advance cursor with handsome margin between floor plans
        spacing = max(15.0, max(w, h) * 0.12)
        current_cursor_x = target_max_x + spacing

    # Calculate unified master bounding box
    max_x = max((s["bbox"]["max_x"] for s in merged_sheets), default=100.0)
    max_y = max((s["bbox"]["max_y"] for s in merged_sheets), default=100.0)
    bbox_full = {
        "min_x": 0.0,
        "min_y": 0.0,
        "max_x": round(max_x, 3),
        "max_y": round(max_y, 3),
        "width": round(max_x, 3),
        "height": round(max_y, 3),
    }

    # Consolidated layers
    layer_counts: Counter = Counter()
    for coll in (new_lines, new_polylines, new_arcs_circles, new_texts, new_hatches):
        for item in coll:
            layer_counts[item["layer"]] += 1

    layer_colors: Dict[str, str] = {}
    for f in files_data.values():
        for lyr in f.get("raw_data", {}).get("layers", []):
            if lyr.get("name") and lyr.get("color"):
                layer_colors[lyr["name"]] = lyr["color"]

    merged_layers = []
    for lyr_name, count in layer_counts.most_common():
        merged_layers.append({
            "name": lyr_name,
            "color": layer_colors.get(lyr_name, "#f1f5f9"),
            "entity_count": count,
            "visible": True,
        })

    total_primitives = (
        len(new_lines) + len(new_polylines) + len(new_arcs_circles) + len(new_texts) + len(new_hatches)
    )

    return {
        "unit_name": "m",
        "scale_to_m": 1.0,
        "unit_detection_reason": "Unified meters across merged multi-DWG sheets",
        "dxf_version": "Merged Plan",
        "bbox_raw": bbox_full,
        "bbox_full": bbox_full,
        "sheets": merged_sheets,
        "layers": merged_layers,
        "lines": new_lines,
        "polylines": new_polylines,
        "arcs_circles": new_arcs_circles,
        "inserts": new_inserts,
        "texts": new_texts,
        "hatches": new_hatches,
        "diagnostics": {
            "total_rendered_primitives": total_primitives,
            "layers_count": len(merged_layers),
            "merged_files_count": len(files_data),
            "merged_sheets_count": len(merged_sheets),
        },
    }

