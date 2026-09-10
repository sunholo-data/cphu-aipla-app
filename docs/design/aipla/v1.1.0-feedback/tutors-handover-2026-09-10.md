# Handover — the tutor layer (1.1.91), as of 2026-09-10

**For:** the next session, and AD. **Written:** 2026-09-10, end of a two-day build.
**Design doc:** [researcher-configurable-tutors.md](researcher-configurable-tutors.md) — its
milestone table is the live per-milestone state; this document is the orientation.

## What this is, in one paragraph

A tutor used to be a file in git, and the people who own the pedagogy cannot write files in
git. It is now an object with a **theory attached as structured data** — framework →
constructs → observable behaviours, each traceable to a published paper — which a researcher
can edit in the running app, a teacher can pick in one click, and anyone at all can read on
the public website. All seven teaching frameworks are now written. The mechanism is complete
and in production; the library and the authoring tools are not.

## ⚠️ Read these five things before changing anything

1. **The passthrough guarantee is the safety property of the whole layer.** An activity with
   no tutor, or a class with no tutor, composes **byte-identically** to before any of this
   existed. Every base tutor carries `framework_id: null` for the same reason. Several tests
   assert it. If you break it, every existing classroom changes at once.
2. **No base tutor is paired with a framework, deliberately.** "Sofie teaches with ESRU" is a
   pedagogical claim, and the catalogue does not make claims nobody signed off. Frameworks
   arrive through a **variant**. ⚠️ This rule used to be illustrated by the five empty
   framework slots; those were filled on 2026-09-10 and the rule is unchanged. All seven are
   `ready_for_review`, so asserting one on a base tutor still claims a sign-off AR/JB have
   not given.
3. **`docs/design/aipla/tutors/*.md` and `frontend/content/project/tutors/*.md` are
   GENERATED.** Edit `backend/frameworks/*.yaml` and run `make tutor-docs`. `make
   check-tutor-docs` is CI-gated and will fail your build if you hand-edit them.
4. **Never invent a citation.** `Provenance.vouched_by` has no default and no empty value, so
   an unvouched source is unconstructable. This is a hard requirement for the M2 co-pilot, not
   a caution — a model confabulating a reference into a research instrument that reaches a
   journal paper is the worst failure available here.
5. **Only four of the eight `SKILL.md` templates are tutors.** `manage-class`,
   `analytics-chat`, `activity-authoring-assistant` and `aipla-help` are teacher tools on the
   same mechanism. Declared per-template with `isTutor` in frontmatter. Getting this wrong puts
   a class-management assistant into the 1.1.92 comparison matrix as an arm.

## The map — where everything lives

| Concern | Path |
|---|---|
| Framework model (constructs, behaviours, provenance, dimensions) | `backend/db/models/teaching_framework.py` |
| The seven frameworks | `backend/frameworks/*.yaml` + `loader.py` |
| Framework → tutor instruction (deterministic, no LLM) | `backend/frameworks/instruction.py` |
| Researcher instruction overrides | `backend/db/framework_overrides.py` |
| `Tutor` object | `backend/db/models/tutor.py` |
| Base tutors (one per persona) | `backend/tutors/*.yaml` + `loader.py` |
| Tutor store + variants | `backend/db/tutors.py` |
| **The one join** — "what is teaching this turn?" | `backend/adk/tutor_resolution.py` |
| Framework injection into the live prompt | `backend/adk/tutor_framework.py` |
| M7 migration (rides the deploy seed) | `backend/admin/tutor_migration.py` |
| APIs | `backend/protocols/frameworks_routes.py`, `tutors_routes.py` |
| Teacher UI | `frontend/src/components/teacher/TutorPicker.tsx`, `TutorVariantDialog.tsx` |
| Researcher UI | `frontend/src/app/teacher/research/frameworks/page.tsx` |
| Doc generator | `backend/scripts/generate_tutor_docs.py` (`make tutor-docs`) |
| The literature | `docs/literature/tp-framework/` — **README tracked, PDFs gitignored** |

**Resolution order**, and everything reads through it: activity tutor > **class tutor** >
the activity's pre-tutor fields > class persona > default.

## The four layers, because they are easy to confuse

| Layer | Controls | Count |
|---|---|---|
| `SKILL.md` skill | the agent itself | 8 (4 are tutors) |
| Persona (1.1.12) | name, avatar, TTS voice | 6 |
| `interaction_style` (1.1.20) | **tone** — socratic/concise/rigorous/warm | 4 |
| Teaching framework (1.1.91) | **pedagogy** — moves within a turn | 7 (2 written) |

A **Tutor** bundles the last three. Style and framework are orthogonal and compose: the four
styles remain the low-research option, a framework is the researched layer on top. Where they
conflict at runtime, **pedagogy outranks tone** — decided in `adk/agent.py`, not stumbled into.

## State: shipped vs open

**Shipped and in production as `v0.1.40`:** the `Tutor` object; the store with variants and
lineage; one resolution path; the tutor API; the class-level picker; generated internal +
public docs with a drift guard; ESRU and Authentic Dialogue.

**Shipped on `dev`, released as `v0.1.41` (2026-09-10):** the researcher framework editor and
fork flow (M5, `5ef38383`); the M7 migration of the four student-facing `SKILL.md` tutors
(`935c89a1`); the two-lists fix (`d05500d2`).

> ⚠️ **Correction.** The first draft of this document listed the researcher editor and the M7
> migration as in production at `v0.1.40`. They are not — both commits land **after** that tag,
> which points at `b17b4e1b`. The consequence is not cosmetic: cutting `v0.1.41` ships two
> features and a Firestore migration, not one cosmetic fix. **Read `make deploy-status` for
> what is live; never infer it from the commit list.**

