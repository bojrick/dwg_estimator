import json
from sqlmodel import Session, select
from app.database import engine, init_db
from app.models.schema import Plan
from app.routers.plans import share_table_with_project, ShareTableRequest

def test_share_table():
    init_db()
    with Session(engine) as session:
        # Create two plans under project "Test Tower"
        p1 = Plan(
            name="tower_fl1.dxf",
            discipline="structural",
            status="ready",
            project_name="Test Tower",
            structural_estimate_json='{"scheduleTables": []}'
        )
        p2 = Plan(
            name="tower_fl2.dxf",
            discipline="structural",
            status="ready",
            project_name="Test Tower",
            structural_estimate_json='{"scheduleTables": []}'
        )
        session.add(p1)
        session.add(p2)
        session.commit()
        session.refresh(p1)
        session.refresh(p2)

        req = ShareTableRequest(table={
            "id": "table_beam_master",
            "title": "Master Beam Schedule",
            "headers": ["Mark", "Size", "Top Rebar", "Bottom Rebar"],
            "rows": [["B1", "230x450", "2-T16", "3-T20"]],
            "detectedType": "beam"
        })
        res = share_table_with_project(
            project_name="Test Tower",
            req=req,
            session=session,
            user_id=None
        )
        assert res["status"] == "ok"
        assert res["updated_plans"] >= 2
        assert res["table_id"] == "table_beam_master"

        # Verify both plans have the table
        check_p1 = session.get(Plan, p1.id)
        check_p2 = session.get(Plan, p2.id)
        t1 = json.loads(check_p1.structural_estimate_json)["scheduleTables"]
        t2 = json.loads(check_p2.structural_estimate_json)["scheduleTables"]
        assert len(t1) == 1
        assert t1[0]["id"] == "table_beam_master"
        assert len(t2) == 1
        assert t2[0]["id"] == "table_beam_master"

        # Cleanup
        session.delete(check_p1)
        session.delete(check_p2)
        session.commit()
    print("test_share_table passed!")

if __name__ == "__main__":
    test_share_table()


