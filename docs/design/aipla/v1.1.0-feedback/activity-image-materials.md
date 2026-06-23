# Activity image materials — images the tutor can actually see

**Status:** **M0–M3 SHIPPED to dev (code) 2026-06-23** — sprint IMG-MAT (`54a832d`→`bc28052`). A teacher attaches an **image** (diagram/graph/photographed worksheet) to an activity and the **tutor sees the pixels** during the student conversation — not OCR'd text, the actual image as multimodal context. Backend 2125 + the new 44 tests (9 model/slot + 7 endpoint + 9 callbacks + 13 FE + 6 frontend image) green; `make lint` + `npm run quality:check` (incl. build) green. **Pending: a dev deploy + a real browser/E2E pass** (teacher attaches → student session carries the image Part). **M4 (student also sees the image) is optional/post-pilot.** (**P1** — additive; deepens the [1.1.25 Materials picker](curriculum-library.md) + the [1.1.41 resource](teacher-sim-resources.md) axis.)
**Last Updated:** 2026-06-23
**Priority:** **P1.** Resolves the gap surfaced 2026-06-23: the activity "add document" component (`MaterialsSection`, 1.1.25 M4) only accepts text-extractable documents that feed the **RAG/text** pipeline. A physics teacher's reference material is frequently a **diagram or graph** whose meaning is the image, not its words — the tutor needs to *look at* it, the way a student-uploaded image already works (1.1.7).
**Estimated:** ~3–4d across M0–M3 (M4 student-display is optional/post-pilot).
**Scope:** Fullstack — `MaterialRef` discriminator + image fields (`backend/db/models/activity_config.py` + `frontend/src/lib/teacherApi.ts`); an **activity-keyed artifact slot** helper over the existing ADK `ArtifactService` (`backend/adk/session.py` store); a teacher-only upload endpoint; an image **loader** (`before_agent_callback`) + image **injector** (`before_model_callback`) twinned on the shipped document pipeline (`backend/adk/callbacks/`); the agent wiring (`backend/adk/agent.py`); the `MaterialsSection` upload + chip UI.
**Dependencies:** [student-multimodal-upload.md](student-multimodal-upload.md) (1.1.7 — the **proven** "model sees an image" path: `Part.from_bytes(mime_type="image/…")` in `llm_request.contents`); [curriculum-library.md](curriculum-library.md) (1.1.25 — `MaterialRef`, `MaterialsSection`, `resolve_active_config` scoping); [teacher-sim-resources.md](teacher-sim-resources.md) (1.1.41 — the "resource attached to an activity" pattern this mirrors); the multi-doc context pipeline (`docs/design/v6.1.0/multi-doc-context-fix.md` — the loader/injector this twins); ADR-001 (anonymous-group student auth) + ADR-008 (Gemini multimodal). **Human gate:** JB on image-retention posture for **teacher-supplied** material (lower-stakes than student uploads — teacher's own reference content, no person-in-frame concern — but record it).
**Source:** 2026-06-23 — M: *"the image must be stored as an artifact the AI can recall and use in the conversation."* (Explicitly **not** OCR-to-text: the model must see the picture.)

> **Read this against the pipeline it twins.** The shipped **document pipeline** ([`adk/callbacks/document.py`](../../../../backend/adk/callbacks/document.py)) loads attached docs into **session artifacts** (`doc:{id}.json`, `application/json`) on the first turn and the injector inlines them as **text** Parts. This doc does the same dance for **images** — the only genuinely new line is that the injector inlines an **image** Part (`Part.from_bytes`), not a text one. Everything else (idempotent loader, orphan recovery, per-turn re-inject, the budget gate seeing the content) is the document pattern, reused.

## Why this exists — the crux

The activity "add document" component (`MaterialsSection`) sits on **one** pipeline: a teacher uploads a file, it is **text-extracted** (AILANG Parse for Office formats, Gemini OCR for PDFs) and pushed into the **Vertex RAG corpus** ([`curriculum_routes.py`](../../../../backend/protocols/curriculum_routes.py)). The tutor reaches it via a **retrieval tool** scoped to the activity's cited docs ([`build_curriculum_retrieval_tool`](../../../../backend/adk/curriculum_retrieval.py)). That pipeline is **right for text** and **wrong for an image**: OCR'ing a free-body diagram or a v–t graph throws away exactly the thing the tutor needs to discuss. The teacher's instinct — "attach this diagram so the bot can see it" — has no home.

Meanwhile AIPLA **already** has the mechanism that makes a model see an image: the 1.1.7 student multimodal upload. A student's photo rides `UserMessage.content` as an `ImageInputContent`, `ag_ui_adk` turns it into an ADK `Part.from_bytes(mime_type="image/…")`, and it's replayed from session history every turn ([the comment at `agent.py:464`](../../../../backend/adk/agent.py) records exactly this). The model genuinely *sees* it.

The gap is that 1.1.7 only fires for an image the **student** uploads **in the moment**. An activity's reference image is authored by the **teacher**, **ahead of time**, and must appear for **every** student who runs the activity. So we need two things the student path doesn't have:

1. a **durable home** for the bytes, keyed to the **activity** (not a chat session, not a single user); and
2. a way to get those bytes **into each student's session** as the same kind of image Part — at session start, recalled from the store.

That is the whole feature.

## Where the artifact store is, and how it's keyed (the load-bearing facts)

The ADK artifact store is configured in [`adk/session.py:295`](../../../../backend/adk/session.py) — `get_artifact_service()`, a **process-level singleton**:

- **prod:** `GcsArtifactService(bucket_name=$ADK_ARTIFACT_BUCKET)` → `gs://$ADK_ARTIFACT_BUCKET`
- **local dev:** `InMemoryArtifactService()`

Its docstring is the enabling fact: the singleton exists *"so the upload endpoint and ADK runner share the same InMemoryArtifactService in local dev."* A save from an HTTP handler and a load from inside the agent run hit the **same** store by design — which is the exact shape this feature needs.

**Keying** (from the ADK `GcsArtifactService` blob-name scheme):

- **session-scoped:** `{app_name}/{user_id}/{session_id}/{filename}/{version}`
- **user-namespaced** (filename starts with `user:`): `{app_name}/{user_id}/user/{filename}/{version}` (cross-session).

`save_artifact(*, app_name, user_id, filename, artifact, session_id=None)` auto-versions; `load_artifact(...)` returns a `types.Part` rebuilt via `Part.from_bytes(data, mime_type=blob.content_type)`. **The store is MIME-agnostic — images are first-class**: it persists `inline_data.data` + `inline_data.mime_type` as the blob's content-type and reload hands back a ready-to-inline image Part. (What is text-only is the *document injector's decode logic* — `.decode("utf-8")` — not the store.)

