"""1.1.124 M0 — the stage function is the ONE definition of "stuck". Each
stage has a test; the order of precedence (most advanced thing wins) has one."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from db.models.class_ import Class
from onboarding.demo_seed import DEMO_CLASS_NAME
from onboarding.stage import NEXT_STEP, STAGES, compute_stage, is_demo_class

UID = "teacher-1"
GRANTED = (datetime.now(UTC) - timedelta(days=12)).isoformat()


def _cls(
    class_id: str, *, name: str = "Physics", demo: bool = False, codes=(), activities=(), days_ago: int = 3
) -> Class:
    created = datetime.now(UTC) - timedelta(days=days_ago)
    return Class(
        classId=class_id,
        ownerUid=UID,
        name=name,
        tagNamespace=f"class:{UID}:{class_id}",
        groupCodes=list(codes),
        activityIds=list(activities),
        demo=demo,
        createdAt=created,
        updatedAt=created,
    )


def test_invited_when_never_signed_in():
    st = compute_stage(uid=None, granted_at=GRANTED, classes=[], activity_by_class={})
    assert st.stage == "invited"
    assert st.days == 12
    assert st.next_step == NEXT_STEP["invited"]


def test_demo_only_by_marker_and_by_legacy_name():
    by_marker = _cls("c1", name="Renamed", demo=True, codes=["x"], activities=["a"])
    by_name = _cls("c2", name=DEMO_CLASS_NAME, codes=["x"], activities=["a"])
    assert is_demo_class(by_marker) and is_demo_class(by_name)
    st = compute_stage(uid=UID, granted_at=GRANTED, classes=[by_marker, by_name], activity_by_class={})
    assert st.stage == "demo_only"
    assert st.days == 12  # dated from the grant, not the seed
    assert st.next_step == "Create the class"


def test_renamed_demo_without_marker_counts_as_the_teachers_own():
    st = compute_stage(uid=UID, granted_at=GRANTED, classes=[_cls("c1", name="My class")], activity_by_class={})
    assert st.stage == "no_code"


def test_no_code_then_no_activity_then_waiting():
    assert compute_stage(uid=UID, granted_at=GRANTED, classes=[_cls("c1")], activity_by_class={}).stage == "no_code"
    assert (
        compute_stage(uid=UID, granted_at=GRANTED, classes=[_cls("c1", codes=["k"])], activity_by_class={}).stage
        == "no_activity"
    )
    st = compute_stage(
        uid=UID,
        granted_at=GRANTED,
        classes=[_cls("c1", codes=["k"], activities=["a"], days_ago=5)],
        activity_by_class={},
    )
    assert st.stage == "waiting"
    assert st.days == 5
    assert st.next_step == "Share the join link with students"


def test_live_needs_a_turn_and_dates_from_the_last_message():
    last = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    ready = _cls("c1", codes=["k"], activities=["a"])
    st = compute_stage(
        uid=UID,
        granted_at=GRANTED,
        classes=[ready],
        activity_by_class={"c1": {"turns": 4, "lastMessageAt": last}},
    )
    assert st.stage == "live"
    assert st.next_step is None
    assert st.days == 0
    # A session with no turns is not live.
    st = compute_stage(
        uid=UID, granted_at=GRANTED, classes=[ready], activity_by_class={"c1": {"turns": 0, "lastMessageAt": None}}
    )
    assert st.stage == "waiting"


def test_most_advanced_class_wins():
    """One live class and three empty ones is LIVE — the empties are not a problem to flag."""
    last = datetime.now(UTC).isoformat()
    classes = [_cls("empty1"), _cls("empty2"), _cls("live", codes=["k"], activities=["a"]), _cls("demo", demo=True)]
    st = compute_stage(
        uid=UID, granted_at=GRANTED, classes=classes, activity_by_class={"live": {"turns": 1, "lastMessageAt": last}}
    )
    assert st.stage == "live"


def test_stage_order_is_the_funnel():
    assert STAGES == ("invited", "demo_only", "no_code", "no_activity", "waiting", "live")
    assert all(NEXT_STEP[s] for s in STAGES[:-1]) and NEXT_STEP["live"] is None


def test_to_dict_shape():
    d = compute_stage(uid=None, granted_at=None, classes=[], activity_by_class={}).to_dict()
    assert d == {"stage": "invited", "since": None, "days": None, "nextStep": NEXT_STEP["invited"]}
