# Sprint: QUICK-WINS-V11 — 1.1.1 tutor verbosity + 1.1.6 group-code TTL → school year

**Sprint ID:** `QUICK-WINS-V11`
**Design docs:** [tutor-verbosity-fix.md](tutor-verbosity-fix.md) (1.1.1) + [group-code-school-year-ttl.md](group-code-school-year-ttl.md) (1.1.6)
**Branch:** `feature/quick-wins-v11`
**Base commit:** dev HEAD as of 2026-06-03 (`64645b5` or later)
**PR target:** `dev`
**Estimate:** ~0.5d total (~2h each, parallelisable — independent tracks)
**Created:** 2026-06-03

## Sprint goal

Ship the two zero-human-gate items from the v1.1.0-feedback batch as a single bundled PR — both small, both prompt-or-config deltas with high pedagogical or operational value, neither blocked on JB/AR:

- **1.1.1 verbosity fix** — every artefact-coupled tutor (`problem-set-hints` / Boldkast, `led-planck-tutor`, `kinebot-kinematics-tutor`) gains a ≤3-sentence + ends-with-question constraint in its system-prompt preamble. AR sign-off comes at PR review (drafting can start immediately).
- **1.1.6 school-year TTL** — extend `DEFAULT_TTL_DAYS = 30` to `300` (named constant rename), wire the existing `ChatSessionIndex.archived_at` field into the expiry path, return 410 Gone on archived-session restore.

Two-track parallel; bundled because the PR risk profile is identical (small surface, single chokepoint per item, both behind well-tested code paths).

## Why bundled

- Both ≤2h; opening separate PRs adds CI + review overhead disproportionate to the change size
- Independent (verbosity is prompt-text; TTL is a constant + flag — zero file overlap)
- Both shipping pre-pilot reduces post-pilot iteration debt
- Single PR description references both design docs cleanly

## Scope locks

### In scope — 1.1.1 (verbosity)

- Add the constraint block (below) to the **system_prompt** / **opening guidance** section of three SKILL.md files: [problem-set-hints](../../../../backend/skills/templates/problem-set-hints/SKILL.md), [led-planck-tutor](../../../../backend/skills/templates/led-planck-tutor/SKILL.md), [kinebot-kinematics-tutor](../../../../backend/skills/templates/kinebot-kinematics-tutor/SKILL.md)
- One pytest case per skill: assert the constraint sentence is present in the compiled / resolved skill prompt (regression guard against a future template refactor silently dropping it)
- One end-to-end pytest case (or extend an existing one): feed a known sample input to the agent loop on one skill and assert the response is ≤3 sentences (LLM-dependent but reliable enough with a tight assertion seed)

**Constraint block to inject (final wording subject to AR sign-off at PR review):**

```markdown
## Response length

Maximum 3 sentences per response unless the student explicitly asks for a longer
explanation ("explain in detail", "give me the full derivation", "show me step
by step"). Every response must end with a question that invites the student to
act, predict, or describe. Do not produce multi-paragraph explanations
unprompted.
```

### In scope — 1.1.6 (TTL)