**An activity is neither a session nor a user**, so we give it a deterministic home by mapping it onto the `(user_id, session_id)` axes we control:

```
durable activity slot:
  app_name   = AIPLA_ARTIFACT_APP   (one canonical constant — see "app_name", below)
  user_id    = <teacher_uid>        (the activity's owner)
  session_id = <activity_id>        (the activity is the "session" dimension)
  filename   = activity-image:{material_id}.{ext}
→ blob: {AIPLA_ARTIFACT_APP}/{teacher_uid}/{activity_id}/activity-image:{material_id}.{ext}/0
```

Both `teacher_uid` and `activity_id` are recoverable at **student** session-time: `resolve_active_config(skill_id, group_tags)` already reads the activity config keyed `(teacher_uid, class_id, activity_id)`, and `skill_id == activity_id`. So a student-side callback can reconstruct the exact durable key, `load_artifact` the bytes, and copy them into the student's own session.

### app_name
The runner's `app_name` is derived by ADK from `agents_dir` ([`fast_api_app.py:197`](../../../../backend/fast_api_app.py)) — there's the known agents_dir-vs-APP_NAME quirk. We sidestep it: the **durable activity slot** uses **one canonical constant** (`AIPLA_ARTIFACT_APP`) for *both* the teacher-upload write and the student-side read, so they always agree regardless of the runner's app_name. The **copy into the student session** uses `callback_context.save_artifact` / `load_artifact`, which fill the runner's app_name automatically and consistently with each other. The two namespaces never need to match each other — only write-app == read-app within the durable slot, which we control.

