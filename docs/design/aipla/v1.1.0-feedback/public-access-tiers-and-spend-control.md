# Public access tiers and spend control — gating `aipla.ku.dk` before publicity

**Status:** **SHIPPED 2026-08-12** (ACCESS-1, all five milestones) — see [Outcome](#outcome--shipped-2026-08-12-access-1). Rollout steps remain before this reaches an env with real users.
**Last Updated:** 2026-08-12
**Priority:** **P0** — the domain has been live since 2026-08-11 17:46 UTC ([deployed-urls.md](../../../ops/deployed-urls.md#custom-domains--kudk-provisioned-2026-08-03-app-names-live-2026-08-11)); the exposure is already real, only unadvertised
**Estimated:** ~6–7.5d total, phased — M0 ~0.5d (no app code) · M1 ~2d · M2 ~2.5d · M3 ~2d · M4 ~0.75d
**Scope:** Fullstack + infrastructure — Firestore `teacher_access`, `User.access_tier`, a spend guard, a recorded-demo AG-UI event source, a Terraform quota ceiling, one new public page, CLI
**Dependencies:** [1.1.5 researcher-role](researcher-role.md) (SHIPPED — the custom-claim + admin-grant pattern this reuses); [1.1.9 cost-dashboard](cost-dashboard.md) (SHIPPED — `MODEL_RATE_CARD`, `class_spend`, the BigQuery accounting this defers to); [1.1.60 teacher-account-defaults](teacher-account-defaults.md) (SHIPPED — `teacher_prefs` + the tri-state flag convention); template Sprint 2.12 `budget/` module (SHIPPED but **inert** — see below)
**Source:** M, 2026-08-12 — *"before we publicise the aipla.ku.dk website, we need to make sure that if teachers sign up they can't spend money… but it would be nice that people can log in and at least be able to explore the app and be able to see demo responses without spend in a demo class… and if not on our allow list, a nudge to get in contact with us."*

---

## Problem

### The chain, as it stands today

Every link below is verified against code, not inferred:

1. **Google sign-in is unrestricted.** `signInWithGoogle()` ([frontend/src/lib/firebase.ts:132](../../../../frontend/src/lib/firebase.ts#L132)) constructs a bare `GoogleAuthProvider` with no `setCustomParameters({hd: ...})`. Any Google account on the internet can complete sign-in from an authorised origin — and `aipla.ku.dk` is an authorised origin ([infrastructure/env/firebase.tf:47-62](../../../../infrastructure/env/firebase.tf#L47-L62)). Email/password is additionally enabled on **prod** ([infrastructure/env/envs/prod.tfvars:23-26](../../../../infrastructure/env/envs/prod.tfvars#L23-L26)).

2. **A verified token *is* a teacher.** [backend/auth/firebase_auth.py:114](../../../../backend/auth/firebase_auth.py#L114) sets `is_teacher=True` as an **unconditional literal** in `_user_from_decoded_token`. It is not a claim, not a Firestore field, not a role. Line 107 additionally injects a synthetic `role:teacher` group tag, which is what makes teacher-only skills (`manage-class`) resolve for that identity. The docstring at :57-64 flags this as a known v1 shortcut awaiting "a real claim/role check".

3. **`assert_teacher` therefore passes for everyone.** [backend/auth/guards.py:14](../../../../backend/auth/guards.py#L14) is the single predicate behind ~35 call sites. Its predicate is `not user.is_teacher`, which is never true for a Firebase identity.

4. **First page load auto-provisions a tenancy.** `_TeacherClientShell` calls `useTeacherBootstrap` ([frontend/src/app/teacher/_TeacherClientShell.tsx:33](../../../../frontend/src/app/teacher/_TeacherClientShell.tsx#L33)) → `POST /api/teacher/bootstrap` → `seed_demo_for_teacher` ([backend/onboarding/demo_seed.py:492](../../../../backend/onboarding/demo_seed.py#L492)). Its only idempotency check is "does this uid already own a class" (:498). A stranger gets ~9 activities, a Demo class, **and a live student join code minted at :507**.

5. **Nothing caps the spend that follows.** The budget module exists and is wired into the ADK hot path at [backend/adk/agent.py:588](../../../../backend/adk/agent.py#L588) — but it is **inert on every turn**, for two independent reasons: `register_budget_enforcer()` has no call site outside tests, so `get_registered_enforcer()` returns `None` and [backend/budget/callback.py:64](../../../../backend/budget/callback.py#L64) short-circuits to no-ops; and no skill template declares a `tool_configs.budget` block, so `BudgetConfig.from_tool_configs` ([backend/adk/budget_config.py:65](../../../../backend/adk/budget_config.py#L65)) returns `None` — "exempt by absence".

6. **Thinking is unbounded by *code* default — but not in any deployed environment.** `_resolve_thinking_budget()` ([backend/adk/agent.py:176](../../../../backend/adk/agent.py#L176)) returns `-1` (Gemini 2.5 dynamic thinking, no ceiling) when `AIPLA_THINKING_BUDGET` is unset. **Verified 2026-08-12: all three environments deploy `AIPLA_THINKING_BUDGET=0`** on the backend sidecar (set at [cloudbuild.yaml:337](../../../../cloudbuild.yaml#L337); `gcloud run services update` preserves it through promote, so prod carries it too). So this is *not* an open hole today — but the safe value lives only in the pipeline, and the unsafe one is the code default. Any new service, Cloud Run job, or local process that forgets the env var runs unbounded. M0 closes that by moving the safe value into the code default and keeping the env var as the override.

### Why the join code is the real exposure

The naive threat model is "a curious stranger burns €5 chatting". That is not the risk worth designing against.

The risk is **step 4**: a signup mints an anonymous-group join code, and anonymous-group students need *no identity at all* — that is ADR-001 working as intended. One stranger's account, one shared link, and an unbounded number of unidentified sessions run against our Vertex project. The existing per-group defences (per-IP token bucket on join at [backend/auth/group_id_auth.py:718](../../../../backend/auth/group_id_auth.py#L718), 100 sessions/group/day at :457, per-group turn lock at [backend/skills/skill_processor.py:112](../../../../backend/skills/skill_processor.py#L112)) all limit *concurrency and joins*, never *spend*. A single group serialised to one turn at a time, running all day, is not rate-limited into safety.

**So the primary control is not a per-turn cap. It is refusing to mint join codes for accounts we have not invited.**

### The secondary exposure: spend paths that bypass the ADK gate

Any design that gates only the ADK `before_model_callback` misses a large fraction of spend. Ten paths call `genai.Client(...).aio.models.generate_content` directly, so no ADK callback fires:

| Path | Location | Reachable by |
|---|---|---|
| Compaction summariser (**uses `smart_model()`**) | [backend/adk/compaction_summarizer.py:241](../../../../backend/adk/compaction_summarizer.py#L241) | **student** — auto-fires on long sessions |
| PDF AI extraction (OCR fallback) | [backend/tools/documents/ai_extract.py:45](../../../../backend/tools/documents/ai_extract.py#L45) | any authed user via `POST /upload` |
| Chat title generation | [backend/db/title_generator.py:42](../../../../backend/db/title_generator.py#L42) | per session |
| Structured extraction | [backend/tools/structured_extraction.py:109](../../../../backend/tools/structured_extraction.py#L109) | after_agent callback |
| Analytics rubric judge | [backend/analytics/session_rubric.py:550](../../../../backend/analytics/session_rubric.py#L550) | teacher / background |
| Live class summary | [backend/analytics/live_class_summary.py:71](../../../../backend/analytics/live_class_summary.py#L71) | teacher |
| Chat-excerpt summarise | [backend/analytics/summarise.py:170](../../../../backend/analytics/summarise.py#L170) | teacher |
| Report narrative | [backend/reports/narrative.py:108](../../../../backend/reports/narrative.py#L108) | teacher |
| Search sub-agent | [backend/tools/search_agent.py:43](../../../../backend/tools/search_agent.py#L43) | agent tool |
| Code execution agent | [backend/tools/code_execution/agent.py:17](../../../../backend/tools/code_execution/agent.py#L17) | agent tool |

Plus non-`generate_content` spend: Vertex RAG ingestion + retrieval ([backend/db/rag_corpus.py:93](../../../../backend/db/rag_corpus.py#L93), :170, and the per-turn `VertexAiRagRetrieval` tool attached at [backend/adk/agent.py:435](../../../../backend/adk/agent.py#L435) — **student-reachable, fires inside the agent loop**), and Cloud TTS/STT ([backend/protocols/voice_routes.py:566](../../../../backend/protocols/voice_routes.py#L566), :692 — both student-reachable).

### Two fail-open behaviours that are wrong on a public domain

The template's budget module was designed for a trusted-tenant B2B product and fails **open** in two places. On the public internet both invert:

- **Unresolved identity → no-op + WARN** ([backend/budget/callback.py:131-144](../../../../backend/budget/callback.py#L131-L144)). Rationale in-code: "forks that misconfigure the identity_key shouldn't have the platform silently deny everyone." Correct for a paid tenant; wrong for an anonymous visitor.
- **Unknown model → free** — `estimate_cost` returns `0.0` for a model absent from `_COST_PER_1M` ([backend/observability/llm_metrics.py:59](../../../../backend/observability/llm_metrics.py#L59)). An unpriced model is therefore both uncharged and ungated.

### Impact

- **Who:** anyone who reaches `aipla.ku.dk` from the moment it is publicised. Cost lands on `aipla-prod-2026`.
- **How significant:** blocker for publicity. It is also a contract-hygiene issue — UCPH is the billing counterparty for a research programme, not a SaaS vendor absorbing abuse.

---

## Goals

**Primary goal:** No account that we have not explicitly invited can cause a single paid API call, while every visitor can still sign in, navigate the whole product, and watch a physics tutoring session play out end-to-end.

**Success metrics:**

- A signed-in non-invited account produces **zero** rows in `aipla_chat_turn` and **zero** Vertex/Anthropic/OpenAI billable requests. Asserted by test, not by inspection.
- A non-invited account **cannot mint a student join code** by any route (bootstrap seed, class UI, CLI, API).
- Every invited teacher has a named monthly cap; exceeding it degrades to the recorded demo with an explanatory message, never to a broken chat.
- A visitor reaches the "request access" route in one click from any teacher surface.
- Teacher-initiated spend becomes attributable, closing today's telemetry blind spot ([backend/observability/chat_log.py:78](../../../../backend/observability/chat_log.py#L78) returns `None` for Firebase identities, so co-pilot / analytics-chat / manage-class turns are **logged nowhere**).

**Non-goals:**

- **UCPH SSO.** Still v2 ([SEQUENCE.md:91](../SEQUENCE.md)). This design must work with Google + Firebase email/password exactly as they are.
- **Self-service signup, payment, or plan tiers.** There is no "upgrade" button. The only route from visitor to pilot is a human granting it.
- **Per-student budgets.** ADR-001 forbids student PII; group is the finest attributable grain and that is deliberate.
- **Replacing the BigQuery cost pipeline.** The cap is a circuit breaker; [cost_queries.py](../../../../backend/analytics/cost_queries.py) stays the accounting truth. See "The cap is not an accountant" below.
- **Rewriting `assert_teacher`'s 35 call sites.** See "Why `is_teacher` survives" below.

---

## Framework-native capability check (5b-ter)

- **Budget enforcement:** a `BudgetEnforcer` Protocol, an ADK before/after callback pair, a `BudgetConfig` schema and an integration test suite **already exist and are already wired into the hot path** (`backend/budget/`, [backend/adk/agent.py:588](../../../../backend/adk/agent.py#L588)). This design **implements the existing Protocol** with a Firestore backend and registers it. It introduces no new gate, no new callback, no new config schema. The in-memory reference impl ([backend/budget/in_memory_enforcer.py:33](../../../../backend/budget/in_memory_enforcer.py#L33)) is unusable here by its own docstring — single-instance only, and Cloud Run scales.
- **Demo responses:** no protocol capability covers "replay a recorded session". But the *transport* is already right — AG-UI is an event stream, and nothing in it requires a model behind it. The replay is a **second event source behind the same protocol**, so the frontend chat surface is unchanged. This is protocol reuse, not custom transport.
- **Access grant/revoke:** the researcher role already established the pattern — Firebase custom claim, set by an SA-allowlisted admin endpoint ([backend/admin/routes.py:119](../../../../backend/admin/routes.py#L119), gated by `_assert_caller_is_service_account`). This design reuses that pattern verbatim and adds a Firestore register in front of it so a teacher can be invited *before* they first sign in (a claim needs a uid; an invite only needs an email).
- **Hard ceiling:** `google_service_usage_consumer_quota_override` is the platform-native way to cap Vertex requests per project. No custom code can provide a guarantee this strong, because no custom code can bound what other custom code does.

---

## Design

### Four rings, weakest code at the centre

The rings are ordered so that the outermost needs no application code and the innermost is the least load-bearing. If ring 2 has a bug, rings 0 and 1 still hold.

```
Ring 0  Project ceiling      Terraform: Vertex quota override + billing budget alert
        ↑ no app code, cannot be bypassed by any application bug

Ring 1  Admission            teacher_access register → User.access_tier → assert_can_spend
        ↑ structural: a visitor never reaches a paid call site or mints a join code

Ring 2  Per-teacher cap      FirestoreBudgetEnforcer via the existing BudgetEnforcer Protocol
        ↑ circuit breaker for invited teachers; degrades to recorded demo

Ring 3  Attribution          BigQuery chat_turns + cost_queries (exists; extended to teachers)
        ↑ not a control — the record that tells you the other rings worked
```

### Ring 1 — the access register

#### Two tiers, plus the existing researcher layer

| Tier | Who | Navigate | Live model | Mint join codes | Upload / RAG ingest | Voice |
|---|---|---|---|---|---|---|
| `visitor` | **default** for any Firebase identity | full | **no** — recorded demo | **no** | no | no |
| `pilot` | individually invited | full | yes, under cap | yes | yes | yes |
| *researcher* | existing `role:researcher` claim, layers on `pilot` | + cross-class | — | — | — | — |

Named-email invites only, per the 2026-08-12 decision. A `@ku.dk` address grants nothing by itself; every account that can spend is a named person with a named cap. There is deliberately no domain wildcard — a domain rule cannot carry a per-person cap, and "one leaked link inside UCPH" would be unbounded.

#### Store — `teacher_access/{normalised_email}`

Keyed by email, **not uid**, because the whole point is to authorise someone before they have ever signed in.

```
teacher_access/{email}          // doc id: email.strip().lower()
{
  "email":         "anna@ku.dk",
  "tier":          "pilot",
  "monthlyCapUsd": 25.0,
  "grantedBy":     "mark@aitanalabs.com",
  "grantedAt":     "2026-08-12T09:00:00Z",
  "expiresAt":     "2026-09-15T00:00:00Z" | null,   // auto-lapse; see below
  "note":          "Pilot cohort A, Niels Bohr Institute",
  "revoked":       false,
  "uid":           "…" | null,       // stamped on first sign-in, for audit only
  "firstSeenAt":   "…" | null
}
```

Normalisation is `strip().lower()` and nothing more. No Gmail dot-folding, no plus-address stripping — the invited string must match what the IdP returns, and inventing equivalences here creates a way to be admitted under an address nobody invited. Document this in the CLI help so an invite typo fails visibly rather than silently admitting a near-match.

**`expiresAt` is the contract-hygiene feature.** The engagement ends 2026-09-15. Every grant defaults to expiring at the contract boundary, so the failure mode of forgetting to clean up is *access lapses*, not *access persists*. Extending is one CLI call.

#### Resolution — Firestore is the register, the claim is the credential

Reading Firestore inside `_user_from_decoded_token` on every request would put a network round-trip in the auth hot path. Instead:

- **Firestore `teacher_access` is the source of truth.** Admin writes here.
- **A Firebase custom claim `access_tier` is the carried credential.** [backend/auth/firebase_auth.py](../../../../backend/auth/firebase_auth.py) reads it from the decoded token — free, no I/O — exactly as it already reads `role` for researcher at :108.
- **`POST /api/teacher/bootstrap` is the reconciliation point.** It already runs on every teacher app load ([useTeacherBootstrap.ts:16](../../../../frontend/src/hooks/useTeacherBootstrap.ts#L16)) and already performs a one-time `window.location.reload()` when it returns `seeded: true` — which is precisely the token-refresh trigger a newly-set claim needs. Bootstrap gains: read `teacher_access/{email}`, compare to the current claim, and on drift set the claim + return `tierChanged: true` so the frontend force-refreshes the ID token.

The staleness window is therefore bounded by the Firebase claim propagation (≤1h, or immediate on next app load). **That is acceptable for a grant and unacceptable for a revoke** — so revoke additionally calls `revoke_refresh_tokens(uid)` (Firebase Admin SDK), which invalidates outstanding sessions immediately. `expiresAt` is likewise checked against the register, not the claim, inside `assert_can_spend` — see below.

**Absent claim ⇒ `visitor`.** A brand-new sign-in has no claim, so the default is the safe one by construction rather than by an explicit check that could be forgotten.

#### `User.access_tier` — and why `is_teacher` survives unchanged

The instinct is to make `is_teacher` conditional at [firebase_auth.py:114](../../../../backend/auth/firebase_auth.py#L114). **Don't.** That boolean is load-bearing for ~35 `assert_teacher` call sites whose actual meaning is *"this is a Firebase identity, not an anonymous-group student"* — the dual-auth distinction the repo has re-broken repeatedly (see the Footguns table in [CLAUDE.md](../../../../CLAUDE.md)). Making it mean *"this person is allowed to spend"* would silently change the semantics of every one of those sites, and the ones it would break are exactly the navigation surfaces a visitor is supposed to reach.

So: **split the concepts, don't overload the boolean.**

```python
class User(BaseModel):
    ...
    is_teacher: bool = False      # unchanged: "Firebase identity, not a group student"
    is_researcher: bool = False   # unchanged
    access_tier: Literal["visitor", "pilot"] = "visitor"   # NEW — governs spend + fan-out
```

A new, narrower guard sits beside the existing one:

```python
# backend/auth/guards.py — beside assert_teacher, sharing its file for the same reason
def assert_can_spend(user: User, detail: str = "…") -> None:
    """Reject callers whose tier does not authorise paid work.

    Deliberately narrower than assert_teacher: a visitor IS a teacher for
    navigation and MUST remain so. This gate is only about money and fan-out.
    """
    if user.access_tier != "pilot":
        raise HTTPException(status_code=402, detail=detail)
```

`402 Payment Required` rather than `403`: it is a distinct condition the frontend must render differently (nudge, not "access denied"), and a distinct status keeps the two apart without string-matching a message.

#### Where `assert_can_spend` goes

Derived from the spend inventory above — the complete set of paid entry points reachable by a signed-in visitor:

| Surface | Guard site |
|---|---|
| Live agent turn | [backend/skills/skill_processor.py:81](../../../../backend/skills/skill_processor.py#L81) `process_skill_request` — the single chokepoint for **all four** agent entry points (AG-UI stream, `/greet`, proactive-event-check, MCP/channel) |
| Proactive greet / event-check | covered transitively by the above; also gated early at [proactive_routes.py:115](../../../../backend/protocols/proactive_routes.py#L115), :313 to avoid pointless work |
| Join-code minting | `mint_group_codes_under_class`, and conditionally at [demo_seed.py:507](../../../../backend/onboarding/demo_seed.py#L507) |
| Curriculum ingest / query / summarize | [curriculum_routes.py:336](../../../../backend/protocols/curriculum_routes.py#L336), :619, :470 |
| Document upload AI extraction | [backend/tools/documents/upload.py:263](../../../../backend/tools/documents/upload.py#L263) |
| Voice TTS / STT | [voice_routes.py:566](../../../../backend/protocols/voice_routes.py#L566), :692 |
| Analytics/report generation | rubric judge, live class summary, report narrative — all teacher-initiated |

**A visitor still gets the demo seed** — the ~9 activities and the Demo class are the thing they came to explore. The one conditional line is the join code at `demo_seed.py:507`: a visitor's Demo class has no code, and the class page shows "Student join codes are available to programme participants" with the access link, instead of a code card.

### Ring 1b — the recorded demo path

This is the only genuinely new machinery, and the design keeps it small by putting it behind the protocol rather than in front of it.

#### What it is

`stream_agui_events` ([skill_processor.py:285](../../../../backend/skills/skill_processor.py#L285)) is an async generator of AG-UI events. Nothing about AG-UI requires a model behind it. For a `visitor`, `process_skill_request` selects a **replay source** instead of the agent runner: it emits the same `TEXT_MESSAGE_START` / `…_CONTENT` / `…_END` sequence, chunked and paced to resemble generation, from a stored transcript.

The frontend chat surface, `AGUIProvider`, streaming markdown, SVG handling, sim frames — all unchanged. That is the whole reason to do it this way.

#### Where the content lives

Seeded content, not code, so a transcript can be improved without a deploy — the same posture as the demo activities themselves:

```
demo_transcripts/{activityId}
{
  "activityId": "demo-boldkast",
  "language": "da",
  "turns": [
    {"role": "user",      "text": "Jeg har kastet bolden, men den lander for kort."},
    {"role": "assistant", "text": "Hvad sker der med rækkevidden, hvis du …",
     "elements": [ … optional recorded tool/sim events … ]}
  ],
  "recordedAt": "2026-08-12T…", "recordedFrom": "session:…"
}
```

Recorded from real sessions M or JB run against a pilot account, exported through the existing session-report tooling. Seeded alongside the demo activities in [backend/onboarding/demo_seed.py](../../../../backend/onboarding/demo_seed.py) and re-seedable via the existing `make seed`-shaped path.

#### Honesty — this is where the design could go wrong

The project rule is *"shipped surfaces show real data or honest empty/error states, never fabricated fallbacks"* (memory `feedback-no-mock-in-shipped-ui`, CI guard `check:no-mock`). A recorded demo is **not** a violation of that rule, but only because of an explicit property: **it never claims to be live.** The distinction is fabricated-content-passed-as-real (forbidden) versus a labelled recording (fine — a product demo video is not a lie). The design must hold that line mechanically, not by good intentions:

- A persistent, non-dismissible affordance on the chat surface: *"Recorded demonstration — the tutor is replaying a real session, not responding to you."* Modelled on the existing `LocalModeBanner` pattern ([frontend/src/components/LocalModeBanner.tsx:37](../../../../frontend/src/components/LocalModeBanner.tsx#L37)).
- Free-typed off-script input never gets a fabricated answer. It gets a fixed card: *"This is a recorded session, so the tutor can't answer new questions here. Teachers in the programme get a live tutor — request access."* Honest empty state, plus the nudge, in the place the user is most engaged.
- The replay never emits a citation, a rubric score, or a token count. Anything that would be read as a *measurement* is withheld; only the conversation is replayed.

Naming: avoid the `_mock-data` / `getMock` / `MOCK_[A-Z]` token shapes that `check:no-mock` ([frontend/package.json:17](../../../../frontend/package.json#L17)) greps for. Use `demoTranscript` / `RECORDED_*`. The gate is lexical and would otherwise fire on correct code.

**Flag naming, separately:** do **not** reuse the `LOCAL_MODE` name for any part of this. `scripts/check_local_mode_safety.py:33-35` regex-bans that identifier in every deployed config file, and the recorded demo must run in prod.

### Ring 2 — the per-teacher cap

#### Billing identity: students are billed to their teacher

Per the 2026-08-12 decision, the cap is per invited teacher per month, and student turns count against the teacher who owns their class. That is what makes the cap cover the fan-out rather than just the teacher's own typing.

```
resolve_billing_identity(user) ->
    Firebase identity      → f"teacher:{user.uid}"
    anonymous-group student → group_id → anon_groups/{code}.classId → class.ownerUid
                            → f"teacher:{ownerUid}"
    unresolvable            → None  → FAIL CLOSED (block), not fail open
```

The group → class resolution already exists — `_resolve_class_tags` ([backend/auth/group_id_auth.py:211](../../../../backend/auth/group_id_auth.py#L211)) walks exactly this path for tag namespacing. Cache the mapping per group with a short TTL; it changes rarely.

This is implemented as the `identity_key` indirection the existing `BudgetConfig` already provides ([backend/adk/budget_config.py](../../../../backend/adk/budget_config.py)) — the skill declares the key, the enforcer resolves it. No schema change.

#### `FirestoreBudgetEnforcer`

Implements the existing `BudgetEnforcer` Protocol ([backend/budget/enforcer.py:69](../../../../backend/budget/enforcer.py#L69)) — `consult()` and `record()`, both async, duck-typed. Registered once at startup in `fast_api_app.py`. Cap read from `teacher_access/{email}.monthlyCapUsd`; running total in a sharded counter:

```
teacher_spend/{uid}/periods/{YYYY-MM}/shards/{0..9}   // {spentUsd: float}
```

Sharded because a single Firestore document sustains roughly one write per second, and a class of 30 students mid-lesson will exceed that. `record()` writes to a random shard transactionally; `consult()` reads a cached sum refreshed on a short interval.

#### The cap is a circuit breaker, not an accountant

Say this plainly in the code and the runbook, because the sharded-cache design has a real consequence: **overshoot is possible and bounded by staleness × burn rate.** A cap will not be enforced to the cent, and it is not supposed to be. Its job is to convert an unbounded liability into a bounded one. The BigQuery pipeline ([cost_queries.py:241](../../../../backend/analytics/cost_queries.py#L241) `class_spend`, `MODEL_RATE_CARD` at [rate_card.py:38](../../../../backend/analytics/rate_card.py#L38)) remains the accounting truth, and Ring 0 remains the actual ceiling.

Designing for exactness here would mean a synchronous, unsharded, transactional decrement on every turn — latency on the critical path and a hot-document bottleneck, in exchange for precision nobody needs from a safety net.

#### Two fail-open inversions

Both are one-line changes, both need a regression test naming the reason:

1. `_extract_identity` returning empty → currently no-op + WARN ([callback.py:131-144](../../../../backend/budget/callback.py#L131-L144)). Inverts to **block**. The template's rationale (don't deny everyone on misconfiguration) is a trusted-tenant assumption; a misconfiguration on a public domain must fail towards not-spending. Mitigation for the operational risk it introduces: the enforcer emits a distinct high-severity log + metric on identity-unresolved blocks, so a misconfiguration is loud rather than silent.
2. `estimate_cost` returning `0.0` for an unknown model ([llm_metrics.py:59](../../../../backend/observability/llm_metrics.py#L59)). Inverts to raising, so an unpriced model is refused rather than silently free. Add a startup assertion that every model in [backend/config/models.yaml](../../../../backend/config/models.yaml) has an entry in the rate card — the two tables already disagree on `gemini-2.5-flash` (USD 0.15/0.60 per 1M in `llm_metrics.py:29` vs EUR 0.0003/0.0012 per 1k ≈ 0.30/1.20 per 1M in `rate_card.py:38`), which is its own latent bug worth closing here.

#### Degradation when the cap is hit

`BudgetExceededError` already carries the decision object ([enforcer.py:96](../../../../backend/budget/enforcer.py#L96)) with `message` and `retry_after_seconds`. For a **student** whose teacher is capped, the chat must not simply break mid-lesson: fall through to the recorded-demo source for the remainder of the session with a clear notice, and alert the teacher. GRACEFUL DEGRADATION is why Ring 1b is worth building even for a purely internal pilot.

#### The paths the ADK callback cannot see

One shared helper, called from the ten direct-`genai` sites and the RAG/voice paths, consulting the same registered enforcer:

```python
# backend/budget/spend_guard.py
async def guard_spend(user: User, *, purpose: str, projected_usd: float) -> None:
    """Non-ADK spend gate. Same enforcer, same identity resolution."""
```

Mechanical to add, and it is the difference between a gate that covers the agent loop and one that covers the bill. **Note the sharpest case:** the compaction summariser ([compaction_summarizer.py:241](../../../../backend/adk/compaction_summarizer.py#L241)) is student-triggered, auto-fires on long sessions, and uses `smart_model()` — the expensive tier. It is currently the highest-cost student-reachable call in the system that nothing gates.

### Ring 3 — closing the teacher attribution blind spot

`emit_chat_turn` skips Firebase identities entirely: `group_code_from_owner_uid()` returns `None` for a teacher and the emit is skipped ([chat_log.py:78](../../../../backend/observability/chat_log.py#L78)). That was an ADR-001 PII decision about *students*, but its effect is that **teacher co-pilot, analytics-chat and manage-class turns produce no token telemetry at all** — the most tool-heavy skills in the product are invisible to the cost dashboard.

Emit teacher turns keyed on `teacher:{uid}` with `content` omitted (no transcript, so no new PII surface) but `model` / `token_in` / `token_out` retained. Also wire `record_llm_cost()` ([llm_metrics.py:62](../../../../backend/observability/llm_metrics.py#L62)), which is fully implemented and has no non-test call site.

### Ring 0 — the ceiling that needs no application code

Ships first because it depends on nothing in this design and holds even if everything else has a bug.

- **`google_service_usage_consumer_quota_override`** on `aiplatform.googleapis.com` per environment, sized to a generous multiple of expected pilot load. This is a genuine hard ceiling: no application bug can exceed it.
- **`google_billing_budget`** with threshold alerts at 50/90/100% to M + a Pub/Sub topic. Alerts do not stop spend — the quota does — but they are how you find out.
- **Make the *code* default for `AIPLA_THINKING_BUDGET` safe.** All three envs already deploy `=0` (verified 2026-08-12), so the deployed posture is fine; the risk is that `_resolve_thinking_budget()` falls back to `-1` (unbounded) whenever the env var is absent — which is true for every Cloud Run job, script and local process. Flip the fallback to `0` and keep the env var as the override, so the unsafe value has to be asked for.

> **Per the [CLAUDE.md](../../../../CLAUDE.md) footgun table:** any *new* per-env `--set-env-vars` must land in **both** `cloudbuild.yaml` **and** `cloudbuild.promote.yaml`. Prod is reached only via `make promote`, and this exact omission has already bitten three separate values. `AIPLA_THINKING_BUDGET` itself needs no promote twin — `gcloud run services update` preserves env vars, and prod's value was verified as `0`.

### Ring 1c — the nudge

- **`/teacher/access`** — a page in the `(site)` route group (so `SiteFooter` is structural, per the 1.1.74 gate): what AIPLA is, who the programme is for, what a participant gets, and a request form.
- **Banner** on teacher surfaces for `access_tier === "visitor"`: *"You're exploring AIPLA with a recorded demonstration. Teachers in the programme get a live tutor for their classes."* + link. Non-blocking, dismissible per session, re-shown on any `402`.
- **`POST /api/teacher/access-request`** → `access_requests/{uid}` `{email, name, institution, message, requestedAt, status: "pending"}`. Authenticated (they are signed in), so no new unauthenticated write surface.
- **The queue closes the loop:** `aiplatform access requests` lists pending; `aiplatform access grant <email> --cap 25 --note "…"` writes `teacher_access`, sets the claim if the uid is known, and marks the request granted. The admin path reuses the SA-allowlist gate at [backend/admin/auth.py:25](../../../../backend/admin/auth.py#L25) — no new admin auth mechanism.

### Flow

```
Google sign-in (unrestricted — unchanged)
        │
        ▼
POST /api/teacher/bootstrap  ── reads teacher_access/{email} ──┐
        │                                                      │
        │  claim drift? → set custom claim, return tierChanged │
        │  → frontend force-refreshes ID token                 │
        ▼                                                      ▼
   access_tier = "visitor"                          access_tier = "pilot"
        │                                                      │
   demo seed, NO join code                     demo seed + join code
        │                                                      │
   navigate everything                              navigate everything
        │                                                      │
   chat → replay source                        chat → assert_can_spend ✓
   (recorded, labelled)                              → enforcer.consult()
        │                                              ├── allow → live model
   access nudge + /teacher/access                      ├── warn  → live + notice
                                                       └── block → recorded demo
                                                                   + teacher alert
```

---

## Axiom Alignment

Scored per [Product Axioms](../../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | **−1** | The spend gate adds a Firestore read before the first token on every live turn. Mitigated (in-process TTL cache on the access doc; the consult runs concurrently with agent construction; the tier itself is read from the JWT with no I/O) but not eliminated. Justified below. |
| 2 | EARNED TRUST | +1 | The recorded demo is labelled as a recording and never fabricates an answer to an off-script question. Conditional on the honesty properties above — without them this would be −1. |
| 3 | SKILLS, NOT FEATURES | 0 | No new skill; access tier is orthogonal to the skill abstraction. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | The right model for an uninvited stranger's demo is no model. Also forces `AIPLA_THINKING_BUDGET` off its unbounded default. |
| 5 | GRACEFUL DEGRADATION | +1 | Cap exceeded → recorded demo + explanation, never a broken chat mid-lesson. Access-lookup failure → last-known-good tier for navigation, fail-closed for spend. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Implements the existing `BudgetEnforcer` Protocol rather than adding a gate; the replay is a second event source behind AG-UI, not a second transport. |
| 7 | API FIRST | +1 | Grant/revoke/list/requests are API + CLI first; the admin UI is optional and out of scope. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Closes the teacher-spend telemetry blind spot and activates the dormant `record_llm_cost()`. |
| 9 | SECURE BY CONSTRUCTION | +1 | Removes the `is_teacher=True` → auto-provisioned join code → unlimited spend chain. Default-deny by absence of a claim, not by an explicit check that can be forgotten. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Tier decisions are server-side; the chat surface is unchanged by replay. The frontend renders a `402`, it does not compute eligibility. |
| | **Net Score** | **+7** | Threshold: ≥ +4 |

**Conflict justification (Axiom 1, −1):** the added latency is a Firestore document read on the live-turn path, at a point where the alternative is an unbounded liability on a public domain. It is bounded by caching and overlapped with agent construction, and it does not affect the recorded-demo path at all — which is the path most visitors will experience. INSTANT FEEL's own tradeoff clause deprioritises backend simplicity for UX payoff; here we accept a small, cached, overlappable cost for a control the product cannot ship publicly without.

---

## Implementation plan

### M0 — Pre-publicity hard stops (~0.5d, no application code)

- [ ] `AIPLA_THINKING_BUDGET` set per env — **in both `cloudbuild.yaml` and `cloudbuild.promote.yaml`**
- [ ] `google_service_usage_consumer_quota_override` on `aiplatform.googleapis.com`, per env, in `infrastructure/env/`
- [ ] `google_billing_budget` + alert thresholds → M and a Pub/Sub topic
- [ ] Record the ceiling numbers in [docs/ops/deployed-urls.md](../../../ops/deployed-urls.md) or a sibling runbook
- [ ] Confirm the Firebase email/password posture on prod is intended (`prod.tfvars:23-26`) — there is no signup UI, but the Identity Toolkit `signUp` REST endpoint is enabled with the provider

### M1 — Access tiers (~2d)

- [ ] `teacher_access` Firestore model + accessors (~120 LOC)
- [ ] `access_tier` custom claim; read in `_user_from_decoded_token`; `User.access_tier` field (~40 LOC)
- [ ] Bootstrap reconciliation + `tierChanged` → frontend token refresh (~80 LOC)
- [ ] `assert_can_spend` in `auth/guards.py` + all call sites from the table above (~150 LOC)
- [ ] `demo_seed.py:507` conditional — no join code for visitors (~20 LOC)
- [ ] Admin endpoints `grant` / `revoke` (with `revoke_refresh_tokens`) / `list`, SA-gated (~120 LOC)
- [ ] `aiplatform access grant|revoke|list|requests` CLI (~150 LOC)
- [ ] Frontend: render `402` as the nudge, not an error (~60 LOC)

### M2 — Recorded demo path (~2.5d)

- [ ] `demo_transcripts` model + seeding, recorded from real pilot sessions (~100 LOC + content)
- [ ] Replay event source behind `stream_agui_events`, realistic cadence (~200 LOC)
- [ ] `process_skill_request` source selection by tier (~40 LOC)
- [ ] Frontend recording affordance + off-script card (~120 LOC)
- [ ] **Zero-spend assertion test** — a visitor session produces no model client call (see Testing)

### M3 — Per-teacher budget enforcer (~2d)

- [ ] `FirestoreBudgetEnforcer` implementing the existing Protocol, sharded counters (~250 LOC)
- [ ] `register_budget_enforcer(...)` at startup (~10 LOC)
- [ ] `resolve_billing_identity` — group → class → owner uid, cached (~80 LOC)
- [ ] `tool_configs.budget` blocks on skill templates (**re-seed required** — `make seed ENV=…`)
- [ ] Both fail-open inversions + rate-card/models.yaml startup consistency assertion (~60 LOC)
- [ ] `spend_guard.guard_spend` + the ten direct-`genai` call sites + RAG + voice (~150 LOC)
- [ ] Cap-exceeded → recorded-demo fallthrough + teacher alert (~80 LOC)

### M4 — Access request + nudge (~0.75d)

- [ ] `/teacher/access` page in the `(site)` route group (~150 LOC)
- [ ] Visitor banner on teacher surfaces (~60 LOC)
- [ ] `POST /api/teacher/access-request` + `access_requests` collection (~80 LOC)
- [ ] `aiplatform access requests` + grant-from-queue (~60 LOC)

### Sequencing — what actually gates publicity

**Hard gate: M0 + M1 + M4.** With these, an uninvited account can sign in, navigate, cannot spend, cannot mint a join code, and is told how to join. M1 alone would leave a visitor with a chat that refuses to respond, which is safe but poor.

**M2 delivers the ask as stated** — "see demo responses without spend" — and turns a dead end into a demonstration. Strongly wanted for publicity; strictly it is UX, not safety.

**M3 before the first cohort outside the invited set**, and before any grant to someone whose usage we cannot watch directly. Until M3 lands, invited teachers are uncapped below Ring 0 — acceptable for a handful of known pilot teachers, not beyond that.

---

## Testing strategy

### The load-bearing test

```python
async def test_visitor_session_makes_no_paid_call(monkeypatch):
    """A visitor's full chat session touches no model client.

    Patches every model constructor (Gemini, Claude, LiteLlm) and the
    genai async client to raise. Runs sign-in → bootstrap → demo class →
    several chat turns, including an off-script message. Any paid call
    fails the test by construction rather than by assertion.
    """
```

This is the test that lets us publicise the domain. It must patch **both** the ADK path and the direct-`genai` path, or it certifies only half the surface.

### Backend (pytest)

- [ ] Tier resolution: absent claim → `visitor`; `pilot` claim → `pilot`; revoked → `visitor`; `expiresAt` in the past → `visitor`
- [ ] `assert_can_spend` returns 402 on every guarded route for a visitor, 200 for a pilot
- [ ] A visitor's bootstrap seeds activities + Demo class and mints **no** join code
- [ ] Email normalisation: `Anna@KU.dk` matches `anna@ku.dk`; `anna+test@ku.dk` does **not** match `anna@ku.dk`
- [ ] Revoke invalidates outstanding sessions (`revoke_refresh_tokens` called)
- [ ] Billing identity: student in teacher T's class resolves to `teacher:{T.uid}`; orphan group → `None` → **block**
- [ ] Enforcer: cap not exceeded → allow; soft threshold → warn; exceeded → block; concurrent shard writes sum correctly
- [ ] Fail-closed: unresolved identity blocks; unknown model raises
- [ ] Startup assertion fires if `models.yaml` gains a model absent from the rate card

### Frontend (vitest)

- [ ] Visitor sees the recording affordance; pilot does not
- [ ] Off-script input renders the honest card, never a fabricated answer
- [ ] `402` renders the nudge with a working link, not a generic error
- [ ] Visitor class page shows the "codes are for programme participants" state, no code card
- [ ] `bootstrap` returning `tierChanged` triggers a token refresh

### Manual

- [ ] Sign in with a personal Google account against **deployed dev** — confirm visitor, confirm no code, confirm the demo plays, confirm the nudge
- [ ] Grant that account via CLI, reload, confirm it becomes pilot and the chat goes live
- [ ] Revoke, confirm the session drops to visitor without a manual sign-out
- [ ] Check BigQuery: the visitor session produced no `aipla_chat_turn` rows

---

## Security considerations

- **Default-deny by absence.** A missing claim yields `visitor`. A new code path that forgets to check the tier still cannot spend, because the tier defaults safe rather than defaulting to the last-set value.
- **Enumeration.** `POST /api/teacher/access-request` must not reveal whether an email is already on the register — same response either way.
- **Claim staleness on revoke.** Handled by `revoke_refresh_tokens`, plus an `expiresAt` check against the register (not the claim) inside `assert_can_spend`, so a lapsed grant cannot ride a stale token to the contract's end.
- **Privilege escalation via the register.** `teacher_access` is written only by SA-allowlisted admin endpoints ([backend/admin/auth.py:25](../../../../backend/admin/auth.py#L25)) and has no `firestore.rules` entry, so client SDKs cannot touch it. Add an explicit deny rule anyway — the collection's absence from the rules file is currently doing the work implicitly.
- **PII.** `access_requests` holds a name, email and institution for people who may never be granted. Add a retention rule (purge declined/stale after 90 days) and name it in the privacy page.
- **The recorded transcripts are real sessions.** They must be recorded from M/JB accounts or fully anonymised before seeding — do not export a student session into a public demo. This is a review gate on the content, not a code property.

---

## Open questions

- **Cap default.** What is a sensible `monthlyCapUsd` for a pilot teacher with ~30 students? Answerable from data: run `class_spend` over the pilot classes for August and size the default at ~3× observed. Until then, deliberately low with an easy CLI raise.
- **Danish copy.** The nudge, the recording affordance and `/teacher/access` are visitor-facing on a `ku.dk` domain and want Danish-first copy with English secondary, matching [(site)/page.tsx:75](../../../../frontend/src/app/%28site%29/page.tsx#L75). Needs JB review before publicity.
- **Which activities get transcripts.** All ~9 demo activities is the complete answer but the most recording effort. Suggest starting with Boldkast + one non-sim concept activity, and letting the others show a "recording coming soon" state — still honest, far cheaper.
- **Does a visitor keep their Demo class after being granted?** Simplest: yes, the seed is idempotent by owner and the join code is minted on grant. Worth confirming against `demo_seed.py:498`'s "already owns a class" short-circuit, which would otherwise skip a re-seed.
- **Announcement coordination.** Ring 0's quota ceiling should be sized *before* publicity, not after the first spike.

---

## Related documents

- [cost-dashboard.md](cost-dashboard.md) — 1.1.9, the spend *visibility* half; explicitly deferred the class-level cap bar to "a separate row". This is that row.
- [researcher-role.md](researcher-role.md) — 1.1.5, the custom-claim + admin-grant pattern reused here
- [teacher-account-defaults.md](teacher-account-defaults.md) — 1.1.60, `teacher_prefs` and the tri-state flag convention
- [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) — 1.A, the ownership/tag-namespace model the tier sits beside
- [docs/ops/deployed-urls.md](../../../ops/deployed-urls.md) — the `ku.dk` custom-domain state that makes this urgent
- ADR-001 (anonymous group auth) in the scoping site — why students have no identity, and therefore why the join code is the fan-out vector

---

## Outcome — shipped 2026-08-12 (ACCESS-1)

All five milestones landed in one session. Backend 3090 tests + lint; frontend
1652 tests + build; all six CI gates green.

| Milestone | Commit | State |
|---|---|---|
| M0 ceiling | `38e40f4` | Quota **applied + verified on dev**; test/prod are one `APPLY=1` away |
| M1 access tiers | `789c050` | Shipped |
| M4 nudge | `d8e428f` | Shipped |
| M2 recorded demo | `acf718a` | Shipped |
| M3 enforcer | `7a41aaf` | Shipped; call sites for the non-ADK guard are a follow-up |

### What the build changed about the design

- **`AIPLA_THINKING_BUDGET` was never actually open.** The design said unbounded;
  all three deployed envs already set `=0`. The *code* default was `-1`, which
  meant every Cloud Run job, script and local process ran the most expensive
  setting. Fixed there instead.
- **The Vertex quota override is a script, not Terraform.**
  `google_service_usage_consumer_quota_override` does not exist in the google or
  google-beta provider at the pinned 6.50.0 — verified against both binaries.
  `scripts/spend-ceiling.sh` applies **and reads back**, because an override with
  a wrong `base_model` dimension applies to nothing and still exits 0.
- **`identity_key: group_id` would have been a live bug.** Empty for a teacher
  (and the callback now fails closed → every teacher blocked), and a raw group
  code resolves to no cap → never bites for students either. `User.billing_key`
  fixes both.
- **The startup rate-card check earned itself immediately**: `gpt-5.4` and
  `gpt-5.1-chat-latest` were in `models.yaml` with no price, i.e. both uncharged
  and ungated.
- **61 test failures were the migration canary.** Every existing teacher becomes
  a visitor on the M1 deploy. `backend/scripts/grandfather_access.py` handles it,
  **uncapped by default** — newly capping people mid-pilot could cut a lesson off.

### Before this reaches an environment with real users

1. `cd backend && uv run python -m scripts.grandfather_access` (dry run), then `--apply`.
   **Same change window as the deploy**, or every existing teacher is a visitor.
2. `make spend-ceiling ENV=test APPLY=1` and the same for prod.
3. Re-seed so the `tool_configs.budget` blocks reach Firestore (automatic on deploy).
4. Grant the real pilot cohort: `aiplatform users grant-access <email> --cap N`.

### Deliberately not done

- **`spend_guard` call sites.** The seam, the enforcer and the tests exist; the
  ~13 direct-`genai`/RAG/voice call sites are not yet wired to it. Until they
  are, the cap covers the agent loop and Ring 0 covers the rest.
- **Ring 3 teacher attribution.** Teacher turns are still logged nowhere
  (`chat_log.py:78`), so the co-pilot remains invisible to the cost dashboard.
- **The `gemini-2.5-flash` rate divergence** (2x between the two tables) is
  recorded in a comment, not resolved — picking one silently would make both
  tables agree while both being wrong.

### Open — raised by M 2026-08-12: should researchers configure budgets?

**Today: no.** The register is SA-allowlisted only (`aiplatform users
grant-access`, via an impersonated service-account token). The `role:researcher`
claim grants cross-class **read**; it confers nothing on the register.

That was deliberate — but the workflow objection is real: JB and AR are the
people who would actually know a new teacher should be admitted, and routing
every invite through M is a bottleneck.

The recommendation is **not** to extend the researcher claim to cover it.
`researcher` currently means "may read across classes for research purposes";
making it also mean "may commit money" is a privilege escalation by conflation,
and the two roles genuinely differ — a research collaborator analysing
transcripts is not necessarily someone who should be able to raise a spend cap.

Suggested shape for a follow-up row, in increasing order of commitment:

1. **Read-only register + queue view for researchers** (~0.5d). They can see who
   is waiting and who is granted, and ping M. Low risk, removes most of the
   friction, requires no new role.
2. **A distinct `programme-admin` claim** that may grant/revoke *within a bounded
   cap*, with raising a cap above that bound and revoking still SA-only (~1.5d).
   Keeps "commit money" a separate, auditable capability from "read research
   data".
3. Full in-product register administration (~2.5d). Not recommended before
   handover — an admin UI is a durable surface, and this register's shape is
   likely to change when UCPH SSO lands.
