# Where a tutor came from, and what an approach is derived from — provenance and sources

**Status:** **M0 done (M, 2026-10-05) · M1–M3 implemented 2026-10-05, not yet deployed** — M4/M5 open — **1.1.150**. ⚠️ M2 has a deploy-order step and a prod backfill for M; see **Implementation notes** at the end
**Priority:** **P1** for M0–M2 (a researcher could not tell whose tutor was in their own list during a live seminar, and the cause is a labelling defect, not a mystery) · **P2** for M3–M5 (sources on custom approaches, a requested capability with no incident behind it)
**Estimated:** ~3.5–4d phased (M0 identify the record on prod ~0.25h, M only · M1 ownership labelling + create-route collision ~0.5d · M2 `createdBy`/`createdVia`/`createdAt` on three stores + backfill ~1d · M3 sources on custom approaches ~1d · M4 links to the literature corpus ~0.75d · M5 guides + researcher cross-view ~0.25d)
**Scope:** Backend: `db/models/teaching_framework.py`, `db/models/tutor.py`, `db/models/persona.py`, `db/authored_frameworks.py`, `db/tutors.py`, `db/custom_personas.py`, `protocols/frameworks_routes.py`, `protocols/tutors_routes.py`, `protocols/personas_routes.py`, `admin/tutor_migration.py`, `adk/tutor_authoring_tools.py`, a backfill script under `backend/scripts/`. Frontend: `components/teacher/research/CustomApproachPanel.tsx`, `MyTutorsPanel.tsx`, `lib/teacherApi.ts`, `messages/{da,en}/teacher-research.json`. **Not** `backend/frameworks/*.yaml` and **not** the generated tutor docs
**Dependencies:** [1.1.91 researcher-configurable-tutors](researcher-configurable-tutors.md) (shipped; read the [handover](tutors-handover-2026-09-10.md) first); [1.1.110 custom-approaches-and-literature-corpus](custom-approaches-and-literature-corpus.md) (shipped, the store and the corpus this extends); [1.1.135 teacher-authored-tutors](teacher-authored-tutors.md) (shipped, the `canEdit` / visibility model); [1.1.108 content-localisation](content-localisation.md) (all new copy through `useT()`); [1.1.138 no-crash-across-a-deploy](no-crash-across-a-deploy.md) (field additions vs. `extra="forbid"`, see M2). **Un-gated**
**Created:** 2026-10-05
**Source:** Teacher seminar 2026-10-05, [notes-2026-10-05.md](../../../notes-2026-10-05.md) — items "Where has didaktisk tutor come from in asiens account" ("asiens" read as **Aswin's**, per the notes' inferred-terms table) and "When adding new teaching approaches we want to add the sources to help derive the approach."

## Problem Statement

1. **A tutor or approach called "Didaktisk tutor" appeared in Aswin's (researcher) account,
   and nobody in the room could say where it came from.** The platform records an author
   uid on every authored row, but surfaces none of it, and on the researcher's screen it
   actively mislabels other people's work as the researcher's own (Finding F2).
2. **A custom teaching approach cannot carry the literature it is derived from.** The seven
   published frameworks carry vouched `provenance`; a custom approach is, by 1.1.110's
   explicit design, "authored, not drafted from a paper" and has nowhere to record a source.
   Researchers at the seminar asked for exactly that field.

Both are provenance questions — *who made this, by which route, and from what* — and the
answer to the first must be visible in the UI next time rather than reconstructed from
Firestore.

## Findings (verified against code on 2026-10-05; **no prod data read**)

### F1. No code path creates anything named "Didaktisk" — verified

A case-insensitive search for `didakti` / `didactic` across the repo (excluding
`node_modules`) hits only the department name *Institut for Naturfagenes Didaktik* (site
chrome, `frontend/src/lib/ecosystem.ts:58,87`, privacy/terms/credits pages), a Brousseau
comment in the `sekant-intro` sim, and design docs. **Nothing** in `backend/frameworks/`,
`backend/tutors/` (the seven base tutors are `amina`…`sofie`), `backend/skills/templates/`,
`backend/onboarding/`, `frontend/messages/`, or any seed script. 1.1.108 translated UI
copy, not data: no step translates a tutor or approach name. **"Didaktisk tutor" is
therefore a user-typed name held in Firestore** — the name a Danish teacher would give a
tutor or approach.

