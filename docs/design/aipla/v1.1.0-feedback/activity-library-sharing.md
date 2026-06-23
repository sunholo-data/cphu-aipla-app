# Activity library + sharing — activities as class-independent, shareable resources

**Status:** Planned — **POST-PILOT** (the v2 sharing layer both [1.1.19](teacher-activity-authoring.md) and the [permission model](../v1.0.0-pilot/implemented/teacher-permission-model.md) explicitly deferred). A thin **M0 decouple** slice is independently valuable and could land earlier (it also fixes "only one concept activity per class").
**Last Updated:** 2026-06-23
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
| `/api/activities/{id}` | GET / PATCH / DELETE | Read / edit / soft-delete — **owner-only** for PATCH/DELETE; published readable by any teacher | teacher |
| `/api/activities/{id}/duplicate` | POST | Copy → caller's library (sets `source_*`). Source must be owner's **or** `published`. Generalises [1.1.19 M3](teacher-activity-authoring.md). | teacher |
| `/api/activities/{id}/publish` · `/unpublish` | POST | Toggle catalogue visibility (private ↔ published) | teacher (owner) |
| `/api/classes/{class_id}/activities` | PATCH | `{add:[…], remove:[…]}` assign/unassign — **owner's own activities only** | teacher (owner) |

CLI parity: `aiplatform activity new|list|edit|duplicate|publish`, `aiplatform class activities <id> --add/--remove` (extends the shipped `aiplatform class` family from 1.A).

## Teacher UI — the activities library

The activities index ([app/teacher/activities](../../../frontend/src/app/teacher/activities/page.tsx)) becomes a **library**, matching M's "your own at the top, then others' grouped by teacher":

- **Your activities** (top) — cards grouped, each with a **visibility badge** (draft / private / published), the **classes it's assigned to** (chips), and **Assign to classes ▾** (multi-select of the owner's classes), **Edit**, **Duplicate**, **Publish/Unpublish**, **Delete**. "New activity" offers **blank · from a template · from an existing one** (duplicate).
- **Shared activities** (below) — **grouped by owner teacher**, showing each teacher's `published` activities, with attribution and a single **Use / adapt** action → adopt-copy → lands in *Your activities* as a `draft` ready to edit + assign. Reuses the catalogue/adopt affordance shape from [1.1.41 SimPicker](teacher-sim-resources.md) and the by-owner grouping M asked for.

Teacher-auth surface throughout (`useTeacherAuth` / `fetchWithTeacherAuth` — the recurring 401 corner). The student-facing lesson list (`app/lessons`) changes from listing skills to listing the class's **assigned activities** by title.

## Migration

Each existing `activity_configs/{teacher}:{class}:{activity}` row → one `Activity` (owner = teacher, content copied, `visibility = private`, minted `act-…` id) **+** an entry in that class's `activity_ids`. The same teacher's identical content across two classes becomes **two** activities (content may have diverged; merging is a teacher action, not a migration guess). A one-shot backfill script + a **dual-read window** (resolve by the new activity id, fall back to the legacy composite key) keeps live pilot sessions working through cutover — the same posture as [1.1.41 M4](teacher-sim-resources.md) (don't migrate live pilot data under load). Record every GCP/Firestore side effect in the migration notes (the Terraform-recipe discipline).

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
| **M1** | **Many-class assignment + the library list + draft/private.** `PATCH /classes/{id}/activities`, "Your activities" view with visibility badges + assign-to-classes multi-select, builder writes to the library. | ~2d | none |
| **M2** | **Duplicate / branch ("edit on top").** Generalise [1.1.19 M3](teacher-activity-authoring.md) `duplicate` across the library (own + later adopted); "New → from an existing one". | ~1d | none |
| **M3** | **Publish + shared catalogue + adopt.** `publish`/`unpublish`, `GET ?published=true` grouped by owner, the "Shared activities" section + **Use / adapt** (adopt-copy with provenance). | ~2–3d | **JB/M** on cross-teacher sharing scope + any moderation (Q3) |
| **M4** | *(optional)* Attribution display, "most-adopted" research signal, coverage map tie-in ([1.1.19 M8](teacher-activity-authoring.md)). | ~1d | post-M3 |

## Open questions

- **Q1 — copy vs live cross-teacher link.** Recommendation: **copy** (clean ownership, no shared-mutation, explicit provenance — matches M). Alternative: live link with a teacher-pinned `source_version` (updates offered, never forced). Copy is simpler and safer for the pilot; revisit if teachers ask "push my fix to everyone who adopted it."
- **Q2 — own-activity assignment: live or copy?** Recommendation: **live** within one owner (edit once → all the owner's classes). Confirm no teacher wants per-class divergence *without* an explicit duplicate (if they do, they duplicate — that path exists).
- **Q3 — does `published` need review/moderation?** For a 10-teacher pilot, likely **no** (small trusted set; researcher-role can unpublish). A school-wide rollout may want a `role:researcher`/admin moderation gate (reuse [1.1.42](sim-catalogue-admin.md)'s audited-CMS shape).
- **Q4 — student lesson list = assigned activities (by title), replacing the skill list.** Confirm the `app/lessons` change is acceptable (it is the natural consequence of the decouple) and that activity titles are the right student-facing label.
- **Q5 — naming.** "Library" vs "Activities" vs "Lessons" for the teacher surface; "Use / adapt" vs "Copy" vs "Adopt" for the cross-teacher action. Defer to teacher wording (UX copy, JB).

## Related documents

- [teacher-activity-authoring.md](teacher-activity-authoring.md) — 1.1.19; the activity definition + the `duplicate`/`source_activity_id` primitive + the option-(B) flag this revisits
- [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) — 1.A; the Class + tagged-ACL primitives + the explicit "cross-teacher sharing is v2" non-goal this fulfils
- [teacher-sim-resources.md](teacher-sim-resources.md) — 1.1.41; the catalogue + adopt pattern for sims, generalised here to activities
- [sim-catalogue-admin.md](sim-catalogue-admin.md) — 1.1.42; the publish/visibility CMS shape (and its researcher-gated moderation, reusable for Q3)
- [activity-elements-palette.md](activity-elements-palette.md) · [curriculum-library.md](curriculum-library.md) — the activity *content* (elements + materials) that travels with a copy
- [researcher-role.md](researcher-role.md) — 1.1.5 / ADR-016; the elevated role for any cross-teacher moderation
