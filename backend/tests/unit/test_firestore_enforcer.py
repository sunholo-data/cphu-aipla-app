"""The per-teacher monthly cap (ACCESS-1 M3).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

The enforcer implements the EXISTING `BudgetEnforcer` Protocol, so the first
test here is that it actually satisfies it — if that ever stops being true the
ADK callback silently falls back to no-ops and the cap quietly disappears.
"""

from __future__ import annotations

from typing import ClassVar

import pytest

from budget.enforcer import BudgetConsultation, BudgetEnforcer
from budget.firestore_enforcer import (
    PROGRAMME_METER_KEY,
    SHARD_COUNT,
    FirestoreBudgetEnforcer,
    _period_key,
)


@pytest.fixture
def store(monkeypatch):
    """A dict standing in for Firestore, injected where the enforcer reads."""
    data: dict[str, dict] = {}

    def _get(collection, doc_id):
        return data.get(f"{collection}/{doc_id}")

    def _set(collection, doc_id, payload, merge=False):
        key = f"{collection}/{doc_id}"
        data[key] = {**data.get(key, {}), **payload} if merge else dict(payload)

    def _increment(collection, doc_id, field, amount=1):
        key = f"{collection}/{doc_id}"
        if key not in data:
            raise KeyError("no such document")
        data[key][field] = data[key].get(field, 0) + amount

    def _query(collection, filters=None, order_by=None, order_direction="DESCENDING", limit=None):
        rows = [{**v, "__id": k.split("/", 1)[1]} for k, v in data.items() if k.startswith(f"{collection}/")]
        for field, _op, value in filters or []:
            rows = [r for r in rows if r.get(field) == value]
        return rows[:limit] if limit else rows

    import db.firestore as fs
    import db.teacher_access as ta

    monkeypatch.setattr(fs, "get_document", _get)
    monkeypatch.setattr(fs, "set_document", _set)
    monkeypatch.setattr(fs, "increment_field", _increment)
    monkeypatch.setattr(fs, "query_documents", _query)
    # The register module binds its Firestore helpers at import time, so
    # patching `db.firestore` alone leaves the real client behind
    # `grant_for_uid` — the very function the cap lookup now depends on.
    monkeypatch.setattr(ta, "get_document", _get)
    monkeypatch.setattr(ta, "set_document", _set)
    monkeypatch.setattr(ta, "query_documents", _query)
    return data


def _register(store, *, uid: str, cap: float) -> None:
    store["teacher_access/t@ku.dk"] = {
        "email": "t@ku.dk",
        "tier": "pilot",
        "uid": uid,
        "monthlyCapUsd": cap,
        "revoked": False,
    }


def _consult(identity="teacher:t1", cost=1.0, invocation="inv-1") -> BudgetConsultation:
    return BudgetConsultation(
        identity_value=identity,
        skill_id="concept-dialogue",
        model_id="gemini-3.5-flash-lite",
        projected_cost_usd=cost,
        invocation_id=invocation,
    )


# --- The Protocol contract ---------------------------------------------------


def test_it_actually_satisfies_the_protocol():
    """`register_budget_enforcer` does an isinstance check against the
    runtime-checkable Protocol. If this drifts, registration raises TypeError at
    startup and the cap silently never applies."""
    assert isinstance(FirestoreBudgetEnforcer(), BudgetEnforcer)


def test_registration_works():
    from budget.enforcer import clear_registered_enforcer, get_registered_enforcer
    from budget.firestore_enforcer import register_default_enforcer

    try:
        register_default_enforcer()
        assert isinstance(get_registered_enforcer(), FirestoreBudgetEnforcer)
    finally:
        clear_registered_enforcer()


# --- allow / warn / block ----------------------------------------------------


@pytest.mark.asyncio
async def test_allows_well_under_the_cap(store):
    _register(store, uid="t1", cap=25.0)
    decision = await FirestoreBudgetEnforcer().consult(_consult(cost=0.01))
    assert decision.action == "allow"
    assert decision.remaining_usd == pytest.approx(25.0)


@pytest.mark.asyncio
async def test_warns_past_the_soft_threshold(store):
    _register(store, uid="t1", cap=10.0)
    enforcer = FirestoreBudgetEnforcer()
    store["teacher_spend/teacher:t1|" + _period_key() + "|0"] = {
        "identity": "teacher:t1",
        "period": _period_key(),
        "shard": 0,
        "spentMicroUsd": 8_500_000,  # $8.50 of a $10 cap
    }
    decision = await enforcer.consult(_consult(cost=0.01))
    assert decision.action == "warn"
    assert decision.message and "%" in decision.message