## The shape (mirrors `document_ids` end to end)

```
TEACHER (build time)              DURABLE STORE                 STUDENT (session start)            TUTOR (every turn)
─────────────────────            ──────────────                ───────────────────────           ──────────────────
MaterialsSection upload   ──▶  save_artifact(                  image loader (before_agent):       image injector
  POST /api/activity-images       app=AIPLA_ARTIFACT_APP,        resolve_active_config →            (before_model):
  (png/jpg/webp/gif)              user=teacher_uid,              image MaterialRefs →                load_artifact(session) →
        │                          session=activity_id,           load_artifact(durable) →            Part.from_bytes(image) →
        ▼                          filename=activity-image:…)     callback_context.save_artifact      contents.insert(-1, part)
  MaterialRef{kind:"image",                                       (→ student session scope)          + naming preamble
    materialId, mimeType,                                          idempotent (app:images_loaded)
    alt, studentVisible}                                                  │
  saved on ActivityConfig                                                 ▼
                                                            normal session artifact —
                                                            visible in ADK web UI / eval
```

1. **Teacher uploads image** → `POST /api/activity-images` validates type+size, `save_artifact`s into the **durable activity slot**, returns an image `MaterialRef`. The frontend adds it to `ActivityConfig.materials` (the full-overwrite save the builder already does).
2. **Student starts a session** → an idempotent `before_agent_callback` (`make_activity_image_loader`, twin of `make_document_loader`) resolves the activity's image materials, `load_artifact`s each from the durable slot, and `save_artifact`s it into **this student's session** scope. Tracked in `app:activity_images_loaded` so it loads once and self-heals orphans, exactly like the doc loader.
3. **Recall** → a `before_model_callback` (`make_activity_image_injector`, twin of `make_document_injector`) loads each session image artifact and inserts it into `llm_request.contents` as an **image** Part, preceded by a one-line text Part naming it ("Reference image for this activity: ‹alt›"). Same per-turn discipline as the doc injector (only the first model call of a turn; skip mid-turn tool round-trips).

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Adds image bytes to the prompt on turns where an activity has reference images — a real but bounded token cost (1–3 small images). No new network hop on the latency path; the loader runs in the existing before-agent chain. Neutral. |
| 2 | EARNED TRUST | +1 | The tutor reasons over the **teacher's actual reference image**, not a lossy OCR of it — answers about "the graph" are grounded in the graph. Teacher-authored, human-provenance content. |
| 3 | SKILLS, NOT FEATURES | +1 | An image becomes a **first-class activity resource** a teacher composes in — the same "resource attached to an activity" model as sims (1.1.41) and cited docs (1.1.25), not a bespoke feature. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Reuses the model's **native** multimodal capability (ADR-008) rather than bolting on an OCR pre-pass; the image reaches the model as a native Part, the way the model is built to consume it. |
| 5 | GRACEFUL DEGRADATION | +1 | A missing/de-referenced image artifact → the loader logs and skips, the activity still runs (chat + text materials + elements). Orphan recovery retries next turn (inherited from the doc loader). Local dev with no `ADK_ARTIFACT_BUCKET` uses the in-memory store and still works in-process. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Uses the **ADK ArtifactService** as the store (no parallel GCS path) and the **same** multimodal Part shape AG-UI/`ag_ui_adk` already produce for 1.1.7. The loader/injector reuse the shipped document-pipeline pattern. No new protocol. |
| 7 | API FIRST | +1 | `POST /api/activity-images` (+ `DELETE`) is a clean teacher-auth contract; the builder UI and a future `aiplatform activity add-image` CLI consume the same endpoint. `MaterialRef` is a typed, versioned wire shape. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Because step 2 **copies into the student session**, the image is a normal session artifact — it shows in the ADK web UI's artifact list, in `adk eval`, and the injector logs counts per turn (twin of the doc injector's logging). Which activities carry images is queryable from `ActivityConfig.materials`. |
| 9 | SECURE BY CONSTRUCTION | +1 | Upload is **teacher-only** (deny-by-default; student `group_id` → 403, same guard as curriculum ingest). Bytes never become a Firestore document path (the empty-string-key student trap, CLAUDE.md). Type allowlist + size cap server-side. Student-visibility is **opt-in** (`studentVisible=false` default), mirroring cited docs. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | All storage, keying, recall, and injection live backend; the frontend uploads a file and renders a thumbnail chip. The tutor-facing wiring is invisible to the client. |
| 11 | USABLE BY DESIGN | +1 | A teacher attaches a diagram the way they already attach a document — same `MaterialsSection`, one upload affordance, image chips with the existing visibility toggle. Designed empty/loading/error states reuse the section's patterns. |
| | **Net Score** | **+9** | Threshold ≥ +4. One neutral (INSTANT FEEL, the token cost) honestly scored; no −1s. |

