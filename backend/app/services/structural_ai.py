import hashlib
import json
import math
import os
import re
import urllib.request
from typing import Any, Dict, List, Optional
from sqlmodel import Session, select

from app.models.schema import LlmCache
from app.services.logger import app_logger as logger

DEEPINFRA_URL = "https://api.deepinfra.com/v1/openai/chat/completions"
MODEL_TIER1_FAST = "meta-llama/Meta-Llama-3.1-8B-Instruct"
MODEL_TIER2_REASON = "meta-llama/Llama-3.3-70B-Instruct"


def expand_compound_member_marks(
    raw_cell: str, known_layout_marks: Optional[List[str]] = None
) -> List[str]:
    """
    Expands schedule table mark cells while strictly preserving compound hyphenated marks
    such as B1-1, B2-5, B3-6, B4-10, B5-100.
    A hyphen inside a single token (Prefix+Num-Num, e.g. 'B2-5') is NEVER treated as a range.
    Ranges only expand when both endpoints carry the structural prefix (e.g. 'B1-1 TO B1-4', 'B1 TO B4', 'C1 - C4').
    """
    if not raw_cell or not raw_cell.strip():
        return []

    clean = raw_cell.strip().upper()
    # Strip parenthetical size suffix like "B2-5 (230X450)"
    clean = re.sub(r"\(\s*\d+\s*[*X×/]\s*\d+[^)]*\)", "", clean).strip()

    known_set = {m.strip().upper() for m in (known_layout_marks or []) if m}
    if clean in known_set:
        return [clean]

    parts = re.split(r"[,;&/]+|\bAND\b", clean)
    expanded: List[str] = []

    # Compound range: e.g. "B1-1 TO B1-4" or "B1-1 - B1-4"
    compound_range_re = re.compile(
        r"^([A-Z]{1,4}\d{1,3})-(\d{1,4})\s*(?:TO|THROUGH|THRU|-|–)\s*\1-(\d{1,4})$"
    )
    # Simple range where BOTH sides have the alpha prefix: e.g. "B1 TO B4", "NB01 TO NB04", "NB-01 TO NB-04", or "C1 - C6"
    simple_prefix_range_re = re.compile(
        r"^([A-Z]{1,4})(-?)(\d{1,4})\s*(?:TO|THROUGH|THRU|-|–)\s*\1\2(\d{1,4})$"
    )
    # Single valid structural mark (including compound B1-1, B2-5, B5-100, C1A)
    single_mark_re = re.compile(
        r"^([1-9]?[A-Z]{1,4}-?\d{1,4}(?:-\d{1,4}|[A-Z]|-[A-Z])?)$"
    )

    for raw_part in parts:
        p = raw_part.strip()
        if not p:
            continue

        if p in known_set:
            expanded.append(p)
            continue

        m_comp = compound_range_re.match(p)
        if m_comp:
            prefix, start_s, end_s = m_comp.group(1), int(m_comp.group(2)), int(m_comp.group(3))
            pad_len = len(m_comp.group(2))
            if 0 < end_s - start_s <= 50:
                for idx in range(start_s, end_s + 1):
                    num_str = str(idx).zfill(pad_len) if pad_len > 1 else str(idx)
                    expanded.append(f"{prefix}-{num_str}")
                continue

        # Only treat as simple prefix range if 'TO'/'THRU' is present OR spaces surround hyphen with prefix on both sides
        if re.search(r"\b(?:TO|THROUGH|THRU)\b|\s+[-–]\s+", p):
            m_simp = simple_prefix_range_re.match(p)
            if m_simp:
                prefix, sep, start_s, end_s = m_simp.group(1), m_simp.group(2), int(m_simp.group(3)), int(m_simp.group(4))
                pad_len = len(m_simp.group(3))
                if 0 < end_s - start_s <= 50:
                    for idx in range(start_s, end_s + 1):
                        num_str = str(idx).zfill(pad_len) if pad_len > 1 else str(idx)
                        expanded.append(f"{prefix}{sep}{num_str}")
                    continue

        m_single = single_mark_re.match(p)
        if m_single:
            expanded.append(m_single.group(1))
        else:
            # Extract leading compound token if followed by notes
            m_lead = re.match(r"^([1-9]?[A-Z]{1,4}\d{1,4}-\d{1,4}|[1-9]?[A-Z]{1,4}-?\d{1,4}[A-Z]?)\b", p)
            if m_lead:
                expanded.append(m_lead.group(1))

    # Deduplicate preserving order
    seen = set()
    result = []
    for item in expanded:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def _call_deepinfra_json(
    session: Optional[Session],
    task_name: str,
    model: str,
    system_prompt: str,
    user_payload: Any,
    max_tokens: int = 900,
) -> Optional[Dict[str, Any]]:
    """
    Calls DeepInfra OpenAI-compatible chat completions with strict JSON output and SQLite hash caching.
    """
    canonical_payload = json.dumps(user_payload, sort_keys=True, ensure_ascii=False)
    hash_input = f"{model}:{task_name}:{system_prompt}:{canonical_payload}"
    hash_key = hashlib.sha256(hash_input.encode("utf-8")).hexdigest()

    if session is not None:
        cached = session.get(LlmCache, hash_key)
        if cached and cached.response_json:
            try:
                return json.loads(cached.response_json)
            except Exception:
                pass

    api_key = (os.getenv("DEEPINFRA_API") or os.getenv("DEEPINFRA_API_KEY") or "").strip()
    if not api_key:
        return None

    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": canonical_payload},
        ],
        "temperature": 0.0,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }).encode("utf-8")

    req = urllib.request.Request(
        DEEPINFRA_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw_resp = json.loads(resp.read().decode("utf-8"))
            content = raw_resp["choices"][0]["message"]["content"]
            tokens = int(raw_resp.get("usage", {}).get("total_tokens", 0))
            parsed = json.loads(content)
            if session is not None:
                session.merge(
                    LlmCache(
                        hash_key=hash_key,
                        task=task_name,
                        model=model,
                        response_json=json.dumps(parsed),
                        tokens_used=tokens,
                    )
                )
                session.commit()
            return parsed
    except Exception as exc:
        logger.warning(f"DeepInfra call ({task_name}) fallback to deterministic: {exc}")
        return None


def analyze_sheets_and_specs(
    session: Optional[Session],
    sheets: List[Dict[str, Any]],
    general_notes_texts: List[str],
) -> Dict[str, Any]:
    """
    Agent 1 (Llama-3.1-8B): Classifies and names drawing sheets & layouts.
    Agent 2 (Llama-3.3-70B): Extracts IS 456 / IS 2502 / IS 13920 specifications from General Notes.
    """
    # Deterministic baseline specs (IS 456 defaults)
    specs: Dict[str, Any] = {
        "concreteGrade": "M25",
        "steelGrade": "Fe500D",
        "lapLengthMultiplier": 50,
        "hookAllowanceMultiplier": 24,
        "maxStockLengthM": 12.0,
        "defaultFloorHeightMm": 3000,
        "defaultCoverMm": {"footing": 50, "column": 40, "beam": 25, "slab": 20},
    }

    joined_notes = " ".join(general_notes_texts[:80])
    # Fast deterministic regex extraction from General Notes first
    m_conc = re.search(r"\b(M-?(?:20|25|30|35|40|45|50))\b", joined_notes, re.I)
    if m_conc:
        specs["concreteGrade"] = m_conc.group(1).upper().replace("-", "")
    m_steel = re.search(r"\b(FE-?(?:415|500|500D|550|550D))\b", joined_notes, re.I)
    if m_steel:
        specs["steelGrade"] = m_steel.group(1).upper().replace("FE", "Fe").replace("-", "")
    m_lap = re.search(r"(?:lap|development)\s*(?:length)?[^0-9]{0,20}(\d{2})\s*[dD\u03A6\u00D8]", joined_notes, re.I)
    if m_lap:
        lap_val = int(m_lap.group(1))
        if 30 <= lap_val <= 65:
            specs["lapLengthMultiplier"] = lap_val

    # Sheet classification payload (pruned to <= 10 title strings per sheet)
    compact_sheets = [
        {
            "id": s.get("id"),
            "raw_title": s.get("title") or s.get("name"),
            "texts": (s.get("title_block_texts") or [])[:10],
        }
        for s in sheets
    ]

    classified_sheets = []
    if compact_sheets:
        ai_sheets = _call_deepinfra_json(
            session=session,
            task_name="sheet_namer_v1",
            model=MODEL_TIER1_FAST,
            system_prompt=(
                "You are a structural CAD sheet classifier. Given sheet IDs and title block texts, "
                "return JSON: {\"sheets\": [{\"id\": str, \"name\": str, \"sheet_number\": str, "
                "\"category\": \"framing_plan\"|\"schedule_table\"|\"section_details\"|\"general_notes\", "
                "\"floor_level\": str}]}. Keep names concise and human-friendly."
            ),
            user_payload=compact_sheets,
            max_tokens=600,
        )
        if ai_sheets and isinstance(ai_sheets.get("sheets"), list):
            classified_sheets = ai_sheets["sheets"]

    if general_notes_texts:
        ai_specs = _call_deepinfra_json(
            session=session,
            task_name="is_spec_extractor_v1",
            model=MODEL_TIER2_REASON,
            system_prompt=(
                "Extract Indian Standard (IS 456 / IS 13920) structural specifications from these CAD General Notes. "
                "Return JSON: {\"concreteGrade\": \"M25\", \"steelGrade\": \"Fe500D\", \"lapLengthMultiplier\": 50, "
                "\"defaultCoverMm\": {\"footing\": 50, \"column\": 40, \"beam\": 25, \"slab\": 20}}"
            ),
            user_payload=general_notes_texts[:50],
            max_tokens=400,
        )
        if ai_specs:
            if ai_specs.get("concreteGrade"):
                specs["concreteGrade"] = str(ai_specs["concreteGrade"])
            if ai_specs.get("steelGrade"):
                specs["steelGrade"] = str(ai_specs["steelGrade"])
            if isinstance(ai_specs.get("lapLengthMultiplier"), (int, float)):
                specs["lapLengthMultiplier"] = int(ai_specs["lapLengthMultiplier"])
            if isinstance(ai_specs.get("defaultCoverMm"), dict):
                for k in ("footing", "column", "beam", "slab"):
                    v = ai_specs["defaultCoverMm"].get(k)
                    if isinstance(v, (int, float)) and 10 <= v <= 100:
                        specs["defaultCoverMm"][k] = int(v)

    return {"sheets": classified_sheets, "specs": specs}


def normalize_schedule_tables(
    session: Optional[Session],
    tables: List[Dict[str, Any]],
    known_layout_marks: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Agent 3: Normalizes extracted CAD schedule tables, expands multi-mark cells while preserving
    compound member names (B1-1, B2-5, B3-6, B4-10, B5-100), and resolves per-member sections & rebar.
    """
    member_records: Dict[str, Dict[str, Any]] = {}
    unparsed_rows: List[Dict[str, Any]] = []

    for tbl in tables:
        headers = [str(h).lower() for h in (tbl.get("headers") or [])]
        rows = tbl.get("rows") or []
        mark_col = 0
        size_col = -1
        top_col = -1
        btm_col = -1
        main_col = -1
        ties_col = -1

        for idx, h in enumerate(headers):
            if any(k in h for k in ("mark", "member", "beam", "col", "no", "id")):
                mark_col = idx
            elif any(k in h for k in ("size", "dim", "b x d", "bxd", "section", "width")):
                size_col = idx
            elif "top" in h or "hanger" in h:
                top_col = idx
            elif "bottom" in h or "btm" in h:
                btm_col = idx
            elif any(k in h for k in ("tie", "stirrup", "ring", "link", "shear")):
                ties_col = idx
            elif any(k in h for k in ("main", "longitudinal", "vertical", "reinf", "steel")):
                main_col = idx

        for r_idx, row in enumerate(rows):
            if not row or mark_col >= len(row):
                continue
            raw_mark_cell = str(row[mark_col] or "").strip()
            if not raw_mark_cell:
                continue

            marks = expand_compound_member_marks(raw_mark_cell, known_layout_marks)
            if not marks:
                continue

            # Extract size (WxD) from size_col or any cell in row
            w_mm, d_mm = None, None
            size_candidates = [row[size_col]] if (0 <= size_col < len(row)) else row
            for cell in size_candidates:
                m_sz = re.search(r"(\d{2,4})\s*[*xX×/]\s*(\d{2,4})", str(cell or ""))
                if m_sz:
                    w_val, d_val = int(m_sz.group(1)), int(m_sz.group(2))
                    if w_val <= 36 and d_val <= 48:
                        w_val, d_val = round(w_val * 25.4), round(d_val * 25.4)
                    if 100 <= w_val <= 3000 and 100 <= d_val <= 3500:
                        w_mm, d_mm = w_val, d_val
                        break

            # Parse rebar strings
            main_str = str(row[btm_col if btm_col >= 0 else main_col] if (btm_col >= 0 or main_col >= 0) and max(btm_col, main_col) < len(row) else "")
            top_str = str(row[top_col] if 0 <= top_col < len(row) else "")
            ties_str = str(row[ties_col] if 0 <= ties_col < len(row) else "")

            main_match = re.search(r"(\d+)\s*[-xX]?\s*(?:[tTyY#]|dia|mm|\u03A6|\u00D8)?\s*(\d{1,2})", main_str)
            top_match = re.search(r"(\d+)\s*[-xX]?\s*(?:[tTyY#]|dia|mm|\u03A6|\u00D8)?\s*(\d{1,2})", top_str)
            tie_match = re.search(r"(\d{1,2})\s*(?:[tTyY#]|dia|mm|\u03A6|\u00D8)?\s*(?:@|at)\s*(\d{2,3})", ties_str, re.I)

            if not (w_mm and d_mm) and len(unparsed_rows) < 25:
                unparsed_rows.append({"marks": marks, "row": row, "headers": headers})

            for mk in marks:
                member_records[mk] = {
                    "mark": mk,
                    "widthMm": w_mm,
                    "depthMm": d_mm,
                    "mainBars": {"count": int(main_match.group(1)), "diameter": int(main_match.group(2))} if main_match else None,
                    "secondaryBars": {"count": int(top_match.group(1)), "diameter": int(top_match.group(2))} if top_match else None,
                    "stirrups": {"diameter": int(tie_match.group(1)), "spacingMm": int(tie_match.group(2)), "legs": 4 if "4l" in ties_str.lower() else 2} if tie_match else None,
                    "sourceTableTitle": tbl.get("title") or "Schedule Table",
                }

    if unparsed_rows:
        ai_parsed = _call_deepinfra_json(
            session=session,
            task_name="table_row_normalizer_v1",
            model=MODEL_TIER1_FAST,
            system_prompt=(
                "Parse these structural schedule table rows into JSON: "
                "{\"items\": [{\"marks\": [str], \"widthMm\": int, \"depthMm\": int, "
                "\"mainBars\": {\"count\": int, \"diameter\": int}, "
                "\"secondaryBars\": {\"count\": int, \"diameter\": int}, "
                "\"stirrups\": {\"diameter\": int, \"spacingMm\": int, \"legs\": int}}]}. "
                "Preserve compound marks like B1-1, B2-5, B5-100 exactly."
            ),
            user_payload=unparsed_rows,
            max_tokens=800,
        )
        if ai_parsed and isinstance(ai_parsed.get("items"), list):
            for item in ai_parsed["items"]:
                for mk in item.get("marks") or []:
                    mk_u = str(mk).strip().upper()
                    existing = member_records.get(mk_u, {"mark": mk_u})
                    if item.get("widthMm") and item.get("depthMm"):
                        existing["widthMm"] = int(item["widthMm"])
                        existing["depthMm"] = int(item["depthMm"])
                    if item.get("mainBars"):
                        existing["mainBars"] = item["mainBars"]
                    if item.get("secondaryBars"):
                        existing["secondaryBars"] = item["secondaryBars"]
                    if item.get("stirrups"):
                        existing["stirrups"] = item["stirrups"]
                    member_records[mk_u] = existing

    return {"membersByMark": member_records}


def associate_sections_and_callouts(
    session: Optional[Session],
    members: List[Dict[str, Any]],
    section_clusters: List[Dict[str, Any]],
    allowed_diameters: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """
    Agent 4 (Llama-3.1-8B): Matches framing layout members (e.g. B1-1, B2-5, B3-6)
    with scattered cross-section detail clusters across sheets and returns human-in-the-loop matches.
    """
    if not members or not section_clusters:
        return {"matches": []}

    matches: List[Dict[str, Any]] = []
    unmatched_members: List[Dict[str, Any]] = []

    # Pass 1: Deterministic exact & series token correlation
    for m in members:
        mk = str(m.get("mark") or "").strip().upper()
        if not mk:
            continue
        best_sec = None
        best_conf = 0.0

        for sec in section_clusters:
            sec_title = str(sec.get("title") or "").upper()
            sec_texts = " ".join(str(t) for t in (sec.get("texts") or [])).upper()
            combined = f"{sec_title} {sec_texts}"

            # Check exact compound mark match (e.g. B2-5 inside section title/texts)
            escaped_mk = re.escape(mk)
            if re.search(rf"(^|[^A-Z0-9\-_]){escaped_mk}([^A-Z0-9\-_]|$)", combined):
                best_sec = sec
                best_conf = 0.95
                break

            # Check prefix series match (e.g. B2-5 matching "BEAM B2" only if dimensions also match)
            base_prefix = mk.split("-")[0] if "-" in mk else ""
            if base_prefix and re.search(rf"(^|[^A-Z0-9\-_]){re.escape(base_prefix)}([^A-Z0-9\-_]|$)", sec_title):
                if sec.get("widthMm") == m.get("widthMm") and sec.get("depthMm") == m.get("depthMm"):
                    best_sec = sec
                    best_conf = 0.84

        if best_sec:
            matches.append({
                "memberMark": mk,
                "sectionTitle": best_sec.get("title") or "Cross-Section Detail",
                "sheetId": best_sec.get("sheetId") or "all",
                "confidence": best_conf,
                "widthMm": best_sec.get("widthMm") or m.get("widthMm"),
                "depthMm": best_sec.get("depthMm") or m.get("depthMm"),
                "topBars": best_sec.get("topBars"),
                "topExtraBars": best_sec.get("topExtraBars"),
                "bottomBars": best_sec.get("bottomBars"),
                "stirrups": best_sec.get("stirrups"),
                "status": "pending",
            })
        else:
            unmatched_members.append({"mark": mk, "widthMm": m.get("widthMm"), "depthMm": m.get("depthMm")})

    # Pass 2: Tier-1 LLM semantic association for remaining unmatched members
    if unmatched_members and section_clusters:
        ai_assoc = _call_deepinfra_json(
            session=session,
            task_name="section_associator_v1",
            model=MODEL_TIER1_FAST,
            system_prompt=(
                "Match unmatched structural members to cross-section detail clusters. "
                "CRITICAL: Match strictly based on beam names or beam series (e.g. B1-1, B2-5, or family B1). "
                "NEVER match different beam names merely because they have identical dimensions. Return JSON: "
                "{\"matches\": [{\"memberMark\": str, \"sectionIndex\": int, \"confidence\": float}]}"
            ),
            user_payload={
                "unmatched": unmatched_members[:30],
                "sections": [
                    {
                        "index": i,
                        "title": s.get("title"),
                        "widthMm": s.get("widthMm"),
                        "depthMm": s.get("depthMm"),
                        "texts": (s.get("texts") or [])[:8],
                    }
                    for i, s in enumerate(section_clusters[:25])
                ],
            },
            max_tokens=600,
        )
        if ai_assoc and isinstance(ai_assoc.get("matches"), list):
            for item in ai_assoc["matches"]:
                idx = item.get("sectionIndex")
                conf = float(item.get("confidence") or 0.0)
                if isinstance(idx, int) and 0 <= idx < len(section_clusters) and conf >= 0.65:
                    sec = section_clusters[idx]
                    mm = str(item.get("memberMark") or "").strip().upper()
                    sec_title = str(sec.get("title") or "").upper()
                    sec_texts = " ".join(str(t) for t in (sec.get("texts") or [])).upper()
                    sec_comb = f"{sec_title} {sec_texts}"
                    base_pre = mm.split("-")[0] if "-" in mm else mm

                    # Strictly verify that beam name or family corresponds before accepting match
                    has_name_match = bool(
                        re.search(rf"(^|[^A-Z0-9\-_]){re.escape(mm)}([^A-Z0-9\-_]|$)", sec_comb)
                        or (base_pre and re.search(rf"(^|[^A-Z0-9\-_]){re.escape(base_pre)}([^A-Z0-9\-_]|$)", sec_title))
                    )
                    if not has_name_match:
                        continue

                    matches.append({
                        "memberMark": item.get("memberMark"),
                        "sectionTitle": sec.get("title") or "Cross-Section Detail",
                        "sheetId": sec.get("sheetId") or "all",
                        "confidence": round(conf, 2),
                        "widthMm": sec.get("widthMm"),
                        "depthMm": sec.get("depthMm"),
                        "topBars": sec.get("topBars"),
                        "topExtraBars": sec.get("topExtraBars"),
                        "bottomBars": sec.get("bottomBars"),
                        "stirrups": sec.get("stirrups"),
                        "status": "pending",
                    })

    return {"matches": matches}


def audit_bbs_is456(
    session: Optional[Session],
    members: List[Dict[str, Any]],
    parameters: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Agent 5: Deterministic IS 456:2000 / IS 13920:2016 code compliance audit + Senior Checker review.
    """
    anomalies: List[Dict[str, Any]] = []
    allowed_dias = set(parameters.get("allowedDiameters") or [8, 10, 12, 16, 20, 25, 28, 32])

    for m in members:
        mk = m.get("mark") or "M1"
        cat = m.get("category") or "beam"
        b = float(m.get("widthMm") or 230)
        d = float(m.get("depthMm") or 450)
        gross_area = max(1.0, b * d)

        main_bars = m.get("mainBars") or {"count": 4, "diameter": 16}
        sec_bars = m.get("secondaryBars") or {"count": 2, "diameter": 12}
        stirrups = m.get("stirrups") or {"diameter": 8, "spacingMm": 150}

        # Check allowed diameter constraint from Step 1
        for role_label, bar_obj in [("Main", main_bars), ("Secondary", sec_bars), ("Stirrup", stirrups)]:
            dia = int(bar_obj.get("diameter") or 0)
            if dia > 0 and dia not in allowed_dias:
                anomalies.append({
                    "memberMark": mk,
                    "severity": "warning",
                    "codeClause": "Project Diameter Constraint",
                    "message": f"{mk}: {role_label} bar Φ{dia}mm is outside project's allowed diameters ({sorted(allowed_dias)} mm).",
                })

        # Steel percentage pt% check per IS 456:2000
        ast_main = int(main_bars.get("count") or 0) * (math.pi * (float(main_bars.get("diameter") or 16) ** 2) / 4.0)
        ast_sec = int(sec_bars.get("count") or 0) * (math.pi * (float(sec_bars.get("diameter") or 12) ** 2) / 4.0)

        if cat == "column":
            pt_total = (ast_main / gross_area) * 100.0
            if pt_total < 0.8:
                anomalies.append({
                    "memberMark": mk,
                    "severity": "error",
                    "codeClause": "IS 456 Cl. 26.5.3.1",
                    "message": f"{mk} ({int(b)}×{int(d)}): Longitudinal steel is {pt_total:.2f}% (< 0.80% min column steel).",
                })
            elif pt_total > 4.0:
                anomalies.append({
                    "memberMark": mk,
                    "severity": "warning",
                    "codeClause": "IS 456 Cl. 26.5.3.1",
                    "message": f"{mk} ({int(b)}×{int(d)}): Longitudinal steel is {pt_total:.2f}% (> 4.0% practical limit for lapped columns).",
                })
        elif cat == "beam":
            pt_tension = (ast_main / gross_area) * 100.0
            if pt_tension < 0.18:
                anomalies.append({
                    "memberMark": mk,
                    "severity": "error",
                    "codeClause": "IS 456 Cl. 26.5.1.1",
                    "message": f"{mk} ({int(b)}×{int(d)}): Tension steel is {pt_tension:.2f}% (below IS 456 minimum 0.85/fy).",
                })
            elif pt_tension > 2.5:
                anomalies.append({
                    "memberMark": mk,
                    "severity": "warning",
                    "codeClause": "IS 456 Cl. 26.5.1.1b",
                    "message": f"{mk} ({int(b)}×{int(d)}): Tension steel is {pt_tension:.2f}% (> 2.5% congestion threshold).",
                })

            spacing = int(stirrups.get("spacingMm") or 150)
            max_allowed_spacing = min(int(0.75 * (d - 35)), 300)
            if spacing > max_allowed_spacing:
                anomalies.append({
                    "memberMark": mk,
                    "severity": "error",
                    "codeClause": "IS 456 Cl. 26.5.1.5",
                    "message": f"{mk}: Stirrup spacing {spacing}mm exceeds max allowed {max_allowed_spacing}mm (min of 0.75d, 300mm).",
                })

    return {
        "passed": len(anomalies) == 0,
        "anomalyCount": len(anomalies),
        "anomalies": anomalies,
    }


def infer_longitudinal_section_ai(
    session: Optional[Session],
    window_texts: List[str],
    candidate_beams: Optional[List[str]] = None,
    scale_to_m: float = 0.001,
    spatial_tokens: Optional[List[Dict[str, Any]]] = None,
    measured_spans: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Infers continuous beam Longitudinal Section (L-Section) details from windowed drawing texts and CAD geometry.
    Detects continuous spans, support column widths, continuous top/bottom bars,
    support top extra bars, and stirrups.
    Uses DeepInfra JSON LLM when available; falls back to deterministic regex parser.
    """
    clean_texts = [re.sub(r"\s+", " ", str(t or "")).strip() for t in window_texts if str(t or "").strip()]
    if spatial_tokens:
        sorted_tokens = sorted(
            spatial_tokens,
            key=lambda t: (float(t.get("x") or 0.0), float(t.get("y") or 0.0))
        )
        clean_texts = [re.sub(r"\s+", " ", str(t.get("text") or "")).strip() for t in sorted_tokens if str(t.get("text") or "").strip()]

    joined_text = " ".join(clean_texts)

    # 1. Deterministic Baseline Extraction
    # Name & Marks
    detected_marks: List[str] = []
    compound_range = re.search(r"\b([A-Z]{1,4}\d{1,3})-(\d{1,4})\s*(?:TO|THROUGH|THRU|-|–)\s*\1-(\d{1,4})\b", joined_text, re.I)
    if compound_range:
        prefix = compound_range.group(1).upper()
        s_idx, e_idx = int(compound_range.group(2)), int(compound_range.group(3))
        if 0 < e_idx - s_idx <= 25:
            detected_marks = [f"{prefix}-{i}" for i in range(s_idx, e_idx + 1)]

    if not detected_marks:
        known_set = set((candidate_beams or []))
        for t in clean_texts:
            t_u = t.upper()
            for km in known_set:
                if km in t_u and km not in detected_marks:
                    detected_marks.append(km)

    if not detected_marks:
        # Generic match for beam tokens: B1-1, B2-5, NB01, PB1, etc.
        found = re.findall(r"\b([1-9]?[NPFTBGRCSLWMDU]?B-?\d{1,4}(?:-\d{1,4}|[A-Z])?)\b", joined_text, re.I)
        seen = set()
        for f in found:
            fu = f.upper()
            if fu not in seen:
                seen.add(fu)
                detected_marks.append(fu)

    section_name = f"L-SEC: {' + '.join(detected_marks[:4])}" if detected_marks else "Longitudinal Section"
    m_title = re.search(r"\b((?:L-?SEC|LONGITUDINAL\s*SECTION|BEAM\s*ELEVATION)[^,\n]{0,40})\b", joined_text, re.I)
    if m_title:
        section_name = m_title.group(1).strip()

    # Dimensions / Spans (numbers >= 1500 and <= 15000 mm, or 1.5 to 15.0 m)
    spans_found: List[int] = []
    for t in clean_texts:
        m_num = re.findall(r"\b(\d{4,5})\b", t)
        for n in m_num:
            val = int(n)
            if 1200 <= val <= 18000:
                spans_found.append(val)
        m_m = re.findall(r"\b(\d{1,2}\.\d{1,2})\s*M\b", t, re.I)
        for nm in m_m:
            val = round(float(nm) * 1000)
            if 1200 <= val <= 18000:
                spans_found.append(val)

    # Size (width x depth)
    w_mm, d_mm = 230, 450
    m_sz = re.search(r"(\d{2,4})\s*[*xX×/]\s*(\d{2,4})", joined_text)
    if m_sz:
        c_w, c_d = int(m_sz.group(1)), int(m_sz.group(2))
        if 100 <= c_w <= 1500 and 150 <= c_d <= 2500:
            w_mm, d_mm = c_w, c_d

    # Column support widths (numbers 200 to 900)
    col_widths: List[int] = []
    for t in clean_texts:
        m_col = re.search(r"(?:col|support|width|c\d+)[^0-9]{0,10}(\d{3})\b", t, re.I)
        if m_col:
            cw = int(m_col.group(1))
            if 200 <= cw <= 1200:
                col_widths.append(cw)
    if not col_widths:
        col_widths = [300, 400]

    # Rebar callouts
    # Bottom main
    btm_bars = {"count": 3, "diameter": 20}
    m_btm = re.search(r"(\d+)\s*[-xX/]?\s*(?:[tTyY#]|dia|mm)?\s*(\d{1,2})\s*(?:[tTyY#]|dia|mm)?\s*(?:btm|bottom|main)", joined_text, re.I)
    if m_btm:
        btm_bars = {"count": int(m_btm.group(1)), "diameter": int(m_btm.group(2))}

    # Curtailed bottom
    curt_bars = {"count": 2, "diameter": 16, "curtailRatio": 0.15}
    m_curt = re.search(r"(\d+)\s*[-xX/]?\s*(?:[tTyY#]|dia|mm)?\s*(\d{1,2})\s*(?:[tTyY#]|dia|mm)?\s*(?:curtail|extra\s*btm)", joined_text, re.I)
    if m_curt:
        curt_bars = {"count": int(m_curt.group(1)), "diameter": int(m_curt.group(2)), "curtailRatio": 0.15}

    # Top continuous
    top_bars = {"count": 2, "diameter": 12}
    m_top = re.search(r"(\d+)\s*[-xX/]?\s*(?:[tTyY#]|dia|mm)?\s*(\d{1,2})\s*(?:[tTyY#]|dia|mm)?\s*(?:top|hanger|thru|through)", joined_text, re.I)
    if m_top:
        top_bars = {"count": int(m_top.group(1)), "diameter": int(m_top.group(2))}

    # Support top extra
    top_extra = {"count": 2, "diameter": 20, "extensionRatio": 0.33}
    m_extra = re.search(r"(\d+)\s*[-xX/]?\s*(?:[tTyY#]|dia|mm)?\s*(\d{1,2})\s*(?:[tTyY#]|dia|mm)?\s*(?:extra|support|hogging)", joined_text, re.I)
    if m_extra:
        top_extra = {"count": int(m_extra.group(1)), "diameter": int(m_extra.group(2)), "extensionRatio": 0.33}

    # Stirrups
    stirrups = {"diameter": 8, "legs": 2, "spacingEndMm": 100, "spacingMidMm": 175, "confinementZoneMm": int(2 * (d_mm - 40))}
    m_stir = re.search(r"(\d{1,2})\s*(?:[tTyY#]|dia|mm)?\s*(?:@|at)\s*(\d{2,3})(?:\s*[/&]\s*(\d{2,3}))?", joined_text, re.I)
    if m_stir:
        dia = int(m_stir.group(1))
        sp1 = int(m_stir.group(2))
        sp2 = int(m_stir.group(3)) if m_stir.group(3) else sp1
        stirrups["diameter"] = dia
        stirrups["spacingEndMm"] = min(sp1, sp2)
        stirrups["spacingMidMm"] = max(sp1, sp2)

    # Build spans list (using CAD physical column center-to-center measurements when provided)
    if measured_spans and len(measured_spans) > 0:
        spans_list = []
        for idx, ms in enumerate(measured_spans):
            spans_list.append({
                "id": str(ms.get("id") or f"span_{idx + 1}"),
                "beamMark": str(ms.get("beamMark") or f"B1-{idx + 1}"),
                "centerToCenterSpanMm": int(ms.get("centerToCenterSpanMm") or ms.get("clearSpanMm") or 4000),
                "clearSpanMm": int(ms.get("clearSpanMm") or 3650),
                "widthMm": int(ms.get("widthMm") or w_mm),
                "depthMm": int(ms.get("depthMm") or d_mm),
                "supportColLeftMm": int(ms.get("supportColLeftMm") or 300),
                "supportColRightMm": int(ms.get("supportColRightMm") or 350),
            })
        if not detected_marks:
            detected_marks = [s["beamMark"] for s in spans_list]
    else:
        span_count = max(len(detected_marks), len(spans_found), 2)
        spans_list = []
        for i in range(span_count):
            mk = detected_marks[i] if i < len(detected_marks) else f"Span {i + 1}"
            span_len = spans_found[i] if i < len(spans_found) else 3800
            c_left = col_widths[i % len(col_widths)]
            c_right = col_widths[(i + 1) % len(col_widths)]
            spans_list.append({
                "id": f"span_{i + 1}",
                "beamMark": mk,
                "clearSpanMm": span_len,
                "widthMm": w_mm,
                "depthMm": d_mm,
                "supportColLeftMm": c_left,
                "supportColRightMm": c_right,
            })

    fallback_result = {
        "name": section_name,
        "beamMarks": [s["beamMark"] for s in spans_list],
        "spans": spans_list,
        "reinforcement": {
            "bottomContinuousBars": btm_bars,
            "bottomCurtailedBars": curt_bars,
            "topContinuousBars": top_bars,
            "supportTopExtraBars": top_extra,
            "stirrups": stirrups,
        },
        "notes": f"Inferred from CAD Longitudinal Section ({len(spans_list)} continuous spans)",
    }

    # 2. AI Enhancement with Real CAD Elevation Geometry & 70B Reasoning Model
    top_zone_texts: List[str] = []
    mid_zone_texts: List[str] = []
    btm_zone_texts: List[str] = []

    if spatial_tokens and len(spatial_tokens) >= 2:
        y_vals = [float(t.get("y") or 0.0) for t in spatial_tokens]
        min_y, max_y = min(y_vals), max(y_vals)
        span_y = max(1e-4, max_y - min_y)
        mid_y = (min_y + max_y) / 2.0

        for t in spatial_tokens:
            txt = str(t.get("text") or "").strip()
            if not txt:
                continue
            ty = float(t.get("y") or 0.0)
            if ty > mid_y + 0.15 * span_y:
                top_zone_texts.append(txt)
            elif ty < mid_y - 0.15 * span_y:
                btm_zone_texts.append(txt)
            else:
                mid_zone_texts.append(txt)

    system_prompt = (
        "You are a senior AEC structural engineer and CAD detailing expert. Given CAD drawing geometry, "
        "measured physical spans, and elevation text callouts partitioned into Top, Web/Stirrup, and Bottom zones "
        "from a continuous beam Longitudinal Section (L-Section / elevation), parse the detailing per IS 13920 / IS 456 rules into JSON: "
        "{"
        "\"name\": string, "
        "\"beamMarks\": [string], "
        "\"spans\": [{\"id\": string, \"beamMark\": string, \"clearSpanMm\": int, \"widthMm\": int, \"depthMm\": int, \"supportColLeftMm\": int, \"supportColRightMm\": int}], "
        "\"reinforcement\": {"
        "  \"bottomContinuousBars\": {\"count\": int, \"diameter\": int}, "
        "  \"bottomCurtailedBars\": {\"count\": int, \"diameter\": int, \"curtailRatio\": float}, "
        "  \"topContinuousBars\": {\"count\": int, \"diameter\": int}, "
        "  \"supportTopExtraBars\": {\"count\": int, \"diameter\": int, \"extensionRatio\": float}, "
        "  \"stirrups\": {\"diameter\": int, \"legs\": int, \"spacingEndMm\": int, \"spacingMidMm\": int, \"confinementZoneMm\": int}"
        "}, "
        "\"notes\": string"
        "}"
        "\nRules:"
        "1. Strictly respect the provided measured_spans and support bearing widths ws."
        "2. Top rebar zone contains continuous through bars and support top extra bars (hogging negative moment, extending L/3 into adjacent spans)."
        "3. Bottom rebar zone contains bottom main tension bars and curtailed extra bars (typically extending between 0.15L and 0.85L)."
        "4. Web/stirrup zone contains shear links with closely spaced confinement stirrups (spacingEndMm) within 2d of supports and standard spacing (spacingMidMm) at mid-span."
    )

    user_payload = {
        "measured_spans": spans_list,
        "elevation_spatial_zones": {
            "top_rebar_zone": top_zone_texts[:30] if top_zone_texts else clean_texts[:20],
            "web_stirrup_zone": mid_zone_texts[:25] if mid_zone_texts else [],
            "bottom_rebar_zone": btm_zone_texts[:30] if btm_zone_texts else clean_texts[20:45],
        },
        "all_extracted_texts": clean_texts[:60],
        "candidate_beams": candidate_beams or [],
        "scale_to_m": scale_to_m,
    }

    ai_result = _call_deepinfra_json(
        session=session,
        task_name="infer_longitudinal_section_v1",
        model=MODEL_TIER2_REASON,
        system_prompt=system_prompt,
        user_payload=user_payload,
        max_tokens=1200,
    )

    if ai_result and isinstance(ai_result, dict) and ai_result.get("spans"):
        try:
            parsed_spans = []
            for idx, s in enumerate(ai_result.get("spans") or []):
                if isinstance(s, dict):
                    parsed_spans.append({
                        "id": f"span_{idx + 1}",
                        "beamMark": str(s.get("beamMark") or f"Span {idx + 1}"),
                        "clearSpanMm": int(s.get("clearSpanMm") or 3800),
                        "widthMm": int(s.get("widthMm") or w_mm),
                        "depthMm": int(s.get("depthMm") or d_mm),
                        "supportColLeftMm": int(s.get("supportColLeftMm") or 300),
                        "supportColRightMm": int(s.get("supportColRightMm") or 400),
                    })
            final_spans = spans_list if (measured_spans and len(measured_spans) > 0) else parsed_spans
            if final_spans:
                ai_reinf = ai_result.get("reinforcement") or {}
                merged_reinf = dict(fallback_result["reinforcement"])

                # Merge stirrups safely
                if isinstance(ai_reinf.get("stirrups"), dict):
                    ai_stir = ai_reinf["stirrups"]
                    fb_stir = merged_reinf.get("stirrups") or {}
                    try:
                        merged_reinf["stirrups"] = {
                            "diameter": int(ai_stir.get("diameter") or fb_stir.get("diameter") or 8),
                            "legs": int(ai_stir.get("legs") or fb_stir.get("legs") or 2),
                            "spacingEndMm": int(ai_stir.get("spacingEndMm") or fb_stir.get("spacingEndMm") or 100),
                            "spacingMidMm": int(ai_stir.get("spacingMidMm") or fb_stir.get("spacingMidMm") or 175),
                            "confinementZoneMm": int(ai_stir.get("confinementZoneMm") or fb_stir.get("confinementZoneMm") or 800),
                        }
                    except (ValueError, TypeError):
                        pass

                # Merge continuous bars safely
                for key in ["bottomContinuousBars", "bottomCurtailedBars", "topContinuousBars", "supportTopExtraBars"]:
                    if isinstance(ai_reinf.get(key), dict):
                        ai_sub = ai_reinf[key]
                        fb_sub = merged_reinf.get(key) or {}
                        try:
                            m_sub = dict(fb_sub)
                            if ai_sub.get("count") and int(ai_sub["count"]) > 0:
                                m_sub["count"] = int(ai_sub["count"])
                            if ai_sub.get("diameter") and int(ai_sub["diameter"]) >= 6:
                                m_sub["diameter"] = int(ai_sub["diameter"])
                            if "curtailRatio" in ai_sub and ai_sub["curtailRatio"] is not None:
                                m_sub["curtailRatio"] = float(ai_sub["curtailRatio"])
                            if "extensionRatio" in ai_sub and ai_sub["extensionRatio"] is not None:
                                m_sub["extensionRatio"] = float(ai_sub["extensionRatio"])
                            merged_reinf[key] = m_sub
                        except (ValueError, TypeError):
                            pass

                return {
                    "name": str(ai_result.get("name") or section_name),
                    "beamMarks": [s["beamMark"] for s in final_spans],
                    "spans": final_spans,
                    "reinforcement": merged_reinf,
                    "notes": str(ai_result.get("notes") or fallback_result["notes"]),
                }
        except Exception:
            pass

    return fallback_result


