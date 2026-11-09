import json
from sqlmodel import Session
from app.database import engine, init_db
from app.models.schema import Plan, LlmCache
from app.services.structural_ai import (
    expand_compound_member_marks,
    normalize_schedule_tables,
    audit_bbs_is456,
)


def test_compound_marks_and_distinct_sections():
    # 1. Verify B1-1, B2-5, B3-6, B4-10, B5-100 are NEVER split into ranges
    for mark in ("B1-1", "B2-5", "B3-6", "B4-10", "B5-100"):
        assert expand_compound_member_marks(mark) == [mark], f"Failed on {mark}"

    # 2. Verify comma-separated compound marks keep each distinct mark intact
    assert expand_compound_member_marks("B1-1, B2-5, B3-6") == ["B1-1", "B2-5", "B3-6"]

    # 3. Verify explicit 'TO' range over compound marks expands properly
    assert expand_compound_member_marks("B1-1 TO B1-4") == ["B1-1", "B1-2", "B1-3", "B1-4"]

    # 3b. Verify zero-padding preservation for Neck Beams and Plinth Beams (NB01..NB04)
    assert expand_compound_member_marks("NB01 TO NB04") == ["NB01", "NB02", "NB03", "NB04"]
    assert expand_compound_member_marks("PB01 - PB05") == ["PB01", "PB02", "PB03", "PB04", "PB05"]
    assert expand_compound_member_marks("NB-01 TO NB-04") == ["NB-01", "NB-02", "NB-03", "NB-04"]

    # 4. Verify each compound beam mark retains its own distinct cross-section in table normalizer
    sample_table = {
        "title": "BEAM SCHEDULE",
        "headers": ["BEAM MARK", "SECTION SIZE (BxD)", "BOTTOM BARS", "TOP BARS", "STIRRUPS"],
        "rows": [
            ["B1-1", "230 x 450", "3-T16", "2-T12", "T8 @ 150 c/c"],
            ["B2-5", "230 x 600", "4-T20", "2-T16", "T8 @ 125 c/c"],
            ["B3-6", "300 x 600", "4-T25", "3-T16", "T10 @ 150 c/c"],
            ["B4-10", "300 x 750", "6-T25", "3-T20", "4L-T10 @ 100 c/c"],
            ["B5-100", "230 x 450", "2-T16", "2-T12", "T8 @ 175 c/c"],
        ],
    }
    norm = normalize_schedule_tables(None, [sample_table])["membersByMark"]
    assert norm["B1-1"]["widthMm"] == 230 and norm["B1-1"]["depthMm"] == 450
    assert norm["B2-5"]["widthMm"] == 230 and norm["B2-5"]["depthMm"] == 600
    assert norm["B3-6"]["widthMm"] == 300 and norm["B3-6"]["depthMm"] == 600
    assert norm["B4-10"]["widthMm"] == 300 and norm["B4-10"]["depthMm"] == 750
    assert norm["B4-10"]["stirrups"]["legs"] == 4
    assert norm["B5-100"]["widthMm"] == 230 and norm["B5-100"]["depthMm"] == 450
    print("test_compound_marks_and_distinct_sections passed!")


def test_is456_and_diameter_constraints_audit():
    members = [
        {
            "mark": "B2-5",
            "category": "beam",
            "widthMm": 230,
            "depthMm": 600,
            "mainBars": {"count": 4, "diameter": 25},
            "secondaryBars": {"count": 2, "diameter": 16},
            "stirrups": {"diameter": 8, "spacingMm": 350},
        }
    ]
    params = {"allowedDiameters": [8, 10, 12, 16, 20]}
    res = audit_bbs_is456(None, members, params)
    assert not res["passed"]
    clauses = [a["codeClause"] for a in res["anomalies"]]
    assert "Project Diameter Constraint" in clauses
    assert "IS 456 Cl. 26.5.1.5" in clauses
    print("test_is456_and_diameter_constraints_audit passed!")


def test_structural_estimate_and_cache_db():
    init_db()
    with Session(engine) as session:
        test_plan = Plan(
            name="Structural Test Plan",
            discipline="structural",
            project_name="Test Tower",
            structural_estimate_json=json.dumps(
                {"members": [{"name": "B2-5"}], "wastagePct": 3.0}
            ),
        )
        session.add(test_plan)
        cache_entry = LlmCache(
            hash_key="test_hash_123",
            task="test_task",
            model="meta-llama/Meta-Llama-3.1-8B-Instruct",
            response_json=json.dumps({"ok": True}),
            tokens_used=42,
        )
        cache_entry = session.merge(cache_entry)
        session.commit()
        session.refresh(test_plan)
        assert test_plan.id is not None
        assert "B2-5" in test_plan.structural_estimate_json

        session.delete(test_plan)
        session.delete(cache_entry)
        session.commit()
    print("test_structural_estimate_and_cache_db passed!")