## Design

### 1. `MaterialRef` gains an image discriminator

`MaterialRef` today is curriculum-only ([`activity_config.py:35`](../../../../backend/db/models/activity_config.py)). Add a `kind` discriminator and the image fields; `doc_id` becomes optional (only curriculum materials carry one). Backward-compatible: existing rows have no `kind` → default `"curriculum"`.

```python
# backend/db/models/activity_config.py
class MaterialRef(BaseModel):
    """A resource cited for this activity.

    kind="curriculum": a CurriculumDoc in the RAG library (doc_id required;
      the tutor reaches it via build_curriculum_retrieval_tool).
    kind="image": a teacher-attached image the tutor SEES multimodally
      (material_id + mime_type; bytes live in the activity artifact slot,
      injected into the student session at session start).
    """
    kind: Literal["curriculum", "image"] = "curriculum"
    # curriculum
    doc_id: str = Field(default="", alias="docId", max_length=200)
    origin: str = Field(default="", alias="origin", max_length=200)
    # image
    material_id: str = Field(default="", alias="materialId", max_length=64)
    mime_type: str = Field(default="", alias="mimeType", max_length=40)
    alt: str = Field(default="", alias="alt", max_length=300)
    # both
    student_visible: bool = Field(default=False, alias="studentVisible")

    @model_validator(mode="after")
    def _require_id_for_kind(self) -> "MaterialRef":
        if self.kind == "curriculum" and not self.doc_id:
            raise ValueError("curriculum material requires docId")
        if self.kind == "image" and not self.material_id:
            raise ValueError("image material requires materialId")
        return self
```

`build_curriculum_retrieval_tool` / `build_curriculum_grounding_preamble` filter to `kind=="curriculum"` (images are not RAG docs). The frontend `MaterialRef` type ([`teacherApi.ts`](../../../../frontend/src/lib/teacherApi.ts)) gains the mirror fields.

### 2. Activity-keyed artifact slot helper

A thin module over the shared store — the only place that knows the durable key scheme:

```python
# backend/adk/activity_images.py
AIPLA_ARTIFACT_APP = "aipla"   # canonical app_name for the durable activity slot

def _slot_filename(material_id: str, ext: str) -> str:
    return f"activity-image:{material_id}.{ext}"

async def save_activity_image(*, teacher_uid: str, activity_id: str,
                              material_id: str, data: bytes, mime_type: str) -> None:
    part = Part.from_bytes(data=data, mime_type=mime_type)
    await get_artifact_service().save_artifact(
        app_name=AIPLA_ARTIFACT_APP, user_id=teacher_uid, session_id=activity_id,
        filename=_slot_filename(material_id, _ext_for(mime_type)), artifact=part,
    )

async def load_activity_image(*, teacher_uid: str, activity_id: str,
                              material_id: str, mime_type: str) -> Part | None:
    return await get_artifact_service().load_artifact(
        app_name=AIPLA_ARTIFACT_APP, user_id=teacher_uid, session_id=activity_id,
        filename=_slot_filename(material_id, _ext_for(mime_type)),
    )
```

### 3. Upload endpoint