**Open** — see [TUTOR-4 plan](researcher-configurable-tutors-m2-sprint.md), ~4.75–5.25d:

| Gap | Size | Note |
|---|---|---|
| **Teachers cannot author anything** | ~1d | Every route is `assert_researcher`. `Tutor.author_role` exists, unused |
| **Researchers cannot see teacher-made tutors** | ~0.75d | Build WITH the above — neither is worth much alone |
| **Construct editing is text-only** | ~1d | A researcher edits rendered text, breaking the theory trace |
| **No tutor co-pilot** | ~2d | The ask was a co-pilot, not a text box. `critique_tutor` first |
| ~~Five frameworks unwritten~~ | ~~0.5d each~~ | ✅ **Done 2026-09-10** — 5E, CER, POE, Toulmin, Accountable Talk drafted from the parsed PDFs. Awaiting AR/JB sign-off to move `ready_for_review` → `ready` |

## ⚠️ Releasing `v0.1.41` — what it actually carries

Prod sat at `v0.1.40` showing **both** the tutor picker and the old persona panel on the
manage-class page — the confusion reported on 2026-09-10. `d05500d2` fixes it, but it sits on
top of M5 and M7 and a promote tag must be an ancestor of `dev`, so **there is no way to ship
the cosmetic fix alone** short of reverting two features. `v0.1.41` therefore carries:

| Ships | Blast radius |
|---|---|
| `d05500d2` two-lists fix | Visual only, manage-class page |
| `5ef38383` M5 researcher fork | New researcher-only surface; `assert_researcher` on every route |
| `935c89a1` M7 tutor migration | **Writes prod Firestore.** Rides the promote seed job — `cloudbuild.promote.yaml` `seed-platform-skills` → `admin/platform_seed.py` → `sync_tutor_for_template`. It skips any tutor a human has edited |

The passthrough guarantee still holds throughout: a class or activity with no tutor composes
byte-identically to before.

```
git push origin dev                       # confirm it lands, ON ITS OWN
git tag -a v0.1.41 -m "…" && git push origin v0.1.41
git merge-base --is-ancestor v0.1.41 origin/dev && echo on-branch
make promote VERSION=v0.1.41 FROM=test TO=prod        # dry run
make promote VERSION=v0.1.41 FROM=test TO=prod GO=1
```

## CI is red on `dev`, and it is not this work

The `Security audit (deps)` job has been failing on every `dev` run through this sprint —
including `b17b4e1b`, the commit **prod itself was cut from**. Backend, frontend, LOCAL_MODE
safety and sim bridge are green. So "wait for CI green before promoting" is not a gate that is
currently available, and treating the red as a tutor regression will send you hunting for a bug
that is not there. Triage it as its own piece of work via the `aipla-security-checkup` skill;
policy of record is [security-monitoring-pipeline.md](implemented/security-monitoring-pipeline.md).

## Deploy traps found the hard way this week — now in the runbook

- **Never chain the branch push and the tag push.** A rejected branch push still lets the tag
  through, leaving a `v*` tag off-branch. Prod promotes FROM THE TAG, so that is a route to
  shipping unreviewed code. It happened on 2026-09-09.
- **`aipla-prod-sandbox-release` fires on every `v*` tag with NO approval.** "A tag does not
  deploy prod" is true of the app and false of the sandbox.
- **Cloud Build is regional.** Without `--region=europe-north1` you get `Listed 0 items.` and
  exit 0 — indistinguishable from "no builds".
- **`CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo` does not exist on every machine.** The failure reads
  as an auth error and is not; pass `--project` explicitly.

## Judgement calls a new session should not silently reverse

- **Class-level picker, not per-activity.** 1.1.32 Q4; a duplicate per-activity picker was
  problem 4 of the teacher-UX refinement. `ActivityConfig.tutor_id` is the unsurfaced override.
- **The tutor REPLACED the persona picker.** Two lists of six identities was the bug.
- **Skill-bound tutors are excluded from the picker** — research arms, not identity choices.
- **Frameworks are never shown to teachers as bare acronyms.** "Question-and-use cycle (ESRU)",
  mapped in one place (`protocols/tutors_routes._PLAIN_NAME`). There is a test.
- **Placeholder frameworks are never selectable** — a tutor claiming an approach and teaching
  with none is the unfounded claim this work exists to prevent.

## Open questions for humans, not code

1. **Does a teacher's variant need approval before students see it?** Governance, not
   technical. Interacts with [1.1.95](safe-to-publish-vetting.md). **JB/AR.**
2. **M4 has a gate: teachers must be told** researchers can see tutors they create. It is
   their professional work.
3. **The `layer` field vs the design doc's umbrella `parent`** — the literature set describes
   two stacks (TP cycle; conceptual), not a tree. **Confirm with JB before M5 seeds any
   conceptual-layer framework.**
4. **ESRU's four moves vs the corpus README's three-move gloss** — the paper is unambiguous and
   the four are shipped, but **AR should confirm** which reading the programme intends.
5. **Which framework is third?** 5E or CER are the obvious candidates; Authentic Dialogue was
   chosen second because it shares ESRU's IRE contrast and so makes a comparable arm.

## Verification, before you trust any of the above

```bash
cd backend && make lint && make test-fast     # 3413 passing
make check-tutor-docs                          # generated docs match the YAML
make check-auth-dispatcher                     # 5 firebase-only imports, all allowlisted
cd frontend && npm run quality:check
make deploy-status                             # what is ACTUALLY live
```