### F2. A researcher sees every authored tutor and approach labelled as their own — verified

- `GET /api/tutors` reads the catalogue unfiltered for a researcher
  (`backend/protocols/tutors_routes.py:201-210`, `see_all=user.is_researcher`), which is by
  design and is disclosed to teachers ("Private means: hidden from other teachers, but
  visible to the research team", `frontend/messages/en/teacher-research.json:110`).
- `canEdit` is true for a researcher on **every** authored row
  (`tutors_routes.py:150-156`; `db/authored_frameworks.py:162-173`).
- `MyTutorsPanel.tsx:130-131` then splits the list on `canEdit` and renders the editable
  half under the heading **"Dine" / "Yours"** (`:309-313`; `messages/da/teacher-research.json:117`).
- `CustomApproachPanel.tsx:205-211` labels any row with `canEdit && authorRole` as
  **"din" / "yours"**.

So in Aswin's account, a tutor or approach written by *any* teacher — including a private one
made at the seminar that morning — appears under "Dine" with no author shown. `canEdit`
answers "may I edit this", and the UI is reading it as "is this mine". **This is the most
likely origin and needs no other mechanism.**

### F3. Code paths that write a tutor / approach / persona row — verified

| # | Path | Collection | Author recorded | Without the user acting? |
|---|---|---|---|---|
| 1 | `POST /api/research/tutors` (`tutors_routes.py:331-368`), from `MyTutorsPanel.tsx:105-117` | `tutors` | `authorUid` = caller | No |
| 2 | `POST /api/research/tutors/variant` (`tutors_routes.py:372-400` → `db/tutors.py:202-246`), from `TutorVariantDialog.tsx:69` | `tutors` | caller | No |
| 3 | `POST /api/research/frameworks/custom` (`frameworks_routes.py:414-443`), from `CustomApproachPanel.tsx:71` | `authored_frameworks` | caller | No |
| 4 | `POST /api/personas/custom` (`personas_routes.py:141-158` → `db/custom_personas.py:94-120`) | `custom_personas` | caller | No |
| 5 | Deploy seed: `admin/platform_seed` → `admin/tutor_migration.py:62-85` | `tutors` | `"platform-seed"` (`:35`) | **Yes** — but only the four `isTutor` SKILL.md templates, none Danish-named |
| 6 | Visibility toggles (`db/tutors.py:61-74`, `frameworks_routes.py:455-479`) | as above | unchanged | No; does not create |

Paths that **do not** create a tutor or approach, verified: the onboarding demo seed
(`onboarding/demo_seed.py:510-535` creates a class and activities only); activity adopt and
duplicate (`protocols/activity_routes.py:509,530` → `db/activities.py:77` copy the activity,
whose `tutorId` is a reference, not a copy); `scripts/sync_tutor_assignments.py` (writes
only `tutor_framework_assignments`, and refuses `--to prod`); the tutor co-pilot
(`adk/tutor_authoring_tools.py:130-189`: "Nothing here persists"; Apply in
`app/teacher/research/frameworks/page.tsx:152-157` only sets a note). **No path creates a
row in someone else's account without them acting.** The question is therefore *who*
acted, not *what* did.

### F4. Two latent defects that can make a record look like it changed hands — verified

- **`POST /api/research/tutors` has no existence check.** The variant route refuses a taken id
  (`tutors_routes.py:385-386`); the create route does not, and `save_tutor`
  (`db/tutors.py:187-198`) then overwrites with `author_uid = updated_by` (`:193`). The id is
  slugged from the display name in the client (`MyTutorsPanel.tsx:105-111`), so two teachers
  each creating "Didaktisk tutor" yield one row, owned by whoever saved last. A teacher naming
  a tutor "Sofie" would also write an authored row that **shadows the base tutor for every
  class** (`db/tutors.py:111-125`, authored wins over YAML).
- **`save_tutor` reassigns authorship on every write** (`:193`), unlike
  `save_authored_framework` (`authored_frameworks.py:130-131`) and `save_custom_persona`
  (`custom_personas.py:112`), which preserve the original author. No tutor edit route exists
  today, so it is latent, but the next one inherits it.

### F5. What provenance is stored today — verified

| Store | author | created | updated | via |
|---|---|---|---|---|
| `tutors` | `authorUid` (overwritten, F4), `authorRole` | `createdAt` | `updatedAt`, `version` | `lineage` (variant-of) only |
| `authored_frameworks` | `authorUid`, `authorRole` (preserved) | **none** | `updatedBy`, `updatedAt`, `version` | none |
| `custom_personas` | `authorUid` (preserved) | **none** | `updatedBy`, `updatedAt` | none |

Firestore's own document metadata (`create_time`, `update_time`) exists on every row
regardless, which is what M0 and the M2 backfill read.

### F6. Sources: the current data model — verified

- `Provenance` (`teaching_framework.py:102-121`) is a *vouched* citation: `vouchedBy` has no
  default and is a programme member's initials. It is the published frameworks' field, it is
  rendered into `/project/tutors` by `scripts/generate_tutor_docs.py` (reads YAML only, `:418`),
  and `find_source_passages` treats it as the **only** citations a co-pilot may cite
  (`tutor_authoring_tools.py:329-372`).
- `material_refs` (`:230`) are `CurriculumDoc` references — the **student-reachable**
  corpus. Wrong home for literature by construction.
- `find_source_passages` refuses custom approaches outright (`tutor_authoring_tools.py:363`).
- The literature corpus (`db/literature_corpus.py`) has no tool builder and no document
  listing; the ingest names each file `<framework_id>.txt` (`:135-145`) and `query_literature`
  filters on that tag (`:120-125`). It holds the seven frameworks' papers only.
- A custom approach reaches the student prompt as header + `instruction_text` + register only
  (`frameworks/instruction.py:105-110`). `summary`, `material_refs` and `provenance` are not
  rendered, so a new field is invisible to the student **unless someone adds it there**.


## M0 results — prod, read 2026-10-05 evening

**Found.** "Didaktisk Tutor" is `authored_frameworks/custom-didaktisk-tutor` — a **custom
teaching approach**, not a tutor — created **2026-10-03 13:00:42 UTC** by a **pilot teacher**
(a gmail account, not AR), `authorRole: teacher`, `visibility: private`, `version: 1`. It shows
in AR's account because AR is a researcher: F2 is the whole story. No overwrite (F4) — version 1.

**M's requirement, 2026-10-05:** *"we should be labelling who is making the tutor for
researchers."* That is acceptance criterion 1 as written (author role on every row, author
email for researchers, "Yours" only for your own). Make it apply to **custom approaches and
custom personas as well as tutors** — the row that confused AR was an approach.

