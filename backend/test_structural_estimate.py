import json
from sqlmodel import Session, select
from app.database import engine, init_db
from app.models.schema import Plan

def test_structural_estimate_field():
    init_db()
    with Session(engine) as session:
        test_plan = Plan(
            name="Structural Test Plan",
            discipline="structural",
            project_name="Test Tower",
            structural_estimate_json=json.dumps({"members": [{"name": "C1"}], "wastagePct": 3.0})
        )
        session.add(test_plan)
        session.commit()
        session.refresh(test_plan)
        assert test_plan.id is not None
        assert "C1" in test_plan.structural_estimate_json
        
        # Cleanup
        session.delete(test_plan)
        session.commit()
    print("test_structural_estimate_field passed!")

if __name__ == "__main__":
    test_structural_estimate_field()

