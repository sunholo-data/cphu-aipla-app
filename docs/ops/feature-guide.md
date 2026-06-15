# AIPLA feature guide — how to use & turn on each surface

A plain-language guide to the student- and teacher-facing features that
exist in the deployed app, where they appear, and what has to be **on**
for them to show up. Written after the 2026-06-15 review, where the
features were all built but several were invisible in the demo because
of gating (and a stale skill seed).

> **Go-to demo skill:** **Boldkast** (`problem-set-hints`). All
> student-facing features below are enabled on it. If a feature isn't
> showing, check the **"Why it might be hidden"** column first, then the
> [seed gotcha](#operational-after-changing-a-skill-re-seed) at the bottom.

## At a glance

| Feature | Who | Where it appears | Turned on by | Why it might be hidden |
|---|---|---|---|---|
| **Photo / image upload** *(the student upload path)* | Student (incl. anonymous) | Paperclip + camera in the chat composer | Skill has `multimodalInput: true` | Skill flag off, or **deployed Firestore not re-seeded** after a template change |
| **Read-aloud (TTS)** | Student | Speaker toggle in the chat header | Skill has a `voice:` block | Auto-read toggle is off; or skill has no voice |
| **Talk-to-type (voice input)** | Student | Mic in the chat composer | Class `voiceInputEnabled` (default **ON**) | Teacher turned it off for the class |
| **Lesson recording (research audio)** | Teacher → class | Record control in the composer (mic, XOR talk-to-type) | Teacher enables recording for the class | Off by default — deliberate, consent-gated |
| **Document-library upload** *(teacher/researcher, NOT students)* | Signed-in teacher / researcher | Doc sidebar → upload toggle | Open doc sidebar, click upload | **Invisible to all students by design** (students are anonymous → no doc sidebar). Students upload via the photo path above. |
| **Curriculum materials (browse / cite / upload)** | Teacher | Activity **edit** page, Materials section | — | **Not reachable for real activities via the UI yet** — the edit page is mock-only and unlinked (v1.1). Use the curriculum CLI meanwhile. |

---

## 1. Photo / image upload (student)

**What it is:** students attach a photo of their working (e.g. a
handwritten projectile-motion calculation) and the tutor can see it.
Images are passed to the model per-turn and **not retained** (privacy by
design — AG-UI-native, non-retaining).

**Where:** the paperclip and camera buttons in the chat composer, plus a
staging row above the composer once an image is attached. Component:
[ImageComposer.tsx](../../frontend/src/components/chat/ImageComposer.tsx),
mounted in [chat/[...path]/page.tsx](../../frontend/src/app/chat/[...path]/page.tsx).

**Turned on by:** the skill's `multimodalInput: true` flag. Only these
skills set it: **Boldkast** (`problem-set-hints`), `led-planck-tutor`,
`kinebot-kinematics-tutor`. Chat-only skills like `concept-dialogue`
intentionally do **not** have it.

**Works for anonymous students.** This is *the* student upload path and
it is **not** gated by the anonymous-group check
([page.tsx:1052](../../frontend/src/app/chat/[...path]/page.tsx#L1052) —
`{skillMultimodalInput && ...}`, no auth-mode gate). Since every student
is anonymous (ADR-001), this is the only upload surface a student sees —
and that's intended. The document-library sidebar (§5) is a separate,
teacher-only surface.

**Accepted formats:** JPEG, PNG, WebP, HEIC, HEIF.

**Gotcha:** the flag lives in the `SKILL.md` template, but editing the
template does **not** propagate to the deployed app until you re-seed —
see [the seed note below](#operational-after-changing-a-skill-re-seed).

## 2. Read-aloud / text-to-speech (student)

**What it is:** the tutor's replies can be read aloud in the skill's
configured voice (Boldkast uses a Danish Chirp3-HD voice). Personas can
carry their own voice + style direction.

**Where:** a speaker / auto-read toggle in the **chat header**. When
auto-read is on, each tutor turn is spoken as it arrives.

**Turned on by:** the skill (or its persona) having a `voice:` block.
Boldkast's is set (`da-DK-Chirp3-HD-Aoede`). The header toggle is the
per-session on/off.

## 3. Talk-to-type / voice input (student)

**What it is:** the student speaks instead of typing; speech is
transcribed into the composer (transcript-only, raw audio not retained).

**Where:** the mic button in the chat composer.

**Turned on by:** the class config `voiceInputEnabled`, which is
**default-ON** for new classes
([class_.py:92](../../backend/db/models/class_.py#L92)). A teacher can
turn it off per class. Note: the composer mic is **talk-to-type XOR
lesson-recording** — a class is in one mode or the other, never both at
once.

## 4. Lesson recording (research audio capture)

**What it is:** segmented audio capture of a lesson for research, which
produces a transcript shown on the student workbench and on the teacher's
group report.

**Where:** the record control in the composer (replaces talk-to-type when
the class is in recording mode).

**Turned on by:** the teacher enabling recording for the class. **Off by
default** — this is deliberate. Recording is consent-gated (physical
forms, teacher-enabled, cleared 2026-06-11). Don't enable it for a casual
demo.

## 5. Document-library upload (chat doc sidebar) — teacher/researcher only

> **This is NOT the student upload path.** Students upload photos via the
> composer (§1). This section is the multi-document library sidebar, which
> is a teacher/researcher surface. **No student ever sees it** — every
> student is anonymous, and the whole doc UI is gated off for anonymous
> mode. That is by design, not a bug.

**What it is:** upload a document into the chat's document sidebar for the
tutor to reference, for a signed-in (non-anonymous) user.

**Where:** the doc sidebar in the chat view → click the upload (↑) toggle
to reveal the drop zone.
Component: [UploadDropZone.tsx](../../frontend/src/components/doc-browser/UploadDropZone.tsx).

**Gating (three gates, all required):**
1. **Not anonymous-group mode** —
   `showDocumentUI = !isAnonymousGroupAuthMode()`
   ([page.tsx:386](../../frontend/src/app/chat/[...path]/page.tsx#L386)).
   All students fail this gate. Sign in as a real teacher / researcher.
2. The doc sidebar must be open.
3. Click the upload toggle to show the drop zone.

## 6. Teacher curriculum materials (browse / cite / upload)

**What it is:** the teacher attaches curriculum materials to an activity.
Materials are ingested into the RAG corpus and used to ground the tutor's
answers. Browse the cleared library, cite existing docs, or upload new
ones.

**Where (and the real catch):** the **Materials** section lives on the
activity **edit** page `/teacher/activities/{id}`
([MaterialsSection.tsx](../../frontend/src/components/teacher/MaterialsSection.tsx)
in [activities/[id]/page.tsx](../../frontend/src/app/teacher/activities/[id]/page.tsx)).
**That page is not reachable for real activities through the UI yet:**
- It loads via `getMockActivityConfig(id)` and **`notFound()`s for any
  real skill/activity id**
  ([page.tsx:64](../../frontend/src/app/teacher/activities/[id]/page.tsx#L64)).
- **Nothing links to it.** The activities list row links to "Open class";
  "New activity" redirects to `/teacher/classes` on save; and the
  class-detail "Configure" button is **intentionally absent**
  ([classes/[id]/page.tsx:471](../../frontend/src/app/teacher/classes/[id]/page.tsx#L471)).

Wiring this page to `/api/activity-configs` for arbitrary lessons is the
explicitly-deferred **v1.1** item (`teacher-artefact-parameters.md`). The
backend (RAG ingest, retrieval, grounding) and the component all shipped
in 1.1.25; only the real-activity UI is missing.

**How a teacher attaches materials today:** the **curriculum CLI** (also
1.1.25). The curriculum API is teacher-only; anonymous students get a 403.
Only **copyright-cleared** docs are in the shared corpus (A-level cleared;
B/C not yet).

---

## Operational: after changing a skill, re-seed

The single most common reason a student-facing feature "doesn't work in
the deployed app but works in tests": **the deployed Firestore skill doc
is stale.**

Editing a `backend/skills/templates/**/SKILL.md` (the `multimodalInput`
flag, `voice:` block, avatar, persona, tools, etc.) does **not**
propagate to Firestore on a code deploy — the seed can't run inside Cloud
Build. You must run it manually after the deploy completes:

```bash
make seed ENV=dev
```

It reports `created / updated / skipped` per skill. `updated > 0` means
docs were stale and have been refreshed; `skipped` means they already
matched. (On 2026-06-15, this returned `updated: 6` — all skills were
stale, which is why image upload was missing in the demo.)

## Demo checklist (Boldkast)

1. `make seed ENV=dev` — confirm the deployed skill matches the template.
2. Open Boldkast and confirm:
   - the **paperclip + camera** appear in the composer (image upload),
   - the **mic** appears (talk-to-type),
   - the **speaker** toggle is in the header (read-aloud),
   - the **Boldkast sim** loads in the workspace.
3. For the teacher side: create an activity from `/teacher/activities/new`.
   Note that **attaching curriculum materials to it is CLI-only today** —
   the in-UI Materials picker is on a mock-only page (see §6). Don't
   promise live material-attach in a teacher demo until the v1.1 wiring
   lands.

See [deployed-urls.md](deployed-urls.md) for the live service URLs and
[platform-skills.md](platform-skills.md) for the skill-seeding details.