## Decision

### Q1 — provenance of every authored record

| Option | For | Against |
|---|---|---|
| A. Show existing `authorUid`/`authorRole` only | No schema change | No creation time on two stores; cannot tell seed from human; F4 corrupts the tutor author |
| **B. Add immutable `createdBy`, `createdVia`, `createdAt` to all three stores; fix the labels** | Answers question 1 in the UI; survives edits | One backfill; field additions against `extra="forbid"` need care |
| C. A separate append-only audit collection | Full history | Second source of truth; nothing reads it today |

**Recommend B.** `createdVia ∈ {seed, copilot, ui, adopt, sync}`; `null` on backfilled rows
means "not recorded" and is displayed as such, never guessed (except `authorUid ==
"platform-seed"` ⇒ `seed`, which is certain). `createdBy`, `createdVia`, `createdAt` are
**server-stamped on create and never rewritten** by any save; `createdVia` is server-set
(`seed`/`sync`/`adopt` are never accepted from a client, and the client may send only
`ui` or `copilot`). `adopt` and `sync` are reserved: no path creates a tutor that way today
(F3), and the enum exists so the first one that does has somewhere to say so.

### Q2 — sources on a custom approach

| Option | For | Against |
|---|---|---|
| A. Reuse `provenance` | Already rendered | Conflates "derived from" with "vouched by the programme"; would feed teacher-entered citations into `find_source_passages`' trusted list, defeating 1.1.91's no-invented-citation rule |
| **B. New `sources` field on custom approaches only** | Honest label; never trusted as vouched; isolated from the prompt | A second citation shape to render |
| C. Attach as `material_refs` | Existing UI | Puts literature in the student-reachable curriculum corpus — the "second RAG corpus" footgun |

