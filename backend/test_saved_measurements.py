from sqlmodel import Session
from app.database import engine, init_db
from app.models.schema import Plan
from app.routers.plans import (
    UpdatePlanRequest,
    get_plan,
    update_plan_view_or_units,
)


def test_saved_measurements():
    init_db()
    test_uid = "test-measure-user"
    with Session(engine) as session:
        test_plan = Plan(user_id=test_uid, name="Measurement Test Plan", project_name="Test Project")
        session.add(test_plan)
        session.commit()
        session.refresh(test_plan)
        plan_id = test_plan.id

        try:
            # Check initial serialization
            payload = get_plan(plan_id, session=session, user_id=test_uid)
            assert "measurements" in payload["plan"]
            assert payload["plan"]["measurements"] == []

            # Save sample measurements (distance + area)
            sample_measurements = [
                {
                    "id": "m_1",
                    "name": "Master Bed Span",
                    "type": "distance",
                    "subMode": "distance",
                    "points": [[0, 0], [4.5, 0]],
                    "rawUnits": 4.5,
                    "formattedPrimary": "4.500 m",
                    "formattedSecondary": "14' 9.2\" | 4,500 mm",
                    "metadata": {"deltaX": 4.5, "deltaY": 0.0},
                    "createdAt": "2026-11-08T08:00:00Z",
                },
                {
                    "id": "m_2",
                    "name": "Living Room Area",
                    "type": "area",
                    "subMode": "area-pick",
                    "points": [[0, 0], [6.0, 0], [6.0, 4.0], [0, 4.0]],
                    "rawUnits": 24.0,
                    "formattedPrimary": "24.00 m²",
                    "formattedSecondary": "258.33 sq.ft",
                    "metadata": {"perimeter": "20.000 m"},
                    "createdAt": "2026-11-08T08:05:00Z",
                },
            ]

            update_res = update_plan_view_or_units(
                plan_id,
                UpdatePlanRequest(measurements=sample_measurements),
                session=session,
                user_id=test_uid,
            )
            assert "measurements" in update_res["plan"]
            assert len(update_res["plan"]["measurements"]) == 2
            assert update_res["plan"]["measurements"][0]["name"] == "Master Bed Span"
            assert update_res["plan"]["measurements"][1]["name"] == "Living Room Area"

            # Retrieve afresh via get_plan
            reloaded = get_plan(plan_id, session=session, user_id=test_uid)
            assert len(reloaded["plan"]["measurements"]) == 2
            assert reloaded["plan"]["measurements"][0]["id"] == "m_1"
            assert reloaded["plan"]["measurements"][1]["formattedPrimary"] == "24.00 m²"

            # Test updating measurement list (rename / delete)
            sample_measurements[0]["name"] = "Master Bedroom Width"
            del sample_measurements[1]
            update_res2 = update_plan_view_or_units(
                plan_id,
                UpdatePlanRequest(measurements=sample_measurements),
                session=session,
                user_id=test_uid,
            )
            assert len(update_res2["plan"]["measurements"]) == 1
            assert update_res2["plan"]["measurements"][0]["name"] == "Master Bedroom Width"

            print("All saved measurements backend checks passed!")
        finally:
            session.delete(test_plan)
            session.commit()


if __name__ == "__main__":
    test_saved_measurements()