@pytest.mark.asyncio
async def test_blocks_at_the_cap(store):
    _register(store, uid="t1", cap=10.0)
    store["teacher_spend/teacher:t1|" + _period_key() + "|0"] = {
        "identity": "teacher:t1",
        "period": _period_key(),
        "shard": 0,
        "spentMicroUsd": 10_000_000,
    }
    decision = await FirestoreBudgetEnforcer().consult(_consult(cost=0.01))
    assert decision.action == "block"
    assert decision.remaining_usd == 0.0
    # The message is read by a teacher or a student mid-lesson, so it must say
    # what happened and what to do — not "budget exceeded".
    assert "monthly" in (decision.message or "").lower()


@pytest.mark.asyncio
async def test_an_uncapped_identity_is_allowed_but_logged(store, caplog):
    """A pilot teacher with no cap is a deliberate state. Allowed — but never
    silently, and only via the explicit sentinel (0 now BLOCKS; see below)."""
    from db.teacher_access import UNCAPPED

    _register(store, uid="t1", cap=UNCAPPED)
    with caplog.at_level("INFO", logger="budget.firestore"):
        decision = await FirestoreBudgetEnforcer().consult(_consult())
    assert decision.action == "allow"
    assert decision.remaining_usd is None
    assert any("no_cap" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_an_identity_absent_from_the_register_is_uncapped(store):
    decision = await FirestoreBudgetEnforcer().consult(_consult(identity="teacher:nobody"))
    assert decision.action == "allow"


@pytest.mark.asyncio
async def test_a_non_teacher_identity_shape_is_uncapped(store):
    """Only `teacher:{uid}` resolves to a cap. Anything else is not a paying
    party this enforcer knows how to meter."""
    decision = await FirestoreBudgetEnforcer().consult(_consult(identity="group:PHYS-7K2N"))
    assert decision.action == "allow"


# --- Recording ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_record_accumulates_across_shards(store):
    _register(store, uid="t1", cap=10.0)
    enforcer = FirestoreBudgetEnforcer()

    for i in range(20):
        await enforcer.record(_consult(cost=0.1, invocation=f"inv-{i}"), actual_cost_usd=0.1)

    period = _period_key()
    # Exclude the programme-wide daily bucket (M3) — every turn is metered
    # there as well, on a DAILY key. This assertion is about the per-teacher
    # monthly total.
    rows = [v for k, v in store.items() if k.startswith("teacher_spend/") and v.get("identity") != PROGRAMME_METER_KEY]
    assert rows, "record must write something"
    total = sum(r.get("spentMicroUsd", 0) for r in rows) / 1_000_000
    assert total == pytest.approx(2.0), "twenty $0.10 turns is $2.00, however it was sharded"
    assert all(r["period"] == period for r in rows)
    assert len({r["shard"] for r in rows}) <= SHARD_COUNT


@pytest.mark.asyncio
async def test_recorded_spend_is_visible_to_the_next_consult(store):
    """The cache must not hide a write from the very next decision."""
    _register(store, uid="t1", cap=1.0)
    enforcer = FirestoreBudgetEnforcer()

    assert (await enforcer.consult(_consult(cost=0.01))).action == "allow"
    await enforcer.record(_consult(cost=0.99), actual_cost_usd=0.99)
    assert (await enforcer.consult(_consult(cost=0.01, invocation="inv-2"))).action == "block"


@pytest.mark.asyncio
async def test_a_zero_cost_record_writes_nothing(store):
    enforcer = FirestoreBudgetEnforcer()
    await enforcer.record(_consult(), actual_cost_usd=0.0)
    assert not [k for k in store if k.startswith("teacher_spend/")]


@pytest.mark.asyncio
async def test_a_record_failure_never_raises(monkeypatch, store):
    """Losing a metering write is a gap; failing a turn the model already
    answered is a regression. Ring 0's quota is still underneath."""

    def boom(*_a, **_k):
        raise RuntimeError("firestore down")

    import db.firestore as fs

    monkeypatch.setattr(fs, "increment_field", boom)
    monkeypatch.setattr(fs, "set_document", boom)

    await FirestoreBudgetEnforcer().record(_consult(), actual_cost_usd=1.0)  # must not raise


@pytest.mark.asyncio
async def test_a_read_failure_does_not_block_the_turn(monkeypatch, store):
    _register(store, uid="t1", cap=10.0)

    def boom(*_a, **_k):
        raise RuntimeError("firestore down")

    import db.firestore as fs

    real_query = fs.query_documents

    def selective(collection, *a, **k):
        if collection == "teacher_spend":
            return boom()
        return real_query(collection, *a, **k)

    monkeypatch.setattr(fs, "query_documents", selective)
    decision = await FirestoreBudgetEnforcer().consult(_consult(cost=0.01))
    assert decision.action == "allow"


# --- Fail-closed inversions --------------------------------------------------


def test_estimate_cost_strict_refuses_an_unpriced_model():
    """An unpriced model would be BOTH uncharged and ungated. On the money path
    that must raise, not return zero."""
    from observability.llm_metrics import UnpricedModelError, estimate_cost

    with pytest.raises(UnpricedModelError):
        estimate_cost("some-model-nobody-priced", 100, 100, strict=True)

    # Non-strict keeps the original behaviour for every metrics caller.
    assert estimate_cost("some-model-nobody-priced", 100, 100) == 0.0


def test_every_registry_model_is_priced():
    """The startup assertion, as a test. A model in config/models.yaml with no
    rate-card row is ungated — this catches it in CI rather than at bill time."""
    from config.models import model_api_names
    from observability.llm_metrics import is_priced

    unpriced = sorted(n for n in model_api_names() if not is_priced(n))
    assert not unpriced, f"models in the registry with no pricing entry: {unpriced}"


@pytest.mark.asyncio
async def test_unresolved_identity_blocks_rather_than_no_ops():
    """The template failed OPEN here, reasoning that a misconfigured fork should
    not deny everyone. Correct for a trusted tenant, wrong on a public domain:
    'we cannot tell who is paying' must mean 'do not spend'."""
    from adk.budget_config import BudgetConfig
    from auth.firebase_auth import User
    from budget.callback import make_budget_callbacks
    from budget.enforcer import BudgetExceededError

    class _Enforcer:
        async def consult(self, request):  # pragma: no cover - never reached
            raise AssertionError("should not be consulted with an unresolved identity")

        async def record(self, request, actual_cost_usd):  # pragma: no cover
            pass

    before, _after = make_budget_callbacks(
        _Enforcer(),
        user=User(uid="u1", email=""),  # identity_key resolves to empty
        skill_id="s1",
        budget_config=BudgetConfig(identity_key="group_id"),
    )

    class _Ctx:
        invocation_id = "inv-1"
        state: ClassVar[dict] = {}

    with pytest.raises(BudgetExceededError):
        await before(_Ctx(), object())


# --- The billing key: a student's turn lands on their teacher's cap ----------


def test_billing_key_shapes():
    """Pure and I/O-free — it is read before every model call. And never empty
    for a real caller, because the callback now fails CLOSED on an empty
    identity: a key that returned "" for teachers would block every teacher."""
    from auth.firebase_auth import User

    assert User(uid="anon:x", group_id="PHYS-7K2N").billing_key == "PHYS-7K2N"
    assert User(uid="t1", email="a@ku.dk", is_teacher=True).billing_key == "teacher:t1"
    assert User(uid="").billing_key == ""


@pytest.mark.asyncio
async def test_a_students_group_code_resolves_to_their_teachers_cap(store):
    """The whole point of the indirection, at the metering layer this time:
    thirty students on one join code share ONE cap, their teacher's."""
    _register(store, uid="t1", cap=10.0)
    store["anon_groups/PHYS-7K2N"] = {"classId": "c1"}
    store["classes/c1"] = {"ownerUid": "t1"}

    enforcer = FirestoreBudgetEnforcer()
    # Metered under the group code, as the ADK callback would pass it...
    decision = await enforcer.consult(_consult(identity="PHYS-7K2N", cost=0.01))
    assert decision.action == "allow"
    assert decision.remaining_usd == pytest.approx(10.0), "the teacher's cap, not a per-student one"

    # ...and spending under the group code counts against the same cap.
    await enforcer.record(_consult(identity="PHYS-7K2N"), actual_cost_usd=9.99)
    after = await enforcer.consult(_consult(identity="PHYS-7K2N", cost=0.01, invocation="inv-2"))
    assert after.action == "block"


@pytest.mark.asyncio
async def test_an_orphan_group_code_is_uncapped_not_crashing(store):
    """A code with no class. Admission already decided whether the turn may
    happen (auth/spend_authority.py); this layer only meters, so it declines to
    guess a payer rather than refusing."""
    decision = await FirestoreBudgetEnforcer().consult(_consult(identity="ORPHAN-CODE"))
    assert decision.action == "allow"


def _template_budget_configs():
    """Every SKILL.md template -> its parsed BudgetConfig (or None)."""
    from pathlib import Path

    import yaml

    from adk.budget_config import BudgetConfig

    root = Path(__file__).resolve().parents[2] / "skills" / "templates"
    out = {}
    for path in sorted(root.glob("*/SKILL.md")):
        data = yaml.safe_load(path.read_text().split("---")[1])
        tool_configs = (data.get("metadata") or {}).get("toolConfigs") or data.get("toolConfigs")
        out[path.parent.name] = BudgetConfig.from_tool_configs(tool_configs)
    return out


def test_no_skill_is_exempt_BY_ACCIDENT():
    """The guard that stops this recurring.

    A skill with no `budget:` block is exempt by ABSENCE — silently, and
    indistinguishably from someone forgetting. That is exactly what happened:
    the four student tutors were gated and the four teacher skills were not, so
    a real co-pilot turn on 2026-08-12 spent money that no cap saw and no log
    recorded.

    Every template must now DECLARE its position. Opting out is fine; opting out
    by omission is not.
    """
    missing = [name for name, config in _template_budget_configs().items() if config is None]
    assert not missing, (
        f"{missing} have no `budget:` block, so they are exempt by absence. "
        "Add `budget: {identity_key: billing_key}` to meter it, or "
        "`{identity_key: billing_key, exempt: true}` with a comment saying why not."
    )


def test_every_gated_skill_meters_on_billing_key():
    """`group_id` is empty for a teacher and the callback fails closed, so a
    skill metered on it would block every teacher who opened it."""
    for name, config in _template_budget_configs().items():
        assert config is not None
        assert config.identity_key == "billing_key", f"{name} must meter on billing_key, not {config.identity_key!r}"


def test_the_student_tutors_are_gated_not_exempt():
    """These are the paths a whole class runs through — the fan-out the cap
    exists for. An exemption here would be a hole, not a decision."""
    configs = _template_budget_configs()
    for name in ["problem-set-hints", "concept-dialogue", "kinebot-kinematics-tutor", "led-planck-tutor"]:
        assert configs[name] is not None and configs[name].exempt is False, f"{name} must be gated"


def test_the_teacher_skills_are_gated_too():
    """Added after a live turn proved the gap: the co-pilot is the most
    tool-heavy skill in the product, and manage-class delegates into
    analytics-chat, so one teacher turn can fan out into a second agent's
    model calls."""
    configs = _template_budget_configs()
    for name in ["manage-class", "activity-authoring-assistant", "analytics-chat"]:
        assert configs[name] is not None and configs[name].exempt is False, f"{name} must be gated"


def test_only_the_help_skill_is_deliberately_exempt():
    """aipla-help is the escape hatch — what a teacher asks when something is
    wrong, including "why can't I use the tutor?". Refusing help to someone who
    just hit their cap is the moment they most need it. Any OTHER exemption
    should be argued for here first."""
    exempt = {name for name, c in _template_budget_configs().items() if c and c.exempt}
    assert exempt == {"aipla-help"}, f"unexpected exemptions: {exempt - {'aipla-help'}}"


# --- 0 blocks; only the explicit sentinel passes ----------------------------


@pytest.mark.asyncio
async def test_a_zero_cap_BLOCKS_rather_than_passing(store):
    """The inversion that matters. `cap = 0` used to mean "no limit" — so a
    dropped field or a failed parse silently disabled the gate. It now means
    zero budget, which is also a useful state: suspend a teacher's spend
    without revoking their grant, their classes or their join codes."""
    _register(store, uid="t1", cap=0.0)
    decision = await FirestoreBudgetEnforcer().consult(_consult(cost=0.001))
    assert decision.action == "block"
    assert decision.remaining_usd == 0.0
    # The student reading this is mid-lesson; it must say what happened.
    assert "paused" in (decision.message or "").lower()


@pytest.mark.asyncio
async def test_only_the_explicit_sentinel_is_uncapped(store):
    from db.teacher_access import UNCAPPED

    _register(store, uid="t1", cap=UNCAPPED)
    decision = await FirestoreBudgetEnforcer().consult(_consult(cost=999_999.0))
    assert decision.action == "allow"
    assert decision.remaining_usd is None


@pytest.mark.asyncio
async def test_a_row_missing_its_cap_field_is_capped_at_the_default(store):
    """Defence in depth against the same trapdoor, one layer down: a row with no
    monthlyCapUsd must not read as unlimited at the enforcer either."""
    from db.teacher_access import DEFAULT_MONTHLY_CAP_USD

    store["teacher_access/t@ku.dk"] = {"email": "t@ku.dk", "tier": "pilot", "uid": "t1", "revoked": False}
    decision = await FirestoreBudgetEnforcer().consult(_consult(cost=DEFAULT_MONTHLY_CAP_USD + 1))
    assert decision.action == "block"


# --- Metering lands on the PAYER, not the caller (2026-08-18) ----------------


@pytest.mark.asyncio
async def test_two_classes_of_one_teacher_share_a_single_budget(store):
    """The bug this file shipped: the cap was resolved through the owning
    teacher, but the running total was read and written under the raw
    `identity_value` — a GROUP CODE for a student. So each class got its own
    private copy of the teacher's whole monthly cap, and the real ceiling was
    (number of classes + 1) times what anyone configured.

    Only a SECOND group code can see it; the existing single-code test cannot.
    """
    _register(store, uid="t1", cap=10.0)
    store["anon_groups/CLASS-A"] = {"classId": "c1"}
    store["anon_groups/CLASS-B"] = {"classId": "c2"}
    store["classes/c1"] = {"ownerUid": "t1"}
    store["classes/c2"] = {"ownerUid": "t1"}

    enforcer = FirestoreBudgetEnforcer()

    # Class A burns almost the whole cap.
    await enforcer.record(_consult(identity="CLASS-A"), actual_cost_usd=9.99)

    # Class B must inherit that spend — same teacher, same budget.
    decision = await enforcer.consult(_consult(identity="CLASS-B", cost=0.01, invocation="inv-2"))
    assert decision.action == "block", "a second class must not get a fresh copy of the cap"


@pytest.mark.asyncio
async def test_a_teachers_own_turns_share_the_budget_with_their_students(store):
    """The co-pilot and the classroom are one bill. `billing_identity` promises
    exactly this, and metering under the group code broke it."""
    _register(store, uid="t1", cap=10.0)
    store["anon_groups/CLASS-A"] = {"classId": "c1"}
    store["classes/c1"] = {"ownerUid": "t1"}

    enforcer = FirestoreBudgetEnforcer()
    await enforcer.record(_consult(identity="CLASS-A"), actual_cost_usd=9.99)

    decision = await enforcer.consult(_consult(identity="teacher:t1", cost=0.01, invocation="inv-2"))
    assert decision.action == "block"


@pytest.mark.asyncio
async def test_spend_is_recorded_under_the_paying_teacher(store):
    """The shard key is the payer, per the design's `teacher_spend/{uid}/...`."""
    _register(store, uid="t1", cap=10.0)
    store["anon_groups/CLASS-A"] = {"classId": "c1"}
    store["classes/c1"] = {"ownerUid": "t1"}

    await FirestoreBudgetEnforcer().record(_consult(identity="CLASS-A"), actual_cost_usd=1.0)

    # The programme-wide daily bucket (M3) is written alongside and is not
    # keyed by payer — it is one fixed key for the whole programme.
    written = [
        k for k, v in store.items() if k.startswith("teacher_spend/") and v.get("identity") != PROGRAMME_METER_KEY
    ]
    assert written, "nothing was recorded"
    assert all(k.startswith("teacher_spend/teacher:t1|") for k in written), written


@pytest.mark.asyncio
async def test_an_unstamped_register_row_still_yields_its_cap(store, monkeypatch):
    """The outage of 2026-08-18: 17 of 18 prod rows had a null `uid`, the cap
    lookup joined on that field, and every teacher silently became uncapped.
    The email fallback in `grant_for_uid` has to carry it."""
    import db.teacher_access as ta

    store["teacher_access/t@ku.dk"] = {
        "email": "t@ku.dk",
        "tier": "pilot",
        "uid": None,  # never stamped
        "monthlyCapUsd": 10.0,
        "revoked": False,
    }
    monkeypatch.setattr(ta, "_email_for_uid", lambda uid: "t@ku.dk" if uid == "t1" else None)

    enforcer = FirestoreBudgetEnforcer()
    store["teacher_spend/teacher:t1|" + _period_key() + "|0"] = {
        "identity": "teacher:t1",
        "period": _period_key(),
        "shard": 0,
        "spentMicroUsd": 9_900_000,
    }
    decision = await enforcer.consult(_consult(identity="teacher:t1", cost=0.5))
    assert decision.action == "block", "a null uid must not read as 'no cap'"

    # ...and it self-heals, so the fallback is paid once, not once per turn.
    assert store["teacher_access/t@ku.dk"]["uid"] == "t1"


# --- The programme-wide daily budget (PROGADMIN-1 M3 — 1.1.76) ---------------
#
# A second knob one layer down from the immutable GCP quota. It answers "what
# did the WHOLE programme spend today?", which no per-teacher monthly cap can.


def _set_budget(store, *, daily: float, action: str = "warn") -> None:
    store["programme_budget/current"] = {"dailyBudgetUsd": daily, "action": action}


@pytest.mark.asyncio
async def test_no_programme_budget_changes_nothing(store):
    """Unset is the default and must be indistinguishable from before M3."""
    _register(store, uid="t1", cap=25.0)
    decision = await FirestoreBudgetEnforcer().consult(_consult(cost=0.01))
    assert decision.action == "allow"


@pytest.mark.asyncio
async def test_record_meters_into_the_programme_daily_bucket(store):
    """The per-teacher counters are MONTHLY, so no sum of them can answer
    'today'. The daily bucket is the only thing that can."""
    from budget.firestore_enforcer import PROGRAMME_METER_KEY, _day_key, read_identity_total_usd

    _register(store, uid="t1", cap=25.0)
    enforcer = FirestoreBudgetEnforcer()
    await enforcer.consult(_consult(cost=1.0))
    await enforcer.record(_consult(cost=1.0), 2.5)

    assert read_identity_total_usd(PROGRAMME_METER_KEY, _day_key()) == pytest.approx(2.5)


@pytest.mark.asyncio
async def test_warns_when_the_programme_is_over_budget(store):
    _register(store, uid="t1", cap=25.0)
    _set_budget(store, daily=1.0, action="warn")
    enforcer = FirestoreBudgetEnforcer()
    await enforcer.record(_consult(cost=1.0), 2.0)  # today's programme spend = $2

    decision = await enforcer.consult(_consult(cost=0.01))
    assert decision.action == "warn"
    assert "programme" in (decision.message or "").lower()


@pytest.mark.asyncio
async def test_warn_only_never_blocks(store):
    """warn-only is the first month's setting: it tells you where the real
    numbers are without risking a class mid-lesson."""
    _register(store, uid="t1", cap=25.0)
    _set_budget(store, daily=0.5, action="warn")
    enforcer = FirestoreBudgetEnforcer()
    await enforcer.record(_consult(cost=1.0), 100.0)

    assert (await enforcer.consult(_consult(cost=0.01))).action == "warn"


@pytest.mark.asyncio
async def test_blocks_only_when_action_is_block(store):
    _register(store, uid="t1", cap=25.0)
    _set_budget(store, daily=1.0, action="block")
    enforcer = FirestoreBudgetEnforcer()
    await enforcer.record(_consult(cost=1.0), 2.0)

    decision = await enforcer.consult(_consult(cost=0.01))
    assert decision.action == "block"


@pytest.mark.asyncio
async def test_under_the_programme_budget_falls_through_to_the_per_teacher_cap(store):
    """The programme check must not shadow the gate that has always been
    there."""
    _register(store, uid="t1", cap=25.0)
    _set_budget(store, daily=1000.0, action="block")
    enforcer = FirestoreBudgetEnforcer()
    await enforcer.record(_consult(cost=1.0), 30.0)  # over the TEACHER cap, under the programme's

    decision = await enforcer.consult(_consult(cost=0.01))
    assert decision.action == "block"
    assert "class" in (decision.message or "").lower(), "should be the per-teacher message, not the programme one"


@pytest.mark.asyncio
async def test_an_unreadable_programme_budget_does_not_block(store, monkeypatch):
    """The opposite failure direction from the per-teacher gate, and the
    difference is blast radius: one Firestore blip must not take every class
    down at once. Ring 0 and the per-teacher caps are still underneath."""
    import db.programme_budget as pb

    def _boom():
        raise RuntimeError("firestore is having a moment")

    monkeypatch.setattr(pb, "get_programme_budget", _boom)
    _register(store, uid="t1", cap=25.0)

    decision = await FirestoreBudgetEnforcer().consult(_consult(cost=0.01))
    assert decision.action == "allow"