**Recommend B.** `ApproachSource = {citation: str (1–500, required), url: str|None (https
only), corpusRef: str|None, note: str|None (≤800), addedBy: uid (server), addedAt (server)}`,
max 10, `extra="forbid"`. A YAML framework carrying `sources` fails validation — the seven
keep `provenance`. A source is **metadata**: shown in the authoring panel, in the researcher
cross-view, and on the tutor detail in `MyTutorsPanel`; **never** rendered by
`frameworks/instruction.py`, never returned by any group-token endpoint, never written by a
co-pilot tool. `corpusRef` is selectable by researchers only and names an ingested corpus
file (initially the seven `<framework_id>` tags), resolved by a new researcher-gated
`GET /api/research/literature/documents` in `protocols/` that lists ingested files with their
YAML citation — it reads the manifest, not passages. `find_source_passages` is extended to
accept a custom approach whose sources carry `corpusRef`s, filtering to those tags, still
researcher-gated.

**`/project/tutors`.** It is generated from git YAML and shows only the seven, whose
`provenance` it already renders. Custom approaches are Firestore data and a teacher's
professional work (handover open question 2); publishing them is a consent decision, not a
rendering one. **This doc does not change the generator.** Showing shared custom approaches
publicly is Open Question 3.

## Milestones

| # | What | Size |
|---|---|---|
| **M0** | **M identifies the record on prod** (queries below). Decides whether F4 was involved | ~0.25h |
| M1 | Server sends `isOwn` (`authorUid == viewer.uid`) per row on tutors, approaches, personas; UI groups on `isOwn`, not `canEdit`; non-own rows show "written by a teacher/researcher". Create route 409s on any id that `resolve_tutor` resolves (authored **or** base). `save_tutor` preserves `author_uid` | ~0.5d |
| M2 | `createdBy`/`createdVia`/`createdAt` on `Tutor`, `TeachingFramework` (custom), `Persona`; stamped in the three stores and in `tutor_migration` (`seed`). Backfill script, dry-run default, `--go` to write: `createdAt` from Firestore `create_time`, `createdBy` from `authorUid`, `createdVia` = `seed` for `platform-seed` else `null`. UI line: "Created by {role} via {channel} on {date}"; researchers also see the author's email (Open Question 1) | ~1d |
| M3 | `sources` on custom approaches: model, `CustomApproachBody`, the three routes, `CustomApproachPanel` editor (citation, optional URL, note), display on rows and tutor detail. `_strip_provenance` also strips `sources` from any proposal | ~1d |
| M4 | `GET /api/research/literature/documents` (researcher-only); `corpusRef` picker for researchers; `find_source_passages` accepts a custom approach with corpus refs | ~0.75d |
| M5 | Researcher guide note (`guide-maintenance`), cross-view column "sources", release note | ~0.25d |

**M2 deploy order.** `Tutor`, `TeachingFramework` and `Persona` are `extra="forbid"`, and the
stores skip a row that fails validation (`authored_frameworks.py:69-79`). An old revision
reading a row written by a new one would silently drop it from every list — and from the
tutor resolution path. Either add the fields to the models in one release and start writing
them in the next, or add them to `_ROW_ONLY` handling on read for the transition. Do not add a
field to a row without a model that accepts it already serving all traffic.

### M0 — queries for M (read-only; not run by this doc)

