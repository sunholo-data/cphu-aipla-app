# Activity library + sharing — activities as class-independent, shareable resources

**Status:** Planned — **PRE-PILOT (pulled forward 2026-06-24, M)**. Originally scoped post-pilot, but the pilot runs in **research mode with a trusted teacher set**, where cross-teacher see/share/adopt-copy *is* the pilot behaviour, not a later marketplace. The M3 sharing-scope gate is **resolved** (see ↓ "Sharing decision"). Full M0–M3 is the pre-pilot target; M4 stays optional.
**Last Updated:** 2026-06-24 (sharing-scope decision resolved → pre-pilot; class-detail picker migration "Add from catalogue" → "Add activity")
**Priority:** P1 (post-pilot) — directly addresses an observed teacher mental-model mismatch: teachers expect to make a class, then **pick** activities (their own or others'); today an activity is welded to one class.
**Estimated:** ~6–9d fullstack, phased (Activity entity + migration ~2d · many-class assignment + library list ~2d · duplicate/branch ~1d · publish + shared catalogue + adopt ~2–3d)
**Scope:** Fullstack — a class-independent `Activity` entity + a class↔activity assignment (many-to-many) + a copy/adopt primitive + a `draft|private|published` visibility state + the student-resolution change (resolve by activity id, not skill id) + the teacher activities-library UI
**Dependencies:** [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19 — the `ActivityConfig` definition + its **M3 `duplicate` / `source_activity_id`** this generalises; its Q1 chose option (A) *"promote ActivityConfig"* **for v1.1 and explicitly flagged option (B) — a separate `Activity` entity — to revisit "if/when branching across classes or a marketplace lands"; this doc is that revisit**); [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) (1.A — the `Class` entity + the 5-type `AccessControl` `tagged` primitive + the namespace invariant; its non-goal §line *"Cross-class skill sharing … across their own classes … or across teachers via marketplace. That's v2"* is what this fulfils); [teacher-sim-resources.md](teacher-sim-resources.md) (1.1.41 — the **catalogue + adopt** pattern for *sims*, generalised here to *activities*); [sim-catalogue-admin.md](sim-catalogue-admin.md) (1.1.42 — the publish/visibility CMS shape); [researcher-role.md](researcher-role.md) (1.1.5 / ADR-016 — the elevated role for any cross-teacher moderation)
**Source:** 2026-06-23 — M: *"activities can only be linked to specific classes, but teachers naturally think they can create a class, then select from pre-made activities — their own and others'. Need activities that link to several classes; create your own, from a template, or pick an existing one. List activities under each teacher (your own on top). Take an existing activity and edit on top of it. Cleanest with a draft/publish/private state? When another activity is chosen it gets copied into the teacher's own activities."*

> **Read first — what already exists, so this doc is the delta, not a re-litigation.** The *content* of an activity (goal, [elements](activity-elements-palette.md), [sim](teacher-sim-resources.md), [materials](curriculum-library.md)) ships. The **duplicate/branch primitive is already designed** — [1.1.19 M3](teacher-activity-authoring.md) specs `POST /api/activities/{id}/duplicate` + the `source_activity_id` provenance field (already on the `ActivityConfig` model). The **tagged-ACL + Class** primitives ship (1.A). What is **missing** — and what this doc adds — is the **shape change**: an activity is currently a per-`(teacher, class, activity)` row (`{teacher_uid}:{class_id}:{activity_id}`), so it cannot exist independently of a class, cannot be assigned to several, and cannot be browsed/copied across teachers. This doc promotes the activity to a **first-class, class-independent, owned resource** and adds the assignment / copy / publish layer on top of the shipped content + duplicate primitives.

## The problem (a real mental-model mismatch)

A teacher's intuition is **class → pick activities**. The platform's model is **activity → bound to one class at creation**. Three concrete frictions follow:

1. **An activity can't be reused across a teacher's own classes.** A teacher running the same lesson in 7A and 7B must author it twice (two `(teacher, class, activity)` rows). There is no "assign this to 7B too."
2. **There is no cross-teacher reuse.** A teacher can't see or start from a colleague's good activity — there is no catalogue of others' activities and no copy path. (Explicitly v2 in 1.A + 1.1.19.)
3. **A latent limitation falls out of the same root cause.** Because a chat activity's `activity_id` is the **shared `concept-dialogue` skill UUID** (1.1.19 M0 bound to the base skill; the mint-distinct-id decouple is the pending M3 tail), a `(teacher, class)` can hold **only one** concept activity — the key collides. Decoupling the activity from the class **and** from the skill fixes #1, #2, *and* this at once.

## The model: an Activity is an owned resource; a class *assigns* it

Promote the activity to its own entity, decoupled from both the class and the running skill. Three relationships cover the whole ask:

```
            ┌─────────────────────────────────────────────────────────┐
            │  Teacher T's library (activities owned by T)             │
            │    A1 (private)   A2 (published)   A3 (draft)            │
            └───────────┬───────────────┬─────────────────────────────┘
   assign (live, T-only)│               │ publish → shared catalogue
            ┌───────────▼──────┐        │        ┌──────────────────────┐
            │ T's class 7A ──┐  │        └───────▶│  Shared catalogue    │
            │ T's class 7B ──┘──┼── both run A1   │  (published, grouped │
            └──────────────────┘                  │   by owner)          │
                                                   └──────────┬───────────┘
   Teacher U browses, picks A2 ───── adopt (COPY) ────────────┘
            │
            ▼  U's library gains A2′  (owner=U, source_activity_id=A2)
            │  U edits A2′ freely, assigns A2′ to U's classes
```

1. **Own activity → many of your own classes: a live *assignment* (reference, not a copy).** One `Activity` document; many of the owner's classes reference its id. Editing the activity updates every class that runs it. This is the "link to several classes" ask, kept simple by the owner-only invariant (you can only assign activities you own).
2. **Another teacher's activity → *adopt by copy*.** Choosing a colleague's **published** activity **copies** it into your library (new id, `owner_uid = you`, `source_activity_id` + `source_owner_uid` provenance, visibility `draft`). You then edit and assign *your copy*. **No cross-teacher live mutation** — the source teacher editing theirs never changes yours, and you can never edit theirs. This is exactly M's "it gets copied and appears in the teacher's own activities", and it sidesteps the shared-mutation coordination problem entirely.
3. **"Edit on top of an existing one" → the same copy primitive.** Duplicate (your own or an adopted activity) → an independent copy with `source_activity_id` set → edit. This *is* [1.1.19 M3](teacher-activity-authoring.md)'s `duplicate`, generalised to work across the library (own + adopted).

**Why copy-for-others but live-link-for-own (the recommendation).** Within one owner there is a single locus of editing intent, so a live reference is what a teacher wants (fix the lesson once, all my classes get it). Across teachers there are *two* editing intents, so a live link would mean "a colleague's edit silently changed my class mid-term" — a trust hole (Axiom 2). Copy makes provenance explicit and ownership clean. (Alternative — live cross-teacher links with a "pin version" — is captured in Open Questions.)

### Visibility: `draft` · `private` · `published`

M's proposed three-state model, made precise. Visibility is one field on the `Activity`; it governs **two** things — student-facing readiness and catalogue sharing:

| State | Student-facing? | In shared catalogue? | Meaning |
|---|---|---|---|
| **draft** | No (owner trial only) | No | Work in progress. Owner-only. Not assignable to a class for students yet (assign is allowed but flagged "draft — students won't see it"). The builder's *Save draft*. |
| **private** | Yes (owner's classes) | No | Finished. Assignable to the owner's classes; students run it. **Not** shared with other teachers. |
| **published** | Yes (owner's classes) | **Yes** | Finished **and** listed in the shared catalogue for other teachers to adopt. Still the owner's to use. |

Transitions: `draft → private` (finish, keep to self) or `draft → published` (finish + share); `private ↔ published` (publish / unpublish — unpublishing removes it from the catalogue but does **not** affect copies already adopted, which are independent). A student session always pins the resolved content at start, so an owner editing a `private`/`published` activity mid-term follows the same already-shipped per-session resolution rules.

### Sharing decision (M, 2026-06-24) — resolves the M3 gate + Q1 + Q3

The pilot is **research mode with a trusted teacher set**, so the sharing model is **open within that set, with researcher oversight** — no approval workflow:

1. **Open publish + browse + adopt-copy.** Any teacher may publish; any teacher may browse the shared catalogue and **adopt** (copy into their own library). No pre-publish review gate (Q3 → *no moderation gate*). Trust is the small-set assumption, the same posture [sim-catalogue-admin.md](sim-catalogue-admin.md) (1.1.42) takes.
2. **Adopt is copy, and you edit your own copy** (Q1 → **copy**, confirmed). A colleague's edit never mutates your adopted copy; `source_activity_id` + `source_owner_uid` record provenance.
3. **Researcher = full CRUD over *all* activities (the moderation mechanism).** A `role:researcher` (JB/AR/M) can **read, edit, unpublish, and delete any teacher's activity**, regardless of owner. This *replaces* a pre-publish gate with a trusted post-hoc override — a researcher cleans up rather than approves. **Net-new vs the shipped researcher role**, which today bypasses reads only (`assert_can_read_class` / `_load_readable`; **write+delete stayed owner-only** — [1.1.5 sprint](implemented/researcher-role-sprint.md)). This doc extends that bypass to **write/delete on the `activities` collection** — the one deliberate departure from the owner-only invariant, gated on `User.is_researcher`, OTel-spanned (`auth.researcher_bypass`) like the read path. It is **not** a general write-bypass on every collection — scoped to activities.

## Data model

A new top-level collection; the per-class config row becomes a thin assignment.

```python
# NEW: activities/{activity_id}  — the owned, class-independent definition.
class Activity(BaseModel):
    activity_id: str            # library id, minted "act-…" (NOT the skill id)
    owner_uid: str              # Firebase teacher uid
    title: str
    teaching_goal: str
    language: Language = "da"
    # content — identical to today's ActivityConfig payload, minus class_id:
    artefact_id: str | None = None          # 1.1.41 sim
    checklist / table / chart / calculator / note: list[...] = []   # 1.1.38 elements
    materials: list[MaterialRef] = []        # 1.1.25
    persona: str | None = None               # class-default-inherited otherwise (1.1.32)
    interaction_style: InteractionStyle | None = None
    # sharing:
    visibility: Literal["draft", "private", "published"] = "draft"
    source_activity_id: str | None = None    # provenance (1.1.19 M3 — already exists)
    source_owner_uid: str | None = None      # who we adopted/branched from
    created_at, updated_at, deleted_at: datetime | None

# CHANGED: a class references the activities it runs (many-to-many, owner-only).
# Reuse the existing Class.lessons binding semantics, but the ids are now
# activity ids, resolved to their running skill at session start.
class Class(BaseModel):
    ...
    activity_ids: list[str] = []   # the owner's library activities this class runs
```

**The running skill is resolved from content, not from the id.** `activity.artefact_id` set → the sim's skill; else the base `concept-dialogue` skill. So one library activity id maps to one skill *instance-configured* by that activity — which is why a class can now hold many concept activities (distinct activity ids, same underlying skill). The `{teacher_focus}` injection ([teacher_focus.py](../../../backend/adk/teacher_focus.py)) resolves the goal from the `Activity` doc keyed by activity id, replacing today's `(teacher, class, activity)` lookup.

## Resolution path change (student side)

Today: group JWT → `class:<owner>:<class_id>` tag → `get_activity_config(teacher_uid, class_id, activity_id=skill_id)`. The student lesson list is the class's `lessons` (skill ids).

New: group JWT → class → `class.activity_ids` → the **student lesson list is the assigned activities** (each shown by its `title`, resolving to its skill). Opening activity `A` → load `activities/A` → run `A`'s skill with `{teacher_focus}` composed from `A`. Owner is always the class owner (you only assign your own activities), so no cross-owner read is needed at student-resolution time — adopted activities are already copies in the class owner's library. This keeps the trusted, HS256-signed `class:<owner>:<id>` binding as the only authority a student carries.

## API + CLI

| Endpoint | Method | Description | Auth |
|---|---|---|---|
| `/api/activities` | POST | Create (mint `act-…`); blank or from a template | teacher |
| `/api/activities` | GET | `?owner=me` → your library; `?published=true` → shared catalogue (grouped by owner) | teacher |
| `/api/activities/{id}` | GET / PATCH / DELETE | Read / edit / soft-delete — **owner-only** for PATCH/DELETE; published readable by any teacher | teacher (owner) **or researcher** (CRUD bypass) |
| `/api/activities/{id}/duplicate` | POST | Copy → caller's library (sets `source_*`). Source must be owner's **or** `published`. Generalises [1.1.19 M3](teacher-activity-authoring.md). | teacher |
| `/api/activities/{id}/publish` · `/unpublish` | POST | Toggle catalogue visibility (private ↔ published) | teacher (owner) **or researcher** |
| `/api/classes/{class_id}/activities` | PATCH | `{add:[…], remove:[…]}` assign/unassign — **owner's own activities only** | teacher (owner) |

CLI parity: `aiplatform activity new|list|edit|duplicate|publish`, `aiplatform class activities <id> --add/--remove` (extends the shipped `aiplatform class` family from 1.A).

## Teacher UI — the activities library

The activities index ([app/teacher/activities](../../../frontend/src/app/teacher/activities/page.tsx)) becomes a **library**, matching M's "your own at the top, then others' grouped by teacher":

- **Your activities** (top) — cards grouped, each with a **visibility badge** (draft / private / published), the **classes it's assigned to** (chips), and **Assign to classes ▾** (multi-select of the owner's classes), **Edit**, **Duplicate**, **Publish/Unpublish**, **Delete**. "New activity" offers **blank · from a template · from an existing one** (duplicate).
- **Shared activities** (below) — **grouped by owner teacher**, showing each teacher's `published` activities, with attribution and a single **Use / adapt** action → adopt-copy → lands in *Your activities* as a `draft` ready to edit + assign. Reuses the catalogue/adopt affordance shape from [1.1.41 SimPicker](teacher-sim-resources.md) and the by-owner grouping M asked for.

Teacher-auth surface throughout (`useTeacherAuth` / `fetchWithTeacherAuth` — the recurring 401 corner). The student-facing lesson list (`app/lessons`) changes from listing skills to listing the class's **assigned activities** by title.

### The class-detail page: "Add from catalogue" → "Add activity"

The one teacher surface this doc must explicitly re-point is the class-detail page's lesson picker ([`app/teacher/classes/[id]/page.tsx`](../../../frontend/src/app/teacher/classes/[id]/page.tsx)). It is the **only** place that still calls the assignable unit a "skill from a catalogue", and under the new model it is wrong on **both** axes — the data path *and* the word. [1.1.32 item 6](teacher-ux-refinement.md) named the target in one line (*"'Add from catalogue' lists the teacher's own activities (+ base sims), not just raw skills"*); this is that change, made concrete.

- **Today.** The **Add from catalogue** button opens `LessonPicker` over `listAccessibleSkills()` (the global `/api/skills` list) and `patchLessons(classId, {add:[skillId]})` appends a **skill id** to `cls.lessons`. The "catalogue" is the *skills* catalogue and you assign **raw skills** — including bare sims — directly to the class.
- **After.** The picker lists the **owner's own library activities** not already assigned (by `activity_id`, resolved from `GET /api/activities?owner=me`, filtered against `cls.activity_ids`), and assigns via `PATCH /classes/{id}/activities {add:[activityId]}` (M1) — **not** `patchLessons`. Rename the button to **Add activity** (the word *catalogue* is now reserved for the cross-teacher **shared/published** catalogue). The empty-state copy ("…or 'Add from catalogue' to pick an existing one") and the `LessonPicker`/`patchLessons`/`listAccessibleSkills` wiring retire with the cut.
- **No cross-teacher catalogue on the class page.** By the owner-only assignment invariant (§"copy-not-live-link"), a class can only be assigned activities its owner owns. So another teacher's published activity is **not** addable here — it must first be **adopted** (copy-into-your-library) on the activities-library page's *Shared activities* section (M3), after which the copy appears in *your* activities and becomes assignable like any other. The class page may deep-link to that section ("Browse shared activities →") but performs no cross-owner write. This keeps the student-carried `class:<owner>:<id>` binding the only authority and needs no cross-owner read at resolution time.
- **Sims are reached *through* an activity (resolves [1.1.32 Q3](teacher-ux-refinement.md)).** Because raw-skill assignment goes away, a sim (Boldkast / LED-Planck / KineBot) is no longer separately "added as a lesson"; it is an activity's `artefact_id`. The existing **New activity** button (already on this section, `?classId=` pre-bound) covers it via the [1.1.38 templates](activity-elements-palette.md) that wrap a sim — "New → from a template" mints a library activity (auto-assigned to this class on save) instead of dropping a bare sim skill into `lessons`.

## Migration

Each existing `activity_configs/{teacher}:{class}:{activity}` row → one `Activity` (owner = teacher, content copied, `visibility = private`, minted `act-…` id) **+** an entry in that class's `activity_ids`. The same teacher's identical content across two classes becomes **two** activities (content may have diverged; merging is a teacher action, not a migration guess). A one-shot backfill script + a **dual-read window** (resolve by the new activity id, fall back to the legacy composite key) keeps live pilot sessions working through cutover — the same posture as [1.1.41 M4](teacher-sim-resources.md) (don't migrate live pilot data under load). Record every GCP/Firestore side effect in the migration notes (the Terraform-recipe discipline).

**The bare-lesson case (no `ActivityConfig`).** Because today's "Add from catalogue" assigns **raw skills**, a class's `lessons` may hold a `skill_id` that was *never* wrapped in an `activity_configs` row (a sim or a bare `concept-dialogue` added directly, run with skill defaults). The backfill must not drop these: each such `cls.lessons` entry with no matching config mints a **minimal wrapping `Activity`** (`owner = class owner`, `title` = the skill's `displayName`, `artefact_id` set if the skill is a sim else null, content otherwise empty, `visibility = private`) and adds its `act-…` id to `cls.activity_ids`. After backfill `cls.activity_ids` is the union of (configured activities) ∪ (wrapped bare lessons); `cls.lessons` is read-only legacy during the dual-read window and retired after cutover. Net: no class loses a lesson, and every assignable thing is now an `Activity` (the one-path invariant from [1.1.32 Q3](teacher-ux-refinement.md)).

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 2 | EARNED TRUST | +1 | **Copy-not-live-link across teachers** means a colleague's edit can never silently change your class; provenance (`source_*`) is recorded and shown ("adapted from …"). Visibility is explicit, not inferred. |
| 3 | SKILLS, NOT FEATURES | 0 | Reuses the activity/skill substrate; no new user-facing primitive beyond the library view. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reuses the `tagged` `AccessControl` + `class:<owner>:<id>` namespace (1.A) and the **catalogue + adopt** pattern already shipped for sims (1.1.41) and designed for the sim CMS (1.1.42). No new sharing mechanism invented. |
| 7 | API FIRST | +1 | Every operation (create/edit/assign/duplicate/publish/adopt) is a backend endpoint + CLI command; the library UI is a thin client. |
| 8 | OBSERVABLE | +1 | Adopt/publish/assign emit OTel spans keyed by activity + owner; enables a "most-adopted activities" research signal. |
| 9 | SECURE BY CONSTRUCTION | +1 | Owner-only edit/assign; **copy is the only cross-teacher path** (no direct write to another's class); students still carry only the signed `class:<owner>:<id>` binding, so resolution needs no cross-owner read. |
| 10 | THIN CLIENT | +1 | Assignment, copy, visibility, resolution all server-side; the UI renders the contract. |
| 11 | USABLE BY DESIGN | +1 | Matches the teacher's actual mental model (class → pick activities; take-and-tweak); removes the author-twice friction and the one-concept-activity-per-class wall. |
| | **Net** | **+7** | Threshold ≥ +4. |

## Milestone phasing

Ordered so the **decouple (M0) is independently valuable** (it fixes "many activities per class" even before sharing exists) and each later milestone ships on its own.

| MS | Deliverable | Est | Gate |
|---|---|---|---|
| **M0** | **Activity becomes a class-independent entity.** `Activity` collection + migration from per-class configs + dual-read + student resolution by activity id (running skill resolved from content). Fixes the one-concept-activity-per-class limit. | ~2d | none (foundational) |
| **M1** | **Many-class assignment + the library list + draft/private.** `PATCH /classes/{id}/activities`, "Your activities" view with visibility badges + assign-to-classes multi-select, builder writes to the library. **Re-point the class-detail picker** (§"Add from catalogue → Add activity"): pick from the owner's library, retire `LessonPicker`/`patchLessons`/`listAccessibleSkills`. | ~2d | none |
| **M2** | **Duplicate / branch ("edit on top").** Generalise [1.1.19 M3](teacher-activity-authoring.md) `duplicate` across the library (own + later adopted); "New → from an existing one". | ~1d | none |
| **M3** | **Publish + shared catalogue + adopt.** `publish`/`unpublish`, `GET ?published=true` grouped by owner, the "Shared activities" section + **Use / adapt** (adopt-copy with provenance). | ~2–3d | ✅ **RESOLVED 2026-06-24 (M)** — open trusted-set sharing, copy-on-adopt, no pre-publish gate (see "Sharing decision") |
| **M3b** | **Researcher CRUD-over-all (moderation).** Extend the shipped researcher read-bypass to **write/delete on the `activities` collection** — researcher can edit/unpublish/delete any teacher's activity; `User.is_researcher` guard + `auth.researcher_bypass` OTel span, mirroring `assert_can_read_class`. Reuses the [1.1.5](researcher-role.md) pattern; new is the write path. | ~0.5d | none (decided ↑) |
| **M4** | *(optional)* Attribution display, "most-adopted" research signal, coverage map tie-in ([1.1.19 M8](teacher-activity-authoring.md)). | ~1d | post-M3 |

## Open questions

- **Q1 — copy vs live cross-teacher link. ✅ RESOLVED 2026-06-24 (M): copy.** "Teachers edit their own copies of other teachers' work" → adopt-by-copy (clean ownership, no shared-mutation, explicit provenance). Live-link with a pinned `source_version` stays a Year-2 revisit *if* teachers ask "push my fix to everyone who adopted it."
- **Q2 — own-activity assignment: live or copy?** Recommendation: **live** within one owner (edit once → all the owner's classes). Confirm no teacher wants per-class divergence *without* an explicit duplicate (if they do, they duplicate — that path exists).
- **Q3 — does `published` need review/moderation? ✅ RESOLVED 2026-06-24 (M): no pre-publish gate; researcher post-hoc CRUD-over-all.** Trusted research-mode set → any teacher publishes freely; a `role:researcher` (JB/AR/M) can edit/unpublish/delete **any** activity as the cleanup mechanism (M3b). A formal review/approval gate stays a school-wide-rollout (Year-2) concern, reusing [1.1.42](sim-catalogue-admin.md)'s audited-CMS shape if it ever lands.
- **Q4 — student lesson list = assigned activities (by title), replacing the skill list.** Confirm the `app/lessons` change is acceptable (it is the natural consequence of the decouple) and that activity titles are the right student-facing label.
- **Q5 — naming.** "Library" vs "Activities" vs "Lessons" for the teacher surface; "Use / adapt" vs "Copy" vs "Adopt" for the cross-teacher action; the class-page button ("Add activity" vs "Assign activity" vs keep "Add from catalogue" now meaning *your* activities). Defer to teacher wording (UX copy, JB).
- **Q6 — cross-teacher reuse from the class page.** Recommendation: **no direct cross-teacher add on the class page** — only your own activities are assignable (owner-only invariant); a colleague's activity is adopted on the library page first, then assigned. A convenience **deep-link** ("Browse shared activities →") from the class picker to the library's *Shared* section is in-scope; a one-click "adopt-and-assign-in-place" from the class page is **not** (it would hide the copy/provenance step the trust model depends on). Confirm the deep-link is enough or whether teachers expect to adopt without leaving the class.

## Related documents

- [teacher-activity-authoring.md](teacher-activity-authoring.md) — 1.1.19; the activity definition + the `duplicate`/`source_activity_id` primitive + the option-(B) flag this revisits
- [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) — 1.A; the Class + tagged-ACL primitives + the explicit "cross-teacher sharing is v2" non-goal this fulfils
- [teacher-sim-resources.md](teacher-sim-resources.md) — 1.1.41; the catalogue + adopt pattern for sims, generalised here to activities
- [sim-catalogue-admin.md](sim-catalogue-admin.md) — 1.1.42; the publish/visibility CMS shape (and its researcher-gated moderation, reusable for Q3)
- [activity-elements-palette.md](activity-elements-palette.md) · [curriculum-library.md](curriculum-library.md) — the activity *content* (elements + materials) that travels with a copy
- [researcher-role.md](researcher-role.md) — 1.1.5 / ADR-016; the elevated role for any cross-teacher moderation