- Rename `DEFAULT_TTL_DAYS = 30` → `DEFAULT_GROUP_CODE_TTL_DAYS = 300` in [backend/auth/group_id_auth.py:53](../../../../backend/auth/group_id_auth.py#L53); update both call sites (lines 402, 455) + the comment block at line 470 referencing the 30-day intent
- Wire archive-on-expiry: when `_assert_active_group` raises `GroupExpired`, flip `ChatSessionIndex.archived = True` + `archived_at = now` on the associated chat-session doc (field already exists at [backend/db/models/chat_session.py:43](../../../../backend/db/models/chat_session.py#L43))
- Restore route ([backend/protocols/session_restore_routes.py](../../../../backend/protocols/session_restore_routes.py)) returns `410 Gone` (not 404) on archived sessions with body `{"detail": "session archived", "archived_at": "..."}`
- Backend tests: TTL constant value; archive-on-expiry flow; 410 on archived restore; pre-existing 30d-code backwards-compat (codes minted before this change keep their original expiry — derived from `expires_at` field, not from the constant, so no migration needed)
- CLI: confirm `aiplatform sessions resume <expired_code>` returns the 410 with a clear error message (likely already works — just verify and add a smoke assertion)

### Out of scope

- Frontend "Archived" filter on the class-detail page → defer to a small follow-up; not blocking for v1.1.6's primary value
- Retroactively bumping existing 30d codes to 300d (backwards-compat surprise > convenience; documented in PR)
- Per-class TTL override (per the design doc's "open questions")
- Few-shot examples in the verbosity preamble (escalation only if the prompt-side constraint demonstrably fails in pilot)
- AR's final Danish/English copy on the verbosity block (review-time iteration, not gating)
- A shared-preamble refactor across all skills (out of scope per the design doc's "Where it lives" §; the three skills get the same block inlined for v1.1)

## Workflow

Direct-to-dev per the AIPLA git workflow (matches v1.0 quick-wins-sprint.md and existing dev-branch convention from CLAUDE.md). Single branch `feature/quick-wins-v11`; FF-merge to `dev`. No test/prod promotion in this sprint.

## Milestones

### Track A — Verbosity (~2h, ~150 LOC including tests)

#### M1 — Add constraint block to three SKILL.md files (~0.5h)

**Files (edit):**
- [backend/skills/templates/problem-set-hints/SKILL.md](../../../../backend/skills/templates/problem-set-hints/SKILL.md) — append the `## Response length` block after the existing tutor-instructions section
- [backend/skills/templates/led-planck-tutor/SKILL.md](../../../../backend/skills/templates/led-planck-tutor/SKILL.md) — same, preserving the Danish-language tone of existing sections
- [backend/skills/templates/kinebot-kinematics-tutor/SKILL.md](../../../../backend/skills/templates/kinebot-kinematics-tutor/SKILL.md) — same, English context

**Acceptance:**
- [ ] All three files contain a `## Response length` section with the exact constraint sentences
- [ ] Block placement is consistent (immediately after the activity-specific tutor instructions, before any `## Opening` / `## Idle nudge` / `## Reactive turn` sections so the rule applies to all turn types)
- [ ] No emoji introduced (per `feedback_no_emoticons`)
- [ ] No other text in the SKILL.md files changed

#### M2 — Test: constraint string present in resolved prompts (~0.5h)

**Files (new or extend):**
- `backend/tests/skills/test_skill_prompts.py` (new file if none exists for skill-prompt regression) OR extend existing skill-processor tests
  - Parametrised over the three skill ids; load each via the existing skill loader (likely `SkillProcessor.load(skill_id)` or equivalent — check `backend/skills/skill_processor.py`); assert `"Maximum 3 sentences"` and `"end with a question"` substrings appear in the resolved system prompt

**Acceptance:**
- [ ] Three pytest cases, one per skill, all green
- [ ] A negative case: confirm a skill without the block (e.g. `manage-class` or `analytics-chat`) does NOT carry the substring — guards against accidental leakage
- [ ] Test runs in <1s (no LLM calls)

#### M3 — End-to-end smoke (~0.5h)

**Files (new):**
- `backend/tests/eval/test_verbosity_smoke.py` — one test that runs an agent turn against `led-planck-tutor` with a simple input (e.g. `"hej"`), captures the response, asserts `count("?") >= 1` and `count(".") <= 4` (≤3 sentences + ending question). LLM-dependent but bounded; mark `@pytest.mark.slow` so it skips on `make test-fast` but runs on `make test`

**Acceptance:**
- [ ] Test runs against the configured Gemini model in test environment (uses existing test fixtures from the analytics-chat sprint's pattern)
- [ ] Passes deterministically when run 3× in a row (LLM variance acceptable within the assertion)
- [ ] Documented in the test docstring why it's marked `slow`

#### M4 — Manual sanity (~0.25h)

- [ ] LOCAL_MODE chat against `led-planck-tutor`: first 5 turns each ≤3 sentences ending in `?`
- [ ] Counter-test: type *"forklar i detaljer hvorfor det virker"* (`explain in detail why it works`) → next turn is allowed to be longer (constraint correctly defers to explicit student ask)
- [ ] LOCAL_MODE chat against `kinebot-kinematics-tutor` in English: same property holds

### Track B — TTL extension (~2h, ~120 LOC including tests)

#### M5 — Rename constant + extend value (~0.25h)

**Files (edit):**
- [backend/auth/group_id_auth.py:53](../../../../backend/auth/group_id_auth.py#L53) — `DEFAULT_TTL_DAYS = 30` → `DEFAULT_GROUP_CODE_TTL_DAYS = 300`
- [backend/auth/group_id_auth.py:402, :455](../../../../backend/auth/group_id_auth.py) — update both `ttl_days: int = DEFAULT_TTL_DAYS` references to the new name
- [backend/auth/group_id_auth.py:470](../../../../backend/auth/group_id_auth.py#L470) — update the docstring comment referencing the 30-day intent (now: "guarantee these N codes are alive for the next school year (~300 days)")

**Acceptance:**
- [ ] `grep -n "DEFAULT_TTL_DAYS" backend/` returns zero hits (constant fully renamed)
- [ ] Newly minted codes have `expires_at = now + 300 * 86400`
- [ ] Existing JWTs unaffected (TTL is set at mint-time; the constant does not retroactively extend)

#### M6 — Archive-on-expiry wiring (~1h)

**Files (edit):**
- [backend/auth/group_id_auth.py:312-316](../../../../backend/auth/group_id_auth.py#L312) — `_assert_active_group` raises `GroupExpired`; on this raise, the caller (or a new helper inside `_assert_active_group` if appropriate to keep the archive logic colocated) flips the associated `ChatSessionIndex.archived = True` and `archived_at = now`. Pick the right seam — preferred is a small helper `_archive_expired_session(group_id)` called once from the exception handler in the restore path, not from `_assert_active_group` itself (keep auth pure; archive is a side effect of the restore attempt)
- [backend/protocols/session_restore_routes.py](../../../../backend/protocols/session_restore_routes.py) — on `GroupExpired`, call the archive helper, then return `410 Gone` with body `{"detail": "session archived", "archived_at": "..."}` (not the current 404, if that's what it returns today — verify and adjust)
- [backend/db/models/chat_session.py](../../../../backend/db/models/chat_session.py) — verify `archived: bool = False` field is present alongside `archived_at`; if missing, add it (the design doc assumes both; M3 of M6 only adds if not already there)

**Acceptance:**
- [ ] Code path traced manually: expired group → restore attempt → `GroupExpired` → `_archive_expired_session` → `ChatSessionIndex` doc has `archived=True, archived_at=<now>` → caller returns 410
- [ ] Idempotent: re-running restore on an already-archived session does NOT re-archive (no-op the flip if already set) and still returns 410
- [ ] Archive flip is a Firestore write; pytest covers the in-memory fixture variant matching the production Firestore behaviour

#### M7 — Backend tests for TTL + archival (~0.5h)

**Files (new):**
- `backend/tests/integration/test_group_code_ttl.py` (new) — 5 cases:
  1. Fresh code mint → `expires_at ≈ now + 300d`
  2. Clock-forward past 30d → code still valid (regression guard for the old default)
  3. Clock-forward past 300d → `_assert_active_group` raises `GroupExpired`
  4. Expired code → restore returns 410 + session doc `archived=True`
  5. Re-restore on archived session → 410 (idempotent), no double-archive write

**Acceptance:**
- [ ] All 5 cases pass via `make test-fast` (mark `slow` only if real Firestore is needed; use in-memory fixture if available — check `backend/db/firestore_inmemory.py`)
- [ ] No regression in existing `backend/tests/integration/test_session_*` cases
- [ ] Backwards-compat case: a pre-existing JWT with `expires_at = mint_ts + 30*86400` still validates until its `expires_at` (not extended retroactively to 300d)

#### M8 — CLI sanity (~0.15h)

- [ ] `aiplatform sessions resume <freshly-minted-code>` → succeeds (unchanged behaviour)
- [ ] `aiplatform sessions resume <clock-forwarded-expired-code>` → returns a clear error code mentioning "archived" / "expired" (verify against current CLI behaviour; if the message is uninformative, file a follow-up — don't extend scope here)

### M9 — Quality gates + PR (~0.1h)

- [ ] `cd backend && make lint` green (ruff check + format-check)
- [ ] `cd backend && make test-fast` green
- [ ] No frontend changes in this sprint → `npm run quality:check` not required, but run it anyway as a no-op sanity check
- [ ] Combined diff is ≤ ~300 LOC (implementation + tests across both tracks)
- [ ] PR opened against `dev` with body linking both design docs:
  - [tutor-verbosity-fix.md](tutor-verbosity-fix.md)
  - [group-code-school-year-ttl.md](group-code-school-year-ttl.md)
- [ ] PR description explicitly notes: AR sign-off pending on verbosity-block copy (can land at review); existing 30d codes are NOT retroactively extended (backwards-compat by design)
- [ ] No emoji in commit message, PR title, or PR body (per `feedback_no_emoticons`)
- [ ] FF-merge to `dev` after green CI + AR thumbs-up

## Quality gates summary

```bash
# Track A only touches SKILL.md + tests/skills/ + tests/eval/
cd backend && make lint && make test-fast

# Track B touches auth + protocols + db/models + tests/integration/
# same gate covers both — single combined run

# Combined check before PR:
cd backend && make lint && make test-fast
# Sanity (no FE changes expected):
cd frontend && npm run quality:check
```

Per `feedback_pre_push_ci_parity`: `make test-fast` is the CI-parity check. **Do not push without it green.**

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Model ignores the 3-sentence constraint in M3 smoke | Medium | Re-run 3×; if consistent failure, escalate to few-shot examples (out of scope for this sprint per design doc — file follow-up) |
| AR wants different wording at PR review | Medium | The constraint block is one section; copy iteration is a small follow-up commit, not a re-scope |
| Renaming `DEFAULT_TTL_DAYS` breaks an import we missed | Low | Single source of truth in `group_id_auth.py`; grep verifies zero remaining references |
| Archive-flip races with a concurrent valid restore | Low | Restore path is serial per group_id under the existing Firestore transaction; the flip is inside the same critical section |
| `ChatSessionIndex.archived` field absent — assumption wrong | Low | M6 explicitly verifies; adds the field if missing (~3 LOC) |
| 410 Gone code is misleading vs 404 in some client | Low | 410 is HTTP-semantically correct ("the resource is gone, won't return"); CLI smoke catches misinterpretation |
| Backwards-compat 30d codes confuse users mid-pilot | Low | Documented in PR; no existing pilot teachers/students have 30d codes from before the change (pre-pilot) |

## Success criteria

- [ ] Both design docs' acceptance gates met (cross-reference: [tutor-verbosity-fix.md §Acceptance](tutor-verbosity-fix.md), [group-code-school-year-ttl.md §Acceptance](group-code-school-year-ttl.md))
- [ ] PR opened against `dev` from `feature/quick-wins-v11`
- [ ] Backend `make lint` + `make test-fast` green
- [ ] Both items merged in a single commit-or-PR; combined sprint diff ≤ ~300 LOC
- [ ] AR thumbs-up on the verbosity block (synchronous at PR review)
- [ ] Memory updated post-merge if any non-obvious finding emerged (e.g. the `archived` field was missing → that's a project memory worth saving)

## Post-sprint

- Move this sprint doc to `docs/design/aipla/v1.1.0-feedback/implemented/` once merged
- Update [docs/design/aipla/v1.1.0-feedback/SEQUENCE.md](SEQUENCE.md) sprint-status section (mirror the v1.0 pattern); mark 1.1.1 and 1.1.6 as shipped
- Add a "Sprint status" section to [SEQUENCE.md](SEQUENCE.md) if one doesn't exist yet (this is the first v1.1 sprint to land — the section gets bootstrapped here)
- File a small follow-up issue: "Frontend Archived-sessions filter on class detail" (out-of-scope from this sprint per §Scope)
- File a small follow-up issue if M3 smoke fails repeatedly: "Verbosity escalation — add few-shot examples"

## Out of scope (do NOT start in this sprint)

- The other seven v1.1 items (each has its own design doc and will get its own sprint)
- Frontend "Archived" filter / list UX
- Per-class TTL override
- Shared-preamble refactor across all skills
- Notification/email when class codes approach expiry
- Retroactive 30d → 300d migration for existing codes
- AR's iterative wording — handled at PR review; not a sprint blocker

## Related

- [tutor-verbosity-fix.md](tutor-verbosity-fix.md) — design doc for 1.1.1
- [group-code-school-year-ttl.md](group-code-school-year-ttl.md) — design doc for 1.1.6
- [SEQUENCE.md](SEQUENCE.md) — v1.1.0-feedback ordering; this sprint covers rows 1.1.1 and 1.1.6
- [docs/design/aipla/v1.0.0-pilot/implemented/quick-wins-sprint.md](../v1.0.0-pilot/implemented/quick-wins-sprint.md) — canonical small-bundled-sprint shape (1.E debounce + 1.H-TTS) this sprint mirrors
- [docs/design/aipla/v1.0.0-pilot/implemented/session-persistence.md](../v1.0.0-pilot/implemented/session-persistence.md) — 1.F, the shipped foundation this TTL extension builds on