```bash
# 1. Scan the three stores for the name (collections are small; Firestore has no substring query).
cd backend && uv run python - <<'EOF'
from google.cloud import firestore
db = firestore.Client(project="aipla-prod-2026")
for coll, name_field in [("tutors", "displayName"), ("authored_frameworks", "label"), ("custom_personas", "name")]:
    for doc in db.collection(coll).stream():
        d = doc.to_dict() or {}
        if "didakt" in f"{doc.id} {d.get(name_field, '')}".lower():
            print(coll, doc.id, {k: d.get(k) for k in (
                name_field, "authorUid", "authorRole", "updatedBy", "visibility", "version",
                "createdAt", "updatedAt", "lineage", "frameworkId", "personaId")},
                "fs_create_time=", doc.create_time, "fs_update_time=", doc.update_time)
EOF

# 2. Resolve each authorUid / updatedBy to a person (Admin SDK, read-only).
cd backend && uv run python -c "import firebase_admin; from firebase_admin import auth; \
firebase_admin.initialize_app(options={'projectId':'aipla-prod-2026'}); \
u=auth.get_user('<authorUid>'); print(u.email, u.display_name, u.custom_claims)"

# 3. The request that created it (log lines: tutors_routes.py:367, frameworks_routes.py:442,
#    custom_personas.py:120). Backend is a sidecar in aipla-v01-frontend; payload is textPayload.
gcloud logging read --project=aipla-prod-2026 --freshness=30d --format='value(timestamp,textPayload)' \
  'resource.type="cloud_run_revision" AND (textPayload:"tutor authored: id=didakt" OR
   textPayload:"custom approach created: custom-didakt" OR textPayload:"custom_personas: saved persona-didakt")'
```

Read the result against F2/F4: if `authorUid` is not Aswin's uid, F2 is the whole story.
If `version > 1` on a `tutors` row, or two "tutor authored" log lines carry the same id with
different uids, F4 overwrote someone's tutor — tell that teacher. If `authorUid` **is**
Aswin's, check `fs_create_time` against the seminar and ask whether a shared login was used.

## Acceptance criteria

1. A researcher's "Yours" / "Dine" lists contain only rows whose `authorUid` is theirs; every
   other row names its author's role, and (researchers only) the author's email.
2. Every tutor, custom approach and custom persona created after M2 carries non-null
   `createdBy`, `createdVia`, `createdAt`, and no subsequent save changes them.
3. `POST /api/research/tutors` with an id that resolves (authored or base) returns 409 and
   writes nothing.
4. A custom approach can hold up to 10 sources; a published framework cannot hold any.
5. **No source text, URL or corpus ref appears in any composed student instruction, any
   student-session tool output, or any group-token endpoint response.**
6. `make check-literature-isolation`, `make check-tutor-docs`, `make check-client-api`,
   `make check-i18n`, `make check-auth-dispatcher` all pass; generated tutor docs unchanged.

## Tests

- `backend/tests/api_tests/test_framework_routes.py`: **`test_approach_sources_never_reach_the_student_turn`** —
  create a custom approach with `instructionText` "Ask first." and a source whose citation,
  URL and note carry unique sentinels; assign it to a tutor on a class (pattern of
  `test_class_tutor_reaches_the_student.py`); compose the full student instruction through
  the real agent path and assert "Ask first." is present (it is wired) and **no sentinel is**;
  also call the student-facing endpoints with a minted group token and assert no sentinel in
  any body. A test that only checks `resolve_framework_instruction` is insufficient: it
  passes even if a callback later appends sources.
- `test_sources_rejected_on_a_published_framework`; `test_source_fields_server_stamped`
  (`addedBy` from the token, not the body).
- `test_tutor_authoring_tools.py`: a `propose_approach` call naming sources yields a proposal
  with none.
- `test_tutors_routes.py`: `test_create_refuses_a_taken_id` (authored and base, e.g. `sofie`);
  `test_save_preserves_original_author`; `test_researcher_sees_others_tutors_as_not_own`
  (`isOwn` false, `canEdit` true).
- Provenance: create via each route and via `sync_tutor_for_template` → expected
  `createdVia`; edit → `created*` unchanged. Backfill script: dry-run writes nothing; `--go`
  never overwrites a non-null `createdVia`.
- Frontend: `MyTutorsPanel.test.tsx` and `CustomApproachPanel.test.tsx` — a researcher fixture
  with another author's row renders it outside "Yours" with the author role; sources render
  and round-trip through the editor. `useT()` keys exist in both locales.

