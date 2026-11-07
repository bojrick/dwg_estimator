import sys
import os
import json
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from sqlmodel import SQLModel, Session, create_engine
from app.models.schema import Plan
from app.services.structural_ai import clean_names_and_sheets_ai
from app.routers.plans import (
    CleanNamesRequest,
    api_clean_names_and_sheets_general,
    api_clean_names_and_sheets_for_plan,
)


class TestAiCleanNames(unittest.TestCase):
    def test_clean_names_deterministic_fallback(self):
        res = clean_names_and_sheets_ai(
            session=None,
            filename="G_FLR_PLUMB_WTR_SPLY_REV04.DWG",
            sheets=[
                {"id": "s1", "name": "SHT_01_TOILET_DTL_REV02"},
                {"id": "s2", "name": "View 2", "candidate_texts": ["GROUND FLOOR RISER DIAGRAM", "SCALE 1:100"]},
            ],
            candidate_texts=["water supply pipe", "plumbing layout"],
        )
        self.assertIn("cleaned_title", res)
        self.assertEqual(res["discipline"], "plumbing")
        self.assertEqual(len(res["sheets"]), 2)
        self.assertNotIn(".DWG", res["cleaned_title"])
        self.assertNotIn("_", res["cleaned_title"])
        self.assertNotIn("_", res["sheets"][0]["name"])
        self.assertIn("Riser", res["sheets"][1]["name"])

    def test_clean_names_router_preview(self):
        req = CleanNamesRequest(
            filename="TOWER_B_BEAM_BBS_COL_REV01.dwg",
            sheets=[{"id": "s_beam", "name": "BEAM_SCHEDULE_L3"}],
            candidate_texts=["structural column", "beam schedule"],
            apply=False,
        )
        data = api_clean_names_and_sheets_general(req, session=None)
        self.assertIn("discipline", data)
        self.assertIn(data["discipline"], ["structural", "architectural", "electrical", "plumbing", "fire"])
        self.assertTrue(len(data["cleaned_title"]) > 3)
        self.assertEqual(len(data["sheets"]), 1)
        self.assertNotIn("_", data["sheets"][0]["name"])

    def test_clean_names_apply_persists_preserving_bbox(self):
        mem_engine = create_engine("sqlite:///:memory:")
        SQLModel.metadata.create_all(mem_engine)
        with Session(mem_engine) as session:
            orig_sheets = [
                {"id": "s1", "name": "View 1", "bbox": {"min_x": 0, "min_y": 0, "max_x": 100, "max_y": 80, "width": 100, "height": 80}}
            ]
            plan = Plan(
                name="RAW_FILE_REV02.DWG",
                discipline="architectural",
                sheets_json=json.dumps(orig_sheets),
                active_sheet_id="s1",
                active_sheet_name="View 1",
            )
            session.add(plan)
            session.commit()
            session.refresh(plan)

            req = CleanNamesRequest(
                apply=True,
                custom_title="Tower B First Floor Framing",
                custom_discipline="structural",
                custom_sheets=[{"id": "s1", "name": "First Floor Beam Schedule"}],
            )
            res = api_clean_names_and_sheets_for_plan(plan.id, req, session=session, user_id=None)
            self.assertTrue(res["applied"])
            updated = session.get(Plan, plan.id)
            self.assertEqual(updated.name, "Tower B First Floor Framing")
            self.assertEqual(updated.discipline, "structural")
            self.assertEqual(updated.active_sheet_name, "First Floor Beam Schedule")
            saved_sheets = json.loads(updated.sheets_json)
            self.assertEqual(saved_sheets[0]["name"], "First Floor Beam Schedule")
            self.assertEqual(saved_sheets[0]["bbox"]["width"], 100)


if __name__ == "__main__":
    unittest.main()