```
POST /api/activity-images   (teacher-only; multipart: file, activityId, alt?)
  → validate ext/mime ∈ {png,jpg,jpeg,webp,gif}, size ≤ IMAGE_MAX_BYTES (~5 MB)
  → material_id = uuid4(); save_activity_image(teacher_uid, activityId, material_id, bytes, mime)
  → 201 { materialRef: {kind:"image", materialId, mimeType, alt, studentVisible:false} }
DELETE /api/activity-images/{activityId}/{materialId}   (teacher-only; deletes the slot)
```

Deny-by-default (`group_id` → 403, same as curriculum ingest). The endpoint does **not** write the `MaterialRef` to the `ActivityConfig` — the builder does that in its existing full-overwrite save (so create/edit stay one save path; [the activity-config full-overwrite note](../../../../CLAUDE.md) — the builder sends the complete `materials` payload).

### 4. Image loader (`before_agent_callback`)

`make_activity_image_loader()` — twin of `make_document_loader`:

```
on each turn (idempotent):
  cfg = resolve_active_config(skill_id, group_tags)        # teacher_uid + activity_id + materials
  images = [m for m in cfg.materials if m.kind == "image"]
  loaded = state["app:activity_images_loaded"]             # ids already copied into THIS session
  for m in images not in loaded (with orphan-probe recovery):
     part = load_activity_image(teacher_uid, activity_id, m.material_id, m.mime_type)  # durable slot
     callback_context.save_artifact(filename=f"activity-image:{m.material_id}", artifact=part)  # session
     loaded.append(m.material_id)
```

Wired in `_composed_before_agent` right after `_document_loader` ([agent.py:414](../../../../backend/adk/agent.py)). Failures are per-image and non-fatal (logged), inherited from the doc-loader contract.

### 5. Image injector (`before_model_callback`)

`make_activity_image_injector()` — twin of `make_document_injector`, but inlines an **image** Part:

```python
for material_id in state["app:activity_images_loaded"]:
    art = await callback_context.load_artifact(filename=f"activity-image:{material_id}")
    if not art or not art.inline_data:   # orphan → loader retries next turn
        continue
    label = Content(role="user", parts=[Part.from_text(
        text=f"[Reference image for this activity: {alt or material_id} — attached by the teacher]")])
    image = Content(role="user", parts=[art])   # art is already a Part.from_bytes(image/…)
    contents.insert(-1, label)
    contents.insert(-1, image)
```

Wired in `_composed_before_model` right after `_document_injector` ([agent.py:463](../../../../backend/adk/agent.py)) — so the budget gate (which runs after) sees the image content in its projection, same as it does for docs and for 1.1.7 student images. Per-turn re-inject (the request is rebuilt from session events each turn; we don't persist injected content into history, matching the doc injector's rationale).

### 6. Frontend — `MaterialsSection`

The shipped section ([`MaterialsSection.tsx`](../../../../frontend/src/components/teacher/MaterialsSection.tsx)) gains an **image upload** affordance distinct from the curriculum upload:

- `accept` for the image input = `.png,.jpg,.jpeg,.webp,.gif`; routes to `POST /api/activity-images` via **`fetchWithTeacherAuth`** (teacher token — the recurring anon-group corner, CLAUDE.md).
- Image materials render as **thumbnail chips** (vs the curriculum doc chips), with the same `studentVisible` eye-toggle and a remove (which calls `DELETE` + drops the `MaterialRef`).
- `useActivityBuilder` already threads `materials` through `elementPayload()`; image `MaterialRef`s ride the same array — no builder-state change beyond the chip rendering.

## API changes

| Endpoint | Method | Description | Auth |
|---|---|---|---|
| `/api/activity-images` | POST | Upload an image into the activity's artifact slot; returns an image `MaterialRef` | teacher |
| `/api/activity-images/{activityId}/{materialId}` | DELETE | Remove an image from the slot | teacher |
| `/api/activity-configs` (+ `/active`) | POST/PATCH/GET | `materials[]` now carries `kind:"image"` refs (full-overwrite, unchanged shape otherwise) | teacher / student |

CLI parity (follow-up, not gating): `aiplatform activity add-image <activityId> <file>`.

## Migration