## Handover to a cloud agent

**Read first:** this repo's `CLAUDE.md` (tutor-layer section and the footgun table, rows
"A second RAG corpus reachable from the wrong audience" and "A whole stack ships with the
control unmounted"); [tutors-handover-2026-09-10.md](tutors-handover-2026-09-10.md);
[custom-approaches-and-literature-corpus.md](custom-approaches-and-literature-corpus.md).

**Files:** as in **Scope**. New: `backend/scripts/backfill_authored_provenance.py` plus a
`make` target (Automation Principle), and a literature listing route in
`backend/protocols/frameworks_routes.py` (not under `backend/adk/`).

**Commands:**

```bash
cd backend && make lint && make test-fast
make check-literature-isolation     # the literature corpus stays researcher-only
make tutor-docs && make check-tutor-docs   # must produce NO diff: YAML is untouched
make check-client-api               # every new teacherApi export needs a call site
make check-i18n && make check-auth-dispatcher && make audit-trust-cards
(cd frontend && npm run quality:check) && make test-frontend-ci-node
```

**Do not:**
- hand-edit `docs/design/aipla/tutors/*.md` or `frontend/content/project/tutors/*.md`;
- put sources in `provenance`, or let any teacher-entered citation reach
  `find_source_passages`' `citations` list;
- render `sources` in `frameworks/instruction.py`, `adk/tutor_framework.py` or any callback,
  or import `db.literature_corpus` from the agent path without the researcher gate;
- let a model write a source, ever (1.1.91's hard requirement);
- accept `createdBy`, `createdAt`, `addedBy` or a server-only `createdVia` from a request body;
- add model fields and write them in the same release without the M2 deploy-order step;
- read or write prod data; the backfill runs on dev, then test, and on prod only by M;
- open a PR — commit to `dev` (CLAUDE.md Git Policy).

## Open questions for M

1. **May researchers see the author's email**, or only role plus a stable pseudonym? Teachers
   are told researchers see private work; they are not told researchers see their identity.
2. **Should a teacher be told when a researcher edits their approach or tutor?** Researchers may
   edit anyone's (`may_edit`), and with F2 fixed that becomes visible for the first time.
3. **Should shared custom approaches, with their sources, appear on `/project/tutors`?** It needs
   an explicit per-approach "publish" consent and a non-generated section; out of scope here.
4. **May teachers attach URLs to paywalled papers**, and should researchers be able to request
   that a teacher-cited paper be ingested into the literature corpus (each ingest is a copy on
   a cloud service, approved per paper on 2026-09-11)?
5. If M0 shows F4 overwrote a teacher's tutor at the seminar, **restore it** (the earlier row is
   gone; only the log line remains) or tell the teacher and let them re-create it?

## Implementation notes — 2026-10-05

**Open question 1 is answered by M's requirement** ("labelling who is making the tutor for
researchers"): researchers see the author's **email**; teachers never receive an
`authorEmail` key at all. Open question 5 is moot — M0 found version 1, no overwrite.

### What shipped (M1–M3)

