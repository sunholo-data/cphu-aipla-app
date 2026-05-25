# Lesson picker — `/lessons` route that lists what a student can access

**Status**: Planned
**Priority**: P1 (prerequisite for showing skills 1.C / 1.D / future)
**Estimated**: ~0.5 day (FE only — no backend changes)
**Scope**: Frontend
**Dependencies**: v0.1 shipped; `GET /api/skills` already filters via `AccessContext.can_access()` (no API work)
**Created**: 2026-05-24
**Last Updated**: 2026-05-24

## Problem Statement

v0.1 ships with one student-facing skill (`problem-set-hints` paired with the Boldkast sim). After `/group` join, the student is redirected via `POST_JOIN_REDIRECT` env var ([frontend/src/app/group/page.tsx:50](../../../../frontend/src/app/group/page.tsx#L50)) straight to that single chat URL. This works for v0.1's one-skill demo but creates a problem the moment a second skill exists:

- No surface for picking between lessons. The student can't see what else is available.
- No discovery path. New skills onboarded (LED Planck per [1.C](SEQUENCE.md), KineBot per [1.D](SEQUENCE.md)) need a UI entry point — there's no `/skills` index for anon-group users.
- The hardcoded redirect implies "AIPLA = this one tutor" rather than "AIPLA = lesson library."

**Current State:**
- After `/group` join → `router.replace(POST_JOIN_REDIRECT)` → `/chat/@aipla-platform/problem-set-hints` (hardcoded env default)
- `GET /api/skills` exists and is already filtered by `AccessContext.can_access()` ([backend/skills/routes.py](../../../../backend/skills/routes.py)) — for anon-group users that's "public skills only" today; for class-bound students (after [1.A](teacher-permission-model.md)) it'll be "class's lessons + public skills."
- Frontend has no consumer for `/api/skills` in the anon-group flow. The endpoint is wired but unused on that path.

**Impact (if not built):**
- LED Planck (1.C) and KineBot (1.D) — the next two physics skills — have nowhere to land in the student UX. You'd either keep adding hardcoded redirects (one per teacher who wants a default) or punt the lesson-picker question and ship the skills with no entry point.
- Future teacher classes (1.A) will assign multiple lessons. The data flows are ready; the surface isn't.
- The single-skill UX makes AIPLA look smaller than it is — JB's demos benefit from "look, here are several tutors, pick one" even with just 3 lessons.

## Goals

**Primary Goal:** After `/group` join, the student lands on `/lessons` — a page that fetches `GET /api/skills` and renders a card per accessible skill, each linking to `/chat/<skill_path>`. Same surface works whether the user has access to 1 skill or 20.

**Success Metrics:**
- `/lessons` page TTI < 1s on local dev (one API call, no streaming, no LLM).
- Card rendering is responsive — works on mobile (the Jutland-brief "one phone per three students" form factor we already designed for).
- Empty state renders cleanly when the user has access to zero skills: *"Ingen lektioner tilgængelige endnu. Spørg din lærer. / No lessons available yet. Ask your teacher."*
- The same `/lessons` page renders all of: pre-class-binding anon-group users (just public skills), class-bound students post-[1.A](teacher-permission-model.md) (class lessons + public), and authenticated teachers (their owned skills + everything they can access).
- No backend changes — `git diff backend/` empty on this sprint.

**Non-Goals:**
- Search / filtering UI. v1 ships ~3 skills; a simple list is plenty. Search adds when there are >10.
- Skill descriptions richer than what `Skill.description` carries. The skill template already has `description` and `displayName`; the picker renders those, nothing more.
- Per-student lesson history ("continue where you left off"). Sessions are anonymous and ephemeral; that's a v2 feature if it lands at all.
- Teacher-curated lesson order. v1 renders alphabetically by `displayName`; teachers picking order is a 1.A follow-up.
- Replacement for the teacher dashboard. `/lessons` is the *student* surface. Teachers manage classes at `/teacher` (per [1.A](teacher-permission-model.md)).

## Axiom Alignment

Scored per [docs/product-axioms.md](../../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Single API call, no LLM, no streaming — sub-second response is the baseline expectation. Tile-style render lets the eye land on a choice quickly |
| 2 | EARNED TRUST | 0 | UX neutral — student already trusts they're in the right place once they're past `/group` |
| 3 | SKILLS, NOT FEATURES | +1 | Makes the skills-as-the-primary-abstraction visible. v0.1 hid this; v1 surfaces it |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model in this path |
| 5 | GRACEFUL DEGRADATION | +1 | Zero-skill case is explicitly handled with copy that points at the right next step (ask teacher). Failed `/api/skills` request shows a retry button, not a crash |
| 6 | PROTOCOL OVER CUSTOM | +1 | Reuses `GET /api/skills` as-is; reuses `AccessContext.can_access` filter as-is. No new API contract, no new auth shape |
| 7 | API FIRST | +1 | The API existed before the page. Page is a thin consumer |
| 8 | OBSERVABLE BY DEFAULT | 0 | OTel spans from `GET /api/skills` are already emitted; no new instrumentation |
| 9 | SECURE BY CONSTRUCTION | +1 | All access filtering happens server-side via the audited `can_access()`. The client never sees skills it shouldn't; we can't accidentally render an inaccessible one |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Picker is ~150 lines of TSX consuming a typed API; no client-side filtering logic, no client-side state to misalign |
| | **Net Score** | **+7** | Threshold >= +4 OK |

**Conflict Justifications:** None.

## Standards Compliance Check

| Concern | Standard adopted | How |
|---|---|---|
| Lesson listing API | Existing `GET /api/skills` per the template's REST conventions | Zero new endpoints |
| Access enforcement | Existing 5-type `AccessControl` + `AccessContext.can_access()` | Already runs server-side on every `GET /api/skills` |
| Routing | Next.js App Router `/lessons/page.tsx` | Same pattern as `/group`, `/chat/[...path]`, etc. |
| i18n copy | Danish-first with English-as-secondary parenthetical (matches existing `/group` and welcome panel copy) | Same convention as `frontend/src/app/group/page.tsx` |

**No new protocols, no new wire formats, no new access primitives.** Pure consumption of what's already there.

## Design

### Route + redirect change

Two places change:

1. **New** `frontend/src/app/lessons/page.tsx` — renders the list.
2. **Modified** `frontend/src/app/group/page.tsx` — `POST_JOIN_REDIRECT` default changes from `/chat/@aipla-platform/problem-set-hints` to `/lessons`. The env var stays as an override hook (a deployment can still pin a default lesson by setting `NEXT_PUBLIC_POST_JOIN_REDIRECT=/chat/...`).

### Component sketch

```tsx
// frontend/src/app/lessons/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { fetchWithAuth } from "@/lib/apiClient";
import { skillHref } from "@/components/navigation/skillHref";
import { AppFooter } from "@/components/AppFooter";

interface SkillSummary {
  skillId: string;
  ownerId: string;
  slug: string | null;
  name: string;
  description: string;
  displayName?: string;
}

export default function LessonsPage() {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/proxy/api/skills");
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        setSkills(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "unknown");
      }
    })();
  }, []);

  if (error) return <ErrorState detail={error} onRetry={() => setError(null)} />;
  if (skills === null) return <LoadingState />;
  if (skills.length === 0) return <EmptyState />;

  // Sort alphabetically by displayName fallback to name
  const sorted = [...skills].sort((a, b) =>
    (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name),
  );

  return (
    <main className="mx-auto max-w-3xl flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Lektioner / Lessons</h1>
        <p className="text-sm text-muted-foreground">
          Vælg en lektion for at starte. / Pick a lesson to start.
        </p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2">
        {sorted.map((s) => (
          <li key={s.skillId}>
            <Link
              href={skillHref(s)}
              className="block rounded-lg border border-border bg-card p-4 hover:bg-accent transition-colors"
            >
              <h2 className="font-medium">{s.displayName ?? s.name}</h2>
              {s.description && (
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                  {s.description}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <AppFooter />
    </main>
  );
}

function EmptyState() { /* ... bilingual copy ... */ }
function LoadingState() { /* ... skeleton cards ... */ }
function ErrorState({ detail, onRetry }: { detail: string; onRetry: () => void }) { /* ... */ }
```

### `POST_JOIN_REDIRECT` change

```tsx
// frontend/src/app/group/page.tsx (only line 50 area changes)
const POST_JOIN_REDIRECT =
  process.env.NEXT_PUBLIC_POST_JOIN_REDIRECT || "/lessons";  // was: "/chat/@aipla-platform/problem-set-hints"
```

Deployments wanting to pin a default lesson keep the override env var. Cloud Build's `--build-arg NEXT_PUBLIC_POST_JOIN_REDIRECT=...` continues to work.

### Interaction with [1.A teacher-permission-model](teacher-permission-model.md)

When class-binding lands, anon-group JWTs will carry `group_tags={class.tag_namespace}`. `AccessContext.can_access(skill)` then matches skills whose `accessControl.tags` includes the class tag. **The `/lessons` page rendering logic doesn't change** — it still calls `GET /api/skills` and renders whatever comes back. Server-side filtering does the work.

This is the strongest test for the "no fallback paths" discipline we adopted in MCPAPP-SPEC: one render path, one API, one filter — varying input data gives varying output without code branches.

## API Changes

**None.** `GET /api/skills` already exists, already filters, already returns the shape we need.

The existing endpoint returns `SkillSummary[]` per [backend/skills/routes.py](../../../../backend/skills/routes.py). If `displayName` isn't on the response yet but is needed for nicer copy, that's a one-line addition to `SkillResponse` — but check before assuming.

## Migration

- **No data migration.**
- **No feature flag.** Either v1 ships the picker or it doesn't.
- **Rollback:** revert one commit. The `POST_JOIN_REDIRECT` env var continues to work as the override path even after the default flips.

## Testing Strategy

**Frontend (vitest, `npm run test:run`):**

- `frontend/src/app/lessons/__tests__/page.test.tsx` (new):
  - renders N cards when API returns N skills
  - empty state when API returns `[]`
  - error state with retry button when API rejects
  - cards link to `skillHref(skill)` (existing helper) — same URL shape as the inherited template's other skill-link surfaces
  - sort: alphabetical by displayName → name fallback
- Existing `/group` page tests get one new case: post-join redirect goes to `/lessons` by default (not the v0.1 hardcoded URL).

**Manual verification:**

- LOCAL_MODE: join with `local-demo` → land on `/lessons` → see at least `problem-set-hints` listed (v0.1 baseline). Click → reach `/chat/@aipla-platform/problem-set-hints` (unchanged downstream).
- After 1.C lands: same flow shows `problem-set-hints` AND `led-planck-tutor`. After 1.D: + `kinebot-kinematics-tutor`.
- After 1.A lands: a class-bound student sees only their class's lessons; an unbound anon-group user sees only public skills.

## Implementation Plan

| Step | What | Where | Est |
|---|---|---|---|
| 1 | New `/lessons/page.tsx` + Empty / Loading / Error states | `frontend/src/app/lessons/page.tsx` | 0.2 d |
| 2 | Flip default `POST_JOIN_REDIRECT` | `frontend/src/app/group/page.tsx` | 0.05 d |
| 3 | Vitest tests | `frontend/src/app/lessons/__tests__/page.test.tsx` + `/group` existing test update | 0.1 d |
| 4 | Manual verification on LOCAL_MODE | (no edits) | 0.05 d |
| 5 | (Optional, follow-up) Add `displayName` to `SkillResponse` if missing | `backend/skills/routes.py`, `backend/db/models/__init__.py`, test | 0.1 d |
| | **Total** | | **~0.5 d** |

## Success Criteria

- [ ] `/lessons` route renders an alphabetised card list of all skills the user can access.
- [ ] Empty / loading / error states render correctly (vitest + manual).
- [ ] `POST_JOIN_REDIRECT` defaults to `/lessons`; env override still works.
- [ ] `npm run quality:check` green; no backend changes (`git diff backend/` empty unless step 5 runs).
- [ ] After joining via `local-demo` in LOCAL_MODE, student lands on `/lessons` showing at least the v0.1 baseline skill.
- [ ] Mobile rendering verified at 375px width (Jutland-brief shared-phone form factor).

## Out of Scope (deferred)

- Search / filter UI — wait until >10 skills exist.
- "Continue where you left off" per-student history — sessions are anonymous, ephemeral; v2 if at all.
- Teacher-curated lesson ordering — 1.A territory.
- Recommended / featured lesson highlight — pedagogical-design call; not a v1 platform concern.

## Related Documents

- [SEQUENCE.md](SEQUENCE.md) — row 1.B
- [teacher-permission-model.md](teacher-permission-model.md) — 1.A, the model that produces per-class lesson lists this picker renders
- [`led-planck-skill-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/led-planck-skill-brief.md) — 1.C source-of-truth brief in scoping site
- [`kinebot-migration-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/kinebot-migration-brief.md) — 1.D source-of-truth brief in scoping site
- [backend/skills/routes.py](../../../../backend/skills/routes.py) — the API this consumes (untouched by this design)
- [backend/auth/access_context.py](../../../../backend/auth/access_context.py) — the access filter that runs server-side