- **Additive Firestore field** — `MaterialRef.kind` defaults to `"curriculum"`; existing `materials` rows deserialize unchanged (no `kind` → curriculum). No backfill.
- **No change to the curriculum/RAG path** — `build_curriculum_retrieval_tool` simply filters to `kind=="curriculum"`.
- **Rollback** — drop the image upload affordance (frontend) and the two callbacks from the agent chain; `kind:"image"` refs become inert (loader is the only consumer). No data loss; slots are orphaned, not corrupting.
- **GCP side effect** — uses the **existing** `$ADK_ARTIFACT_BUCKET` (no new bucket). New blob prefix `aipla/{teacher_uid}/{activity_id}/activity-image:*`. Record in [docs/ops/gcp-side-effects.md](../../../ops/gcp-side-effects.md) (no new IAM — the runtime SA already reads/writes this bucket for ADK artifacts).

## Security

- **Teacher-only upload** — `group_id` present → 403, the deny-by-default guard the curriculum routes already use. Students never reach the upload/delete endpoints.
- **No empty-string Firestore keys** — the durable slot is keyed by `teacher_uid`/`activity_id`/`material_id`, never by `User.email`/`domain` (the anonymous-group trap, CLAUDE.md). Bytes live in the artifact bucket, not Firestore.
- **Type + size gate** — server-side allowlist (`png/jpg/jpeg/webp/gif`) + `IMAGE_MAX_BYTES` cap; reject everything else with 422.
- **Student visibility is opt-in** — `studentVisible=false` by default; the tutor always sees the image (it's the activity's reference material), but the student sees it in their workspace only if the teacher flips the toggle (mirrors cited-doc behaviour; M4).
- **No person-in-frame concern** — unlike 1.1.7 student uploads, this is the **teacher's own reference content**, so the 1.1.21 guardrail doesn't apply. Retention posture is JB's call (gate), but the stakes are lower than student-captured images.

## Milestone phasing

| MS | Deliverable | Est | Gate | Lands |
|---|---|---|---|---|
| **M0** | **Data model + storage primitive.** `MaterialRef.kind` + image fields + validator (model round-trip tests); `adk/activity_images.py` slot helper (`save`/`load`/`delete`) with tests against `InMemoryArtifactService`. Curriculum tool/preamble filter to `kind=="curriculum"`. | ~0.75d | — | — |
| **M1** | **Upload endpoint.** `POST /api/activity-images` + `DELETE` (teacher-only, type/size gate, saves to slot, returns `MaterialRef`). api_tests: student 403, bad type 422, oversize 422, happy path saves + returns ref. | ~0.75d | — | — |
| **M2** | **Loader + injector + agent wiring.** `make_activity_image_loader` (copies durable→session, idempotent, orphan recovery) + `make_activity_image_injector` (inlines image Part + label), wired into `_composed_before_agent`/`_composed_before_model`. Tests: loader copies into session; injector inserts an **image-MIME** Part into `llm_request.contents`; skips mid-turn tool round-trips; empty (no image materials) is a no-op. | ~1d | JB retention posture | — |
| **M3** | **Frontend.** `MaterialsSection` image-upload affordance (`fetchWithTeacherAuth` → `/api/activity-images`), thumbnail chips, visibility toggle, remove→DELETE; `accept` image types. vitest: upload calls the right endpoint with the teacher helper; chip renders; remove drops the ref. | ~0.75d | — | — |
| **M4** | **Student-facing display (optional).** When `studentVisible`, render the image in the student workspace (reuse the doc-visibility surface). Tutor-sees-it (M0–M3) is independent of this. | ~0.5d | — | **post-pilot / optional** |

**Core = M0–M3** (~3.25d): a teacher attaches an image, the tutor sees it for every student running the activity. **M4 (student also sees it) is optional** — the ask ("the AI can recall and use it") is satisfied by M0–M3.

## Testing strategy

