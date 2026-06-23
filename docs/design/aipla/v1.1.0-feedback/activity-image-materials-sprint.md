# Sprint plan — 1.1.44 activity-image-materials

**Design doc:** [activity-image-materials.md](activity-image-materials.md)
**Sprint ID:** `IMG-MAT`
**Created:** 2026-06-23
**Estimate:** ~3.25d (M0–M3 core; M4 optional/post-pilot)
**Depends on:** [1.1.7 student-multimodal-upload](student-multimodal-upload.md) (SHIPPED — the `Part.from_bytes` multimodal shape); [1.1.25 curriculum-library](curriculum-library.md) (SHIPPED — `MaterialRef`, `MaterialsSection`, `resolve_active_config`); the shipped document pipeline ([`adk/callbacks/document.py`](../../../backend/adk/callbacks/document.py)) this twins.

**Build order is TDD throughout** — test first, then implement to green, lint after each milestone. CI parity: `cd backend && make lint && make test-fast` + `cd frontend && npm run quality:check`.

## Milestones

### M0 — Data model + storage primitive (backend, TDD)
- **`backend/db/models/activity_config.py`** — `MaterialRef` gains `kind: Literal["curriculum","image"] = "curriculum"`; `doc_id` becomes optional (default `""`); add `material_id`/`mime_type`/`alt` (aliases `materialId`/`mimeType`/`alt`). `@model_validator(mode="after")` requires `docId` for curriculum, `materialId` for image. Backward-compatible (no `kind` → curriculum).
- **`backend/adk/activity_images.py`** (new) — `AIPLA_ARTIFACT_APP = "aipla"`; `_ext_for(mime)`/`_slot_filename(material_id, ext)`; `save_activity_image(*, teacher_uid, activity_id, material_id, data, mime_type)`, `load_activity_image(...)`, `delete_activity_image(...)` over `get_artifact_service()` keyed `(AIPLA_ARTIFACT_APP, teacher_uid, activity_id, filename)`.
- **`backend/adk/curriculum_retrieval.py`** — `build_curriculum_retrieval_tool` + `build_curriculum_grounding_preamble` filter materials to `kind == "curriculum"` (images aren't RAG docs).
- **Tests** (`tests/unit/test_material_ref.py`, `tests/tool_tests/test_activity_images.py`): both kinds round-trip via alias; validator rejects image-without-`materialId` + curriculum-without-`docId`; `save`→`load` round-trips bytes+MIME via `InMemoryArtifactService` (`_reset_artifact_service_for_tests()` per test); `delete` removes the slot; `load` of a missing slot → `None`; curriculum builders ignore image refs.

### M1 — Upload endpoint (backend, TDD)
- **`backend/protocols/activity_image_routes.py`** (new; mount in the app router):
  - `POST /api/activity-images` (multipart: `file`, `activityId`, `alt?`) — teacher-only (`group_id` → 403); ext/mime allowlist `{png,jpg,jpeg,webp,gif}` else 422; size ≤ `IMAGE_MAX_BYTES` (~5 MB) else 422; `material_id = uuid4()`; `save_activity_image(...)`; → 201 `{ materialRef: {kind:"image", materialId, mimeType, alt, studentVisible:false} }`.
  - `DELETE /api/activity-images/{activityId}/{materialId}` — teacher-only; `delete_activity_image(...)`; 204.
- **Tests** (`tests/api_tests/test_activity_images.py`): student 403 (both verbs); disallowed ext → 422; oversize → 422; happy path saves to the slot (assert via `load_activity_image`) + returns a well-formed image `MaterialRef`; delete removes it.

### M2 — Loader + injector + agent wiring (backend, TDD)
- **`backend/adk/callbacks/activity_images.py`** (new):
  - `make_activity_image_loader()` (`before_agent_callback`) — `resolve_active_config(skill_id, group_tags)` → image materials; track `app:activity_images_loaded`; orphan-probe (drop ids whose session artifact is gone); for each new id `load_activity_image(durable)` → `callback_context.save_artifact(filename=f"activity-image:{material_id}", artifact=part)`. Per-image failures non-fatal (logged). Mirrors `make_document_loader`.
  - `make_activity_image_injector()` (`before_model_callback`) — for each loaded id, `callback_context.load_artifact(...)` → if `inline_data` present, `contents.insert(-1, label_text_part)` then `contents.insert(-1, image_part)`. Skip when no images loaded / trailing role ≠ user / mid-turn tool round-trip. Mirrors `make_document_injector` but inlines an **image** Part.
- **`backend/adk/agent.py`** — instantiate both (next to `_document_loader`/`_document_injector`); call the loader in `_composed_before_agent` after `_document_loader` (~L414); call the injector in `_composed_before_model` after `_document_injector` (~L463, before the budget gate).
- **Tests** (`tests/tool_tests/test_activity_image_callbacks.py`): loader copies a durable image into the student session + records the id; idempotent on a 2nd turn; orphaned id re-loads; injector inserts a `Part` with `inline_data.mime_type` starting `image/` ahead of the trailing user content; no-op when none loaded; skips a `function_response` trailing turn. (Fakes a `callback_context` like the existing doc-callback tests.)

### M3 — Frontend (frontend, TDD)
- **`frontend/src/lib/teacherApi.ts`** — `MaterialRef` gains `kind?`, `materialId?`, `mimeType?`, `alt?`. **`frontend/src/lib/curriculumApi.ts`** (or a small `activityImageApi.ts`): `uploadActivityImage(activityId, file, alt?)` → `fetchWithTeacherAuth('/api/proxy/api/activity-images', {method:'POST', body: FormData})`; `deleteActivityImage(activityId, materialId)`.
- **`frontend/src/components/teacher/MaterialsSection.tsx`** — image upload affordance: `accept=".png,.jpg,.jpeg,.webp,.gif"`, routes by MIME (image → `uploadActivityImage`, else existing `ingestCurriculum` — Q4 auto-route behind one button); image `MaterialRef`s render as **thumbnail chips** with the existing `studentVisible` eye-toggle + remove (→ `deleteActivityImage` then drop the ref). `useActivityBuilder` already threads `materials`.
- **Tests** (`MaterialsSection.test.tsx`): image file → `fetchWithTeacherAuth` to `/api/activity-images` (NOT the curriculum helper); returned image ref renders a thumbnail chip; toggle + remove behave; doc file still routes to curriculum ingest (no regression).

### M4 — Student-facing display (optional, post-pilot)
When `studentVisible`, render the image in the student workspace Documents surface (1.1.33). Independent of M0–M3 (tutor-sees-it doesn't need it). **Out of this sprint** unless JB asks.

## Acceptance (from design)
- A teacher attaches an image to an activity; for **every** student running it, the first tutor turn's `llm_request.contents` carries an image-MIME `Part` (asserted in M2 tests + an E2E log line).
- The image lives in the **ADK ArtifactService** (no parallel GCS path); durable slot `aipla/{teacher_uid}/{activity_id}/activity-image:*`; copied into each student session (observable as a session artifact).
- Upload is teacher-only; type+size gated; `studentVisible=false` default.
- Curriculum/RAG path unchanged (builders filter to `kind=="curriculum"`); a curriculum-only activity builds byte-identically (loader no-op).
- `make lint` + `make test-fast` + `npm run quality:check` green.
- GCP side effect (new blob prefix on the existing `$ADK_ARTIFACT_BUCKET`, no new IAM) recorded in [docs/ops/gcp-side-effects.md](../../../ops/gcp-side-effects.md).

## Deferred / out of scope
M4 student display; `aiplatform activity add-image` CLI; multi-image-per-turn token-budget tuning; tool-gated `view_activity_image` recall (eager injection only); HEIC; image resize/transcode server-side (client sends as-is within the size cap).

## Human gate
JB — image-retention posture for teacher-supplied material (record decision; likely retained with the activity, deleted on activity delete). Does not block M0–M1 or M3; confirm before M2 ships to a pilot env.