| | Where |
|---|---|
| `isOwn` per row, beside `canEdit`, on tutors, custom approaches **and custom personas**; `authorEmail` for researchers only (Firebase lookup off the event loop) | `protocols/authorship.py`, `auth/owner_labels.resolve_owner_emails`, the three route files |
| `isBuiltIn` on tutors — a YAML base or a `platform-seed` row reads "Built in", not "Made by a researcher" (the model's `authorRole` default) | `protocols/tutors_routes._serialize` |
| One `AuthorLine` on every row of all three panels: who, email (researchers), "created via {channel} on {date}", or "not recorded". `MyTutorsPanel` groups "Yours" on `isOwn` | `frontend/src/components/teacher/research/AuthorLine.tsx` |
| `POST /api/research/tutors` 409s on any id `resolve_tutor` resolves (authored **or** base, any visibility); the panel says "name taken" and keeps the draft | `tutors_routes.create_tutor_route` |
| `save_tutor` preserves `author_uid`/`author_role`; who last wrote it is the new `updatedBy`. The deploy seed now checks both, so it still never reverts a human edit of a seeded row | `db/tutors.py`, `admin/tutor_migration.py` |
| `createdBy`/`createdVia`/`createdAt` on `Tutor`, `TeachingFramework`, `Persona` (+ `Persona.authorRole`), stamped by the store on create, carried over untouched on every save and visibility change. A body may claim only `ui`/`copilot` (422 otherwise); persona bodies are `extra="forbid"` | `db/models/authorship.py`, the three stores |
| `sources` on custom approaches: `ApproachSource` (≤10, https-only URL, `extra="forbid"`), model-validated to `layer=custom` **and** `source=firestore`. `addedBy`/`addedAt` stamped from the token and preserved per citation across re-saves. An edit body without `sources` keeps them (no full-overwrite wipe) | `teaching_framework.py`, `authored_frameworks.stamp_sources`, `frameworks_routes._sources_for_save` |
| `corpusRef`: researcher-only, must name one of the seven ingested tags; a teacher may carry back a ref a researcher set on the same citation but not add or change one (403) | same |
| Sources editor + display on `CustomApproachPanel`; "Its approach draws on: …" on the tutor row in `MyTutorsPanel` (via `/api/tutors`, teacher-gated) | panels |
| `propose_approach` returns `sources: []`; it declares no parameter a source could travel in | `adk/tutor_authoring_tools.py` |

**Isolation, verified by test:** `test_approach_sources_never_reach_the_student_turn` builds the
student agent with `create_agent` for a class whose tutor teaches with the approach, asserts
"Ask first." is in the composed instruction and no citation/URL/note sentinel is, then sends a
REAL minted group token to the activity-config, tutor, persona and framework routes and finds
no sentinel in any body. `frameworks/instruction.py` was not touched.

### ⚠️ Deploy order (M2) — read before tagging

The model fields and the writes are in **separate commits** on purpose. `Tutor`,
`TeachingFramework` and `Persona` are `extra="forbid"`, and an older revision silently drops
a row it cannot validate — from every list and from tutor resolution. So:

1. Release the commit **`feat(1.1.150): models accept provenance + sources`** on its own and
   let it serve all traffic on prod (`make deploy-status`). It changes no behaviour.
2. Then release the rest. A rollback from step 2 to step 1 is safe; a rollback to anything
   before step 1 is not, once any new row exists.

### Backfill — for M, after step 2 is serving

Never run against any project during implementation. Dev, then test, then prod:

```bash
make backfill-authored-provenance ENV=dev            # dry run: prints each row it would touch
make backfill-authored-provenance ENV=dev GO=1
make backfill-authored-provenance ENV=test           # then GO=1
make backfill-authored-provenance ENV=prod           # dry run first — M only
make backfill-authored-provenance ENV=prod GO=1
```

Writes only missing/null fields with a merge: `createdAt` ← Firestore `create_time`,
`createdBy` ← `authorUid`, `createdVia` ← `seed` for `platform-seed` rows only. Human rows keep
`createdVia` unset ("not recorded"). Re-running is a no-op. The `custom-didaktisk-tutor` row
will get `createdBy` = the pilot teacher and `createdAt` 2026-10-03 13:00:42 UTC.

### Not done, and why

- **M4** (`GET /api/research/literature/documents`, the researcher `corpusRef` picker,
  `find_source_passages` over a custom approach's refs) — not in this pass. The model and the
  route already accept and gate `corpusRef`, so M4 is UI + the listing route + the tool
  extension, with no schema change.
- **M5** (researcher guide note, cross-view "sources" column, release note) — not in this pass.
- **Gated on M:** open questions 2 (tell a teacher when a researcher edits their work),
  3 (publish shared custom approaches on `/project/tutors` — the generator is unchanged),
  4 (paywalled URLs; ingesting teacher-cited papers). Nothing here pre-empts them: URLs are
  allowed for teachers today, as the design specified.
- `createdVia: "copilot"` is accepted from the client but no client sends it yet — the tutor
  co-pilot's Apply only sets a note (F3). The value is there for the first path that does.