- **Backend (pytest).** Model: `MaterialRef` round-trips both kinds; validator rejects an image ref with no `materialId` and a curriculum ref with no `docId`. Slot helper: `save`→`load` round-trips bytes+MIME via `InMemoryArtifactService` (reset the singleton per test, `_reset_artifact_service_for_tests`). Endpoint: student 403; disallowed ext / oversize → 422; happy path saves to the slot and returns an image `MaterialRef`. Loader: given an activity with one image material, copies the durable artifact into the student session and records it in `app:activity_images_loaded`; idempotent on a second turn; orphaned id re-loads. Injector: with a loaded image artifact, inserts a `Part` whose `inline_data.mime_type` starts with `image/` before the trailing user content; no-op when no images loaded; skips a mid-turn tool round-trip.
- **Frontend (vitest).** The image upload uses `fetchWithTeacherAuth` against `/api/activity-images` (not the curriculum ingest helper); a returned image `MaterialRef` renders as a thumbnail chip; the visibility toggle and remove behave; `accept` includes the image extensions.
- **E2E (LOCAL_MODE).** Teacher attaches a diagram to an activity; a student opens it; the first tutor turn's request carries the image Part (assert via the ADK session artifact list + a backend log line). The same image appears for a second student (durable slot, not per-session upload).
- **Regression.** A curriculum-only activity (no image materials) produces a byte-identical agent build and zero extra artifacts (loader no-op). The 1.1.7 student-upload path is untouched.

## Human gates (tee up now)

1. **JB — image-retention posture** for teacher-supplied material (gates M2 ship). Lower-stakes than student uploads (teacher's own reference content, no person-in-frame), but record the decision. Likely: retained with the activity for its lifetime, deleted on activity delete.
2. **JB/AR — student visibility default** (informs M4): confirm `studentVisible=false` default (tutor-only unless the teacher reveals) matches the cited-doc behaviour they expect.

## Open questions

- **Q1 — copy-into-session vs inject-direct-from-the-activity-slot.** Recommendation (and M's steer 2026-06-23): **copy into the student session** at session start. It makes the image a normal, observable session artifact (ADK web UI / eval) and lets the injector use the plain `callback_context.load_artifact`. Cost is duplicated bytes per session (tiny). The alternative (injector reads the durable slot via the raw service every turn) avoids duplication but is less observable and bypasses the callback-context convenience. **Decided: copy-in.**
- **Q2 — eager inject vs tool-gated recall.** Recommendation: **eager** (the image sits in context for the conversation), right for the 1–3 reference images an activity realistically carries; the model can't "forget to call a tool". Tool-gated recall (a `view_activity_image` FunctionTool) is the lazy alternative for many-image activities — out of scope; revisit if an activity ever needs >~5 images.
- **Q3 — reuse the document pipeline vs twin it.** The doc loader builds **text** blocks from Firestore `parsed_documents`; images have no such blocks and need an **image** Part, not text. Twinning (separate loader + injector that share the pattern) is cleaner than overloading `document_ids` with a type flag. **Decided: twin.**
- **Q4 — one combined upload affordance vs two.** `MaterialsSection` could auto-route by file type (image → slot, doc → RAG) behind one "Upload" button, or show two explicit affordances. Recommendation: **auto-route by MIME** behind the existing button (fewest teacher decisions); the chip rendering disambiguates after upload. Confirm in M3.

## Related documents

- [student-multimodal-upload.md](student-multimodal-upload.md) — 1.1.7; the proven "model sees an image" path (`Part.from_bytes`), here reused for a teacher-authored, durably-stored image
- [curriculum-library.md](curriculum-library.md) — 1.1.25; `MaterialRef`, `MaterialsSection`, the **text/RAG** sibling pipeline this sits beside
- [teacher-sim-resources.md](teacher-sim-resources.md) — 1.1.41; the "resource attached to an activity" model (artefact ↔ image are two resource kinds)
- [activity-elements-palette.md](activity-elements-palette.md) — 1.1.38; the element layer images compose with on the workspace surface
- the multi-doc context pipeline (`docs/design/v6.1.0/multi-doc-context-fix.md`) — the loader/injector this twins (orphan recovery, per-turn re-inject, idempotency)
- ADR-001 (anonymous-group auth) + ADR-008 (Gemini multimodal) — scoping-site `architecture.qmd`
