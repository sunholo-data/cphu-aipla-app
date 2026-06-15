# Documents workbench surface — one place for student uploads + teacher-assigned materials

**Status:** Planned (P2, design-doc stage). **M0 (image click-to-expand) SHIPPED 2026-06-15** (`445422d`).
**Priority:** **P2** — quality-of-life + a transparency gap, not date-forced. Rides on infra already shipped (1.1.7 uploads, 1.1.25 materials); each milestone is independently valuable and thin.
**Estimated:** ~2.5–3.5d total, milestoned. M0 done (~0.1d). M1 (Documents tab, uploads view) ~1d. M2 (teacher-assigned materials visible) ~1d. M3 (docparse'd doc rendering) ~0.5–1d.
**Scope:** Mostly **Frontend** — a new workbench tab that *aggregates and renders* data that already exists server-side. Small backend reads only (a student-scoped "materials for my activity" endpoint); no new storage.
**Dependencies:** [student-multimodal-upload.md](student-multimodal-upload.md) (1.1.7 — the AG-UI-native image path the uploads come from); [curriculum-library.md](curriculum-library.md) (1.1.25 — `MaterialRef` + the cited-doc corpus + AILANG Parse ingestion); [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19 — `materials` are attached per activity); the config-driven workbench (`workspaceContent.ts` / `WorkspaceShell.tsx`). ADR-004 (AILANG Parse), ADR-013 (sandboxed artefact rendering for any HTML/PDF preview).
**Source:** 15 June feedback ("click an image to expand … this will also eventually be documents parsed by docparse … maybe a new tab in the workbench where we collect uploaded documents and documents assigned by the teacher").

> **Breadth-over-depth steer.** This is a *surface*, not a subsystem — it lights up data three already-shipped features produce but never show together (student uploads, teacher materials, docparse output). The cheapest high-leverage move is to *aggregate*, not build new plumbing. Each milestone is a thin probe; M0 already shipped in one commit.

## Problem

Three features converge on a surface that doesn't exist:

1. **Student uploads are in-chat only.** A photo a student attaches (1.1.7) renders as a 96px thumbnail inside one message bubble. There's no gallery, no "everything I've shared this session", and — until M0 — no way to view one full-size. As docparse joins the picture (a student photographs a worksheet → parsed to text), "an image in a bubble" is the wrong home.
2. **Teacher-assigned materials are invisible to students.** The curriculum `MaterialRef`s a teacher cites (1.1.25) are used *server-side* to ground the tutor (RAG retrieval) — but the student never sees *which* documents the activity is built on. The tutor can say "per your level-B syllabus…", yet the syllabus itself is not viewable. That's a transparency gap (Axiom 2) and a missed pedagogical affordance ("read the assigned text, then ask").
3. **docparse'd documents have nowhere to live.** AILANG Parse (ADR-004) already turns uploads/materials into structured text. There's no student-facing place to show that parsed content or let the student re-open it.

**Pattern, not one-off:** each of the three shipped its own slice and stopped at its own boundary — exactly the seam-leaving pattern that produced the de-mock and stale-pointer issues. The fix is a single aggregating surface, designed once to cover all three sources, not three more bolt-ons.

## Framework-native capability check (MANDATORY — "is this already supported?")

The most expensive mistakes here have been re-implementing native transport/retention (see the 1.1.7 cautionary tale in the design-doc skill). For each source, the surface **reads existing native storage** — it does **not** introduce a new store:

| Source | Where it already lives (native) | What the surface does |
|---|---|---|
| **Student uploads** | AG-UI `ImageInputContent` parts inside the user turn's `InputContent[]`, carried by `ag_ui_adk`'s media converter into **ADK session events** (replayed every turn, survives rejoin — for free). Frontend already exposes them as `message.images` ([useSkillAgent.ts:29](../../../frontend/src/hooks/useSkillAgent.ts#L29)). | Aggregate `message.images` across the loaded session messages into a gallery. **No upload store, no per-image fetch, no side-channel.** |
| **Teacher-assigned materials** | `MaterialRef[]` on the activity config (Firestore) + the cited doc's metadata + the parsed artefact in the curriculum corpus (1.1.25). | A **student-scoped read** that resolves the running activity's `materials` → `{title, origin, level, docId}` for display. Deny-by-default (a student only sees *their* activity's cited docs, never the open corpus — same ACL as the retrieval tool). |
| **docparse'd content** | AILANG Parse output (deterministic, ADR-004) — already produced during 1.1.25 ingestion and available for student uploads via the 1.1.7 path. | Render the parsed text/preview. For any HTML/PDF-ish preview, reuse the **sandboxed artefact frame** (ADR-013) — do not add a new renderer. |

**Conclusion:** no new persistence, no new transport. The one genuinely-absent capability is a **student-facing read of an activity's cited materials** (today the materials API is teacher-only). That's a small additive endpoint, scoped below. Everything else is aggregation + rendering of native data.

## Goals

**Primary:** one **Documents** tab in the student workbench that shows, in a single place: (a) what the student has uploaded this session, full-size on click; (b) the documents the teacher assigned to this activity; (c) docparse'd text for either.

**Success metrics:**
- A student can open any uploaded image full-size (M0 — done) and, by M1, see all of them in one tab without scrolling the chat.
- A student can see the titles/sources of the teacher-assigned materials for their activity (M2) — closing the "what is the tutor grounded in?" gap.
- Zero new storage systems; the surface reads only native session events + existing Firestore/corpus metadata (verified by the table above).

**Non-goals:**
- Student editing/annotation of documents (Year-2).
- A general file manager / cross-session document library for students (anonymous-group students are session-scoped by ADR-001).
- Re-implementing retention or upload transport (native already).
- Teacher-side materials authoring — that's 1.1.25/1.1.19, already shipped.

## Design

### Surface: a config-driven workbench tab

The workbench is already config-driven (`workspaceContentKind()` → `WorkspaceShell`). Add a `documents` content kind that mounts when the activity has either (a) any uploaded images in-session or (b) a non-empty assigned-materials set. It sits alongside the sim/checklist tabs (the dual-surface rule from `reference_workbench_artefact_dual_surfaces` applies — wire it into the workbench tab system, not a one-off panel).

### Data sources (all native reads)

- **Uploads gallery:** derive from the already-loaded `message.images` across session messages — a pure selector, no fetch. Each thumbnail is a `ZoomableImage` (shipped M0).
- **Assigned materials:** new student endpoint `GET /api/activity-configs/active/{activity_id}/materials` (or fold into the existing `…/active/{activity_id}` resolve) → returns the activity's `MaterialRef[]` resolved to display metadata, ACL-scoped to the caller's group→class (deny-by-default; mirrors `build_curriculum_retrieval_tool`'s allow-list). No open-corpus browse.
- **Parsed view:** for a selected document, show AILANG Parse text; HTML/PDF previews render in the ADR-013 sandboxed frame.

### Milestones

- **M0 — image click-to-expand (SHIPPED `445422d`).** Reuse the existing lightbox (`ZoomableImage`, extracted from `InlineImage`) on upload thumbnails. ~0.1d.
- **M1 — Documents tab: uploads gallery.** New `documents` workbench kind; aggregate `message.images`; full-size on click. Frontend-only. ~1d.
- **M2 — assigned materials visible.** Student-scoped materials read + render titles/sources in the tab; click opens parsed text. Gated on the **open pedagogical question** below. ~1d.
- **M3 — docparse'd document rendering.** Parsed-text/preview view for uploads + materials; sandboxed frame for rich previews. ~0.5–1d.

### CLI surface

Minimal — this is a student-facing render surface. The existing `aiplatform sessions inspect` already surfaces a session's uploaded-image parts for debugging; M2's materials read is exercised by the existing curriculum CLI (`aiplatform curriculum query/list`). No new command needed. (Noted per the mandatory CLI-affordance check; revisit if M3 adds a parse-preview worth a local `aiplatform documents preview`.)

## Open question (for JB / AR — pedagogical, gates M2)

**Should teacher-assigned RAG sources be student-visible?** Making the assigned materials viewable closes a transparency gap and supports "read then ask". But it also (a) may distract from the Socratic flow (the point is dialogue, not document-dumping), and (b) re-exposes copyright-cleared-only material to students directly (today the corpus is teacher-browse; student-visible changes the clearance surface — see [project_curriculum_clearance]). **M2 is gated on this call.** M1 (own uploads) and M0 carry no such question and can proceed regardless.

## Axiom Alignment

Net must be ≥ +4; ≤ 2 conflicts. See [Product Axioms](../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|---|---|---|
| 1 | INSTANT FEEL | +1 | Uploads gallery is a pure selector over already-loaded messages — no fetch, instant. |
| 2 | EARNED TRUST | +1 | Closes the "what is the tutor grounded in?" gap (M2); students see their own shared work. |
| 3 | SKILLS, NOT FEATURES | 0 | A cross-skill workbench surface; neutral. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model interaction. |
| 5 | GRACEFUL DEGRADATION | +1 | Empty/absent sources → tab hides or shows an honest empty state (consistent with the no-mock guard). |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reads AG-UI `ImageInputContent` / ADK session events / `MaterialRef` natively; ADR-013 frame for previews. No custom store or format. |
| 7 | API FIRST | +1 | The one new capability is a typed student-scoped materials endpoint; everything else is existing API. |
| 8 | OBSERVABLE BY DEFAULT | 0 | Render surface; inherits existing chat/session telemetry. |
| 9 | SECURE BY CONSTRUCTION | 0 | M2 endpoint is deny-by-default, ACL-scoped to the caller's activity (mirrors the retrieval allow-list); but it does widen who can read cleared materials → see the open question + clearance note. Net neutral with the gate. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Client aggregates protocol-native data; logic (ACL, parse) stays server/protocol side. |
| 11 | USABLE BY DESIGN | +1 | A single obvious home for documents; full-size view; keyboard/ESC close via Radix Dialog. |

**Net: +8** (0 conflicts). Hard-fail rules satisfied (EARNED TRUST not −1; SECURE BY CONSTRUCTION not −1 — the clearance widening is gated as an explicit decision, not shipped silently).

## Testing strategy

- **M0 (done):** `ZoomableImage` unit test (trigger className, opens lightbox, broken-image fallback); `InlineImage` regression unchanged. 42 image/MessageBubble tests green.
- **M1:** selector unit test (aggregate `message.images` across messages, de-dupe, order); tab renders gallery; empty state when no uploads.
- **M2:** backend test for the student-scoped materials endpoint (ACL: own activity → 200 with materials; other activity / open corpus → denied); frontend renders titles/sources; gated-off state when the pedagogical decision is "no".
- **M3:** parsed-text render test; sandboxed-frame mount for a preview.

## Related documents

- [student-multimodal-upload.md](student-multimodal-upload.md) (1.1.7) — the AG-UI-native upload path M1 reads from.
- [curriculum-library.md](curriculum-library.md) (1.1.25) — `MaterialRef`, corpus, AILANG Parse; M2's source.
- [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19) — where `materials` are attached.
- [local-dev-cli.md](../../v6.1.0/local-dev-cli.md) — CLI affordance check (no new command in scope).
