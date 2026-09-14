# The catalogue entry

`backend/artefacts/<id>.yaml`. One file per sim, loaded by
`artefacts.loader.load_artefacts()` into `ArtefactMeta`
(`backend/db/models/artefact.py`) and deployed inside the **backend image**.

Without this file the sim does not exist: nothing lists it, no activity may
reference it (`_assert_known_artefact` rejects an unknown id with 400), and
nothing mounts it.

## Full example

```yaml
id: kettle-efficiency
version: v1
displayName: "Elkedel — energi og nyttevirkning"
description: "Virtuel elkedel med kWh-måler, termometer og stopur: eleven vælger effekt og vandmængde, varmer op og registrerer sine egne aflæsninger."
topics:
  - energi
  - effekt
  - nyttevirkning
levels:
  - B
  - C
language: da
# minViewportPx omitted — built single-column-first, audits clean at 390px.
eventVocabulary:
  - open
  - run
  - stop
  - reset
  - reading
  - state-change
tutorBlock: |
  …what the sim is, what its events mean, and the reference values…
status: live
```

## Fields

| Field | Rules | Read by |
|---|---|---|
| `id` | `^[a-z0-9-]+$`, ≤64. **Must match the artefact directory name and the `<id>.` prefix on every event kind** — it is also the `serverId` on the iframe-context wire | everything |
| `version` | `^v[0-9]+$`, default `v1`. With `id`, forms `artefactPath` = `<id>/<version>`, the sandbox path the frame mounts | `GenericArtefactFrame` |
| `displayName` | ≤120. The name a teacher and a student see. Teacher-facing words, not wire words | `SimPicker`, `SimFrameHeader` |
| `description` | ≤500. One sentence, teacher-facing, says what the student does | `SimPicker` card |
| `topics` | ≤12 free strings. Danish curriculum words | picker/search |
| `levels` | any of `A` `B` `C` (stx level) | picker/search |
| `language` | ≤8, default `da`. The sim's default/fallback language | passed through `public()` |
| `eventVocabulary` | ≤40 verbs, **unprefixed** (`run`, not `kettle-efficiency.run`) | documentation + tests; not dispatch |
| `tutorBlock` | ≤2000 chars. **Server-side only** | `adk/teacher_focus.py`, `adk/element_manifest.py` |
| `thumbnail` | optional path/URL; unset → the picker draws a monogram tile | `SimThumbnail` |
| `minViewportPx` | optional, 320–2000. The narrowest width at which the sim is **fully usable** | the student launcher, to warn rather than silently render half a bench |
| `status` | `live` \| `beta` \| `deprecated` | `GET /api/artefacts?status=live` — **`SimPicker` requests `live` only** |

## The three that need judgement

### `tutorBlock` — the only place an answer may live

`ArtefactMeta.public()` returns everything **except** this field, and `public()`
is what the teacher API and the student's `/active` response serialise. So the
tutorBlock reaches the tutor's system prompt and never the browser.

Write it in **English** describing *what the tutor does*, not in the language the
tutor should speak — language comes from `activity.language` via
`compose_teacher_focus`. A tutorBlock saying "svar altid på dansk" re-creates a
bug that was already fixed once.

Three parts that earn their space:

1. **What the sim is** and what the student can control.
2. **What each event means**, so a `reading` becomes "ask what they intend to do
   with it" rather than an opaque kind string.
3. **Reference values, fenced.** The constants the tutor needs in order to mark
   an answer, under an explicit instruction never to state them:

   > REFERENCE, FOR CHECKING ONLY — NEVER STATE THESE VALUES. The kettle
   > delivers 86% of the electrical energy into the water … A correct
   > efficiency therefore lands near 0.86. If the student gets close, probe the
   > reasoning rather than confirming the number.

Keep it artefact-**intrinsic**. The per-activity lesson goal belongs to the
activity; the same sim serves many activities.

### `minViewportPx` — a claim about your CSS

Unset means "works everywhere", and is honest **only** if you built
single-column-first and checked. `verify_sim.mjs` reports overflow at 390px;
run it before deciding.

Setting a number does not hide the activity — it labels it, so a student is told
to open it on a tablet rather than being shown half a circuit. `led-planck`
declares 720 because its bench is laid out at fixed coordinates; `boldkast`,
`kettle-efficiency` and `phase-change` declare none.

### `status` — what "in the library" means

`frontend/src/lib/teacherApi.ts` calls `/api/artefacts?status=live`. A `beta`
artefact deploys, serves, and is invisible to every teacher. Use `beta`
deliberately when you want it on the origin but not in the picker (a review
link, a half-finished port); otherwise `live`.

## Tests

`backend/tests/unit/test_artefact_catalogue.py` covers the whole catalogue, so a
new YAML is checked the moment it exists: it must validate, derive its path,
carry a non-empty `tutorBlock`, and keep giveaway values out of `public()`.

Add a case when your sim asserts something specific — a declared
`minViewportPx`, a deliberate `beta`, a reference value that must stay
server-side.

```bash
cd backend && uv run pytest tests/unit/test_artefact_catalogue.py -q
```

## Deploy note

This file ships in the **backend** image, not the sandbox image. Editing only
the YAML needs the root `dev` build to reach the product; editing only the HTML
needs the sandbox build. Most changes touch both and one push fires both.