def test_infer_longitudinal_section():
    from app.services.structural_ai import infer_longitudinal_section_ai

    sample_texts = [
        "L-SEC OF BEAM B1-1 TO B1-3 (GRID 1)",
        "SPAN 1: 3800",
        "SPAN 2: 4500",
        "SPAN 3: 3600",
        "SIZE: 230 x 450",
        "COL WIDTH: 400",
        "3-T20 BTM (CONT)",
        "2-T16 CURTAILED",
        "2-T12 TOP THRU",
        "2-T20 EXTRA @ SUPPORTS",
        "8mm @ 100 / 175 c/c",
    ]

    res = infer_longitudinal_section_ai(
        session=None,
        window_texts=sample_texts,
        candidate_beams=["B1-1", "B1-2", "B1-3"],
    )

    assert "B1-1" in res["beamMarks"]
    assert "B1-2" in res["beamMarks"]
    assert "B1-3" in res["beamMarks"]
    assert len(res["spans"]) >= 3
    assert res["spans"][0]["clearSpanMm"] == 3800
    assert res["spans"][1]["clearSpanMm"] == 4500
    assert res["spans"][2]["clearSpanMm"] == 3600
    assert res["reinforcement"]["bottomContinuousBars"]["diameter"] == 20
    assert res["reinforcement"]["bottomContinuousBars"]["count"] == 3
    assert res["reinforcement"]["bottomCurtailedBars"]["diameter"] == 16
    assert res["reinforcement"]["topContinuousBars"]["diameter"] == 12
    assert res["reinforcement"]["stirrups"]["spacingEndMm"] == 100
    assert res["reinforcement"]["stirrups"]["spacingMidMm"] == 175
    print("test_infer_longitudinal_section passed!")


def test_measured_spans_and_name_matching():
    from app.services.structural_ai import infer_longitudinal_section_ai, associate_sections_and_callouts

    # 1. Verify physical measured spans from CAD columns are preserved
    measured = [
        {"id": "span_1", "beamMark": "B1-1", "centerToCenterSpanMm": 4200, "clearSpanMm": 3850, "widthMm": 230, "depthMm": 450, "supportColLeftMm": 350, "supportColRightMm": 350},
        {"id": "span_2", "beamMark": "B1-2", "centerToCenterSpanMm": 4500, "clearSpanMm": 4150, "widthMm": 230, "depthMm": 450, "supportColLeftMm": 350, "supportColRightMm": 400},
    ]
    texts = ["L-SEC B1-1 + B1-2", "3-20# BTM CONT", "2-12# TOP CONT", "8# @ 100 / 175 c/c"]
    res = infer_longitudinal_section_ai(
        session=None,
        window_texts=texts,
        candidate_beams=["B1-1", "B1-2"],
        measured_spans=measured,
    )
    assert len(res["spans"]) == 2
    assert res["spans"][0]["centerToCenterSpanMm"] == 4200
    assert res["spans"][0]["clearSpanMm"] == 3850
    assert res["spans"][1]["centerToCenterSpanMm"] == 4500
    assert res["reinforcement"]["bottomContinuousBars"]["diameter"] == 20
    assert res["reinforcement"]["topContinuousBars"]["diameter"] == 12

    # 2. Verify associate_sections_and_callouts matches by beam name, not merely identical dimensions
    members = [
        {"mark": "B1-1", "widthMm": 230, "depthMm": 450},
        {"mark": "B5-1", "widthMm": 230, "depthMm": 450}, # Same size, different beam!
    ]
    sections = [
        {
            "title": "SECTION OF BEAM B1-1",
            "widthMm": 230,
            "depthMm": 450,
            "topBars": {"count": 2, "diameter": 16},
            "bottomBars": {"count": 3, "diameter": 20},
            "stirrups": {"diameter": 8, "spacingMm": 150},
            "texts": ["BEAM B1-1", "3-T20", "2-T16"],
        }
    ]
    assoc = associate_sections_and_callouts(None, members, sections)
    matched_marks = [m["memberMark"] for m in assoc.get("matches", [])]
    assert "B1-1" in matched_marks
    assert "B5-1" not in matched_marks, "B5-1 must NOT match Section of B1-1 just because dimensions are equal!"
    print("test_measured_spans_and_name_matching passed!")


if __name__ == "__main__":
    test_compound_marks_and_distinct_sections()
    test_is456_and_diameter_constraints_audit()
    test_structural_estimate_and_cache_db()
    test_infer_longitudinal_section()
    test_measured_spans_and_name_matching()
