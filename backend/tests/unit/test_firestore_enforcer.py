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
from budget.firestore_enforcer import SHARD_COUNT, FirestoreBudgetEnforcer, _period_key


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

    monkeypatch.setattr(fs, "get_document", _get)
    monkeypatch.setattr(fs, "set_document", _set)
    monkeypatch.setattr(fs, "increment_field", _increment)
    monkeypatch.setattr(fs, "query_documents", _query)
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
    """A pilot teacher with no cap is a deliberate state (a handful are watched
    directly). Allowed — but never silently."""
    _register(store, uid="t1", cap=0.0)
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
    rows = [v for k, v in store.items() if k.startswith("teacher_spend/")]
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


def test_the_student_skill_templates_actually_opt_in():
    """A skill with no `budget:` block is exempt BY ABSENCE — so the cap
    silently would not apply. These four are the paths a whole class runs
    through; if one loses its block, the cap stops covering that tutor."""
    from pathlib import Path

    import yaml

    from adk.budget_config import BudgetConfig

    for name in ["problem-set-hints", "concept-dialogue", "kinebot-kinematics-tutor", "led-planck-tutor"]:
        path = Path(__file__).resolve().parents[2] / "skills" / "templates" / name / "SKILL.md"
        data = yaml.safe_load(path.read_text().split("---")[1])
        tool_configs = (data.get("metadata") or {}).get("toolConfigs") or data.get("toolConfigs")
        config = BudgetConfig.from_tool_configs(tool_configs)
        assert config is not None, f"{name} lost its budget block — the cap no longer covers it"
        assert config.identity_key == "billing_key", (
            f"{name} must meter on billing_key: `group_id` is empty for a teacher and the "
            "callback fails closed, so it would block every teacher who opened this tutor"
        )
        assert config.exempt is False
