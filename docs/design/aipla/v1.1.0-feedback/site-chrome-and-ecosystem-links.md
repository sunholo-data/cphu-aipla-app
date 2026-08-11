# Site chrome consistency, a global footer, and ecosystem interlinking

**Status**: **SHIPPED** (M1–M4, 2026-08-11, sprint CHROME-1)
**Priority**: P1 — M4's gate was lifted by M (*"dont worry about timing and pilots"*), so all four shipped together
**Estimated**: ~1.5–2d total (M1 ~0.5d · M2 ~0.4d · M3 ~0.4d · M4 ~0.5d)
**Scope**: Frontend (+ the guide render/publish scripts)
**Sequence**: 1.1.74
**Dependencies**: None blocking. Touches the same chrome as [1.1.63 tutor-register-citation-and-language](tutor-register-citation-and-language.md) M3 (student-UI i18n, DEFERRED) — see *Interaction with 1.1.63 M3*.
**Created**: 2026-08-11
**Last Updated**: 2026-08-11

---

## Problem Statement

The app has grown six framing surfaces (`/`, `/group`, `/guides`, `/project/*`,
`/credits`, `/privacy`, `/terms`, `/workshop`, `/lessons`) with no shared chrome.
Each was built when it was needed, each invented its own container, header, and
back-link, and three of them cannot reach the footer at all. Separately, the
public identity is split across two brand colours and the KU ecosystem pages we
have written are invisible from inside the product.

Audit performed 2026-08-11 against `dev` @ `1c23cc8`. Six concrete findings.

### Finding 1 — the app ships two different brand primaries

[`globals.css:13-15`](../../../../frontend/src/app/globals.css#L13-L15) and
[`:33-34`](../../../../frontend/src/app/globals.css#L33-L34) set
`--primary: 24 95% 53%` in **both** light and dark. Hue 24 is orange — the
inherited Sunholo/Aitana template default. Nobody chose it for AIPLA.

Meanwhile `/project` hardcodes KU red: **24 `red-50/100/800/900/950` utility
occurrences across 5 files** — `project/page.tsx`, `project/[...slug]/page.tsx`,
[`ProjectNavLinks.tsx`](../../../../frontend/src/components/project/ProjectNavLinks.tsx),
`ProjectMarkdown.tsx`, `ProjectArtefactDemo.tsx`.

> **Corrected during implementation.** The first pass of this audit counted 40
> occurrences across 8 files by grepping the `red-700..950` range wholesale.
> Reading them showed that `BackendHealthBadge` (the *backend is down* pill) and
> `LessonRecordingPanel` (the *recording* indicator) use dark red **semantically**,
> not as brand — as do ~30 `red-400/500/600` validation-error usages across the
> teacher editors. Those are correctly red and are out of scope. The real brand
> duplication is the 5 `/project` files. The CI guard is scoped accordingly, with
> the two semantic files allowlisted by name and reason rather than the rule
> being weakened.

The visible consequence: the homepage's primary CTA *"Tilslut din gruppe / Join
your group"* ([`page.tsx:60`](../../../../frontend/src/app/page.tsx#L60)) renders
**orange**, and `/project`'s primary CTA *"Open AIPLA"*
([`ProjectHeader.tsx`](../../../../frontend/src/components/project/ProjectHeader.tsx))
renders **KU red** — both directly beneath the same KU coat-of-arms. A teacher
who follows the link from the ind.ku.dk project page into `/project` and then
clicks through to the app crosses a brand boundary inside one product.

There is no KU-red design token. `/project` is not themed; it is hardcoded.

### Finding 2 — the footer reaches seven surfaces and misses the rest

[`AppFooter`](../../../../frontend/src/components/AppFooter.tsx) is mounted
**per page, by hand**, on: `/`, `/group`, `/credits`, `/privacy`, `/terms`,
`/project` (both routes), and `/teacher/*` (via
[`_TeacherClientShell.tsx:145`](../../../../frontend/src/app/teacher/_TeacherClientShell.tsx#L145)).

It is **absent** from `/guides`, `/lessons`, `/workshop`, `/skills/new`, and
`/dev/*`. Absence from `/chat/*` is deliberate and documented in the component's
own docstring (the chat surface needs the vertical space) — that one is correct
and stays.

So the two non-chat surfaces a real user spends time on — `/guides` (every
teacher and student onboarding path points here) and `/lessons` — have no route
to privacy, terms, or credits without navigating home first. Per-page mounting
is the mechanism, and it has the failure mode every per-page mechanism in this
repo has had: the next page will forget it too.

### Finding 3 — six different page-container recipes, no shared shell

`ls src/components/` contains **no shell, layout, or page component**. Every page
open-codes its container:

| Surface | Container |
|---|---|
| `/` | `flex min-h-screen flex-col items-center justify-center p-8` |
| `/guides` | `mx-auto max-w-3xl px-4 py-10` |
| `/credits`, `/privacy`, `/terms` | `mx-auto flex max-w-2xl flex-col gap-6 p-8` |
| `/workshop` | `max-w-3xl mx-auto px-6 py-12` |
| `/lessons` | `mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6` |
| `/project/[...slug]` | `px-6 py-10 sm:px-10 lg:px-14 lg:py-14` |
| `/teacher/*` | `max-w-6xl` (or `max-w-none` on the builder) |

Four different max-widths, four different horizontal paddings, three different
vertical rhythms. Reading `/guides` then `/credits` back-to-back, the text column
jumps width and the page margin changes.

### Finding 4 — three headers, two back-link idioms, two languages

Three real headers exist: `ProjectHeader` (`/project`), the header inside
`_TeacherClientShell` (`/teacher`), and `SkillsBar` (`/chat`). They share the
logo mark and nothing else.

`/guides`, `/credits`, `/privacy`, `/terms`, and `/workshop` have **no header at
all**. They substitute a hand-rolled back link, in two incompatible idioms:

- [`guides/page.tsx:128-133`](../../../../frontend/src/app/guides/page.tsx#L128-L133) — lucide `ArrowLeft` + `"Home"`, top of page, English.
- [`credits/page.tsx:82-84`](../../../../frontend/src/app/credits/page.tsx#L82-L84), `privacy`, `terms` — a plain `"← Tilbage til forsiden"`, **bottom** of page, Danish.

So the back link is at the top on one page and the bottom on the next, in a
different language, with a different affordance.

### Finding 5 — opening a guide is a one-way trip out of the product

The published guides are self-contained Quarto/Bootstrap HTML in
[`frontend/public/guides/`](../../../../frontend/public/guides/) — `t1-set-up-a-class.html`
is **2.1 MB** and contains **39** bootstrap/quarto references and, critically:

```console
$ grep -o 'href="/[^"]*"' t1-set-up-a-class.html | sort -u
(no output)
```

**Zero links back into the app.** Every guide card on `/guides` opens in a new
tab ([`guides/page.tsx:84`](../../../../frontend/src/app/guides/page.tsx#L84),
`target="_blank"`), into a page with unrelated typography, unrelated colours, no
AIPLA mark, and no way back. This is the surface we point every new teacher at
first, and it is the one that least looks like the product.

### Finding 6 — the ecosystem exists in prose only, and engineering is uncredited

Three canonical ku.dk pages are referenced, and all three are live (verified
2026-08-11):

| URL | What it is |
|---|---|
| `https://www.ind.ku.dk/projekter/artificial-intelligence-in-physics-learning-and-assessment-aipla/` | Official project page — *"Artificial Intelligence in Physics Learning and Assessment (AIPLA)"*, funder **Novo Nordisk Foundation**, period **2026–2028**, project lead JB |
| `https://www.ind.ku.dk/Nyheder/nyheder-2026/aipla/` | Project announcement, 26 Mar 2026 — *"Nyt projekt skal teste AI i fysikklassen: AI må gerne tage det kedelige"* |
| `https://www.ind.ku.dk/` | Department of Science Education (IND) |

They appear **only inside `/project` body markdown** —
[`about.md:80,82`](../../../../frontend/content/project/about.md),
[`progress.md:99`](../../../../frontend/content/project/progress.md),
[`data-and-hosting.md:88`](../../../../frontend/content/project/data-and-hosting.md).
Never in chrome. A student on `/group` or a teacher on `/teacher/classes` has no
path to the authoritative institutional description of the thing they are using.

And nothing in the shipped product credits the platform engineering.
`grep -rn "sunholo.com" frontend/src` returns nothing; the only occurrences are
in design docs and infra notes. `/credits` names Google ADK, Gemini, Claude,
Next.js, and the KU crest's Wikimedia author — but not who built the platform.

**Impact:** all six are first-contact and trust surfaces. Per Axiom 11 (USABLE BY
DESIGN) and Axiom 2 (EARNED TRUST), "who runs this, who paid for it, who built
it, and where is the official record" is not decoration on a research instrument
used by minors in schools — it is the provenance claim. The pilot starts
**2026-08-14, three days from now**, and the guides are the first thing a pilot
teacher opens.

---

## Goals

**Primary Goal:** One footer, structurally present on every framing surface,
carrying the KU ecosystem links and the engineering credit — such that a new
public route cannot ship without it.

**Success Metrics:**

- Footer reachable from **100%** of public framing routes (today: 7 of 11), with `/chat/*` the one documented, tested exemption.
- **One** brand primary in the codebase — zero hardcoded `red-[0-9]{3}` utilities outside a defined token scale (today: 40).
- **One** page-container recipe for prose/framing surfaces (today: 6).
- **Zero** published guide HTML files without a link back into the app (today: 11 of 11 have none).
- The three ind.ku.dk URLs reachable in ≤1 click from any framing surface (today: only from inside `/project` prose).

**Non-Goals:**

- **Re-designing `/project`'s visual identity.** It is the most coherent surface we have; this doc pulls the rest *toward* it, not the reverse.
- **A student-UI i18n pass.** That is [1.1.63](tutor-register-citation-and-language.md) M3 (`next-intl`, ~2–3d, explicitly deferred). This doc keeps the footer's existing bilingual-pair convention and does not extend it.
- **Re-theming the Quarto guides.** M3 adds a navigation band, not a stylesheet. Full guide theming is a follow-up if the band proves insufficient.
- **Touching `/chat/*` chrome.** No footer there, by design.
- **`/dev/*` and `/skills/new`.** Developer surfaces, not public framing. Explicitly excluded and recorded as such.

---

## Axiom Alignment

Scored per [Product Axioms](../../../product-axioms.md). This is a chrome doc, so
most axioms are legitimately neutral — the score is honest rather than padded.

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Static server-rendered links. No fetch, no client JS added. Neutral, not positive. |
| 2 | EARNED TRUST | **+1** | Names the host institution, the funder, and the engineering provider, and links the authoritative KU record. A user can independently verify who runs this. |
| 3 | SKILLS, NOT FEATURES | 0 | Chrome. No skill surface. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model involved. |
| 5 | GRACEFUL DEGRADATION | **+1** | Footer is static markup — works with JS disabled and when the backend is down (unlike the adjacent `BackendHealthBadge`). M3's band survives in a guide HTML saved to disk. |
| 6 | PROTOCOL OVER CUSTOM | **+1** | Uses Next.js **route-group layouts** (framework-native shared chrome) rather than a hand-rolled per-page shell, and **schema.org JSON-LD `sameAs`** rather than ad-hoc "related links" markup. See *Standards & framework-native checks*. |
| 7 | API FIRST | 0 | No API surface. |
| 8 | OBSERVABLE BY DEFAULT | 0 | No new telemetry. Outbound clicks deliberately untracked (see *Security*). |
| 9 | SECURE BY CONSTRUCTION | 0 | No new data access. Adds `rel="noopener noreferrer"` + a referrer policy on outbound links so group codes in a URL can never leak via `Referer`. Defensive, not a new guarantee. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | No protocol change. |
| 11 | USABLE BY DESIGN | **+1** | The axiom this doc exists to serve. Two brand colours, a dead-end guide, and a back link that moves between top and bottom are precisely the first-contact damage #11 was added to catch. |
| | **Net Score** | **+4** | Threshold: >= +4 — **met, exactly.** |

**Hard-fail checks:** zero axioms score -1. #11 is +1 (not -1) on a
student-facing surface. #2 is +1. #9 is 0 with no new data access. **Passes.**

**Conflict Justifications:** none — no axiom scored -1.

---

## Standards & framework-native checks

Per the design-doc skill's steps 5b and 5b-ter: prove the framework does not
already do this before specifying custom plumbing.

**Next.js App Router route groups — this is the native mechanism, and we are not
using it.** `app/(group)/layout.tsx` applies shared chrome to a set of routes
**without changing their URLs**. That is exactly the problem here, and today the
repo solves it by importing `AppFooter` into each page by hand. Verified against
the installed Next.js 15 App Router conventions; `app/project/layout.tsx` and
`app/teacher/layout.tsx` already demonstrate nested layouts working in this repo,
so nothing new is required — only a directory grouping. **Using it makes the
footer structural instead of opt-in, which removes the forget-it failure mode
rather than guarding against it.**

**schema.org / JSON-LD `sameAs`** is the established standard for "this web
presence is the same entity as those other web presences". We already emit Open
Graph metadata in [`layout.tsx:17-22`](../../../../frontend/src/app/layout.tsx#L17-L22),
so structured metadata is an existing idiom here, not a new dependency. Using
`ResearchProject` + `sameAs` pointing at the ind.ku.dk pages expresses the
ecosystem relationship machine-readably instead of inventing a "related links"
convention. Adopted in M2b (optional).

**No custom plumbing is proposed.** No new store, no side-channel, no injection
hook. The one script change (M3) extends the existing
[`scripts/publish-guides.sh`](../../../../scripts/publish-guides.sh) rather than
adding a parallel pipeline.

**CLI affordance (step 5b-bis): none needed.** This is chrome plus one extension
to an existing script. The skill's own skip rule covers it: *"pure frontend
features with no developer-facing API (e.g., a CSS refactor, a Tailwind theme
tweak)"*. M3 does change guide publishing, so the
[`guide-maintenance`](../../../../.claude/skills/guide-maintenance/SKILL.md) skill
gets a line — that is the correct home for it, not a new `aiplatform` command.

---

## Design

### Overview

Four milestones, ordered so that everything additive and pilot-safe lands first
and the one visible change lands last, behind an explicit decision.

1. **M1 — a `(site)` route group** carrying one header, one container, one footer. Structural, so it cannot be forgotten.
2. **M2 — footer content:** the KU ecosystem links and the Sunholo engineering credit.
3. **M3 — guides stop being a dead end:** a navigation band injected at publish time.
4. **M4 — one brand primary (KU red).** Visible, sitewide, and therefore **gated** — see *Rollout risk*.

### M1 — the `(site)` route group

```
src/app/
  (site)/
    layout.tsx        ← SiteHeader + <main class="site-container"> + SiteFooter
    page.tsx          ← was app/page.tsx            (URL "/" unchanged)
    guides/page.tsx   ← was app/guides/page.tsx     (URL "/guides" unchanged)
    credits/page.tsx
    privacy/page.tsx
    terms/page.tsx
    workshop/page.tsx
    group/page.tsx
    lessons/page.tsx
    project/          ← keeps its own nested layout (header + sidebar); inherits the footer
  chat/               ← OUTSIDE the group. No footer, by design.
  teacher/            ← OUTSIDE. Has its own shell; keeps its own footer mount.
  dev/, skills/, api/ ← OUTSIDE. Not public framing.
```

Route groups do not affect URLs — `app/(site)/guides/page.tsx` still serves
`/guides`. The move is `git mv` only; no route, no import path inside the pages,
and no test that references a component changes.

**New components** (`src/components/site/`):

- `SiteHeader.tsx` — logo mark + app name + a small nav (`Guides` · `About the project` · the primary CTA). `ProjectHeader` collapses into a variant of this rather than staying a separate component; it already has the right shape.
- `SiteFooter.tsx` — `AppFooter` renamed and extended (M2). Keeps the current slim top row so nothing regresses if M2 is descoped.
- `PageContainer.tsx` — the one container: `mx-auto w-full max-w-3xl px-4 py-10 sm:px-6`. `max-w-3xl` because it is the widest of the current prose recipes and the one `/guides` already uses; `/project` and `/lessons` opt out via a `width` prop (`prose | wide | full`).

**Deleted:** the five hand-rolled back links (Finding 4). The header is the back
affordance, in one place, in one idiom.

**The guard.** A vitest test enumerates `src/app/**/page.tsx`, derives each
route, and asserts every public route is either inside `(site)` or on an explicit
exemption list (`chat`, `teacher`, `dev`, `skills`, `api`). Adding a new public
page outside the group fails CI with a message naming the file. This is the
`check-skill-catalogue.sh` / `audit-trust-cards.sh` idiom — the repo's footgun
table calls per-page-mounting patterns *partly enforced* at best, and this moves
the row to **enforced**.

### M2 — footer content

Three link columns plus an attribution block. Collapses to a single stacked
column below `sm`.

```
────────────────────────────────────────────────────────────────
 [KU crest]  AIPLA — AI in Physics Learning and Assessment

 Projektet / The project      Appen / The app       Om / About
 · Official project page ↗    · Guides              · Privacy
 · Project announcement ↗     · Join your group     · Terms
 · Department (IND) ↗         · Teacher sign-in     · Credits
                                                    · About AIPLA

 Hosted by Institut for Naturfagenes Didaktik, Københavns
 Universitet. Funded by the Novo Nordisk Foundation, 2026–2028.

 AI platform engineering by Sunholo ↗
────────────────────────────────────────────────────────────────
```

- The three `↗` links in column 1 are the Finding 6 ku.dk URLs, `target="_blank"`, `rel="noopener noreferrer"`.
- *"AI platform engineering by Sunholo"* → `https://www.sunholo.com`, same rel treatment. One line, no logo — it sits below the institutional attribution, not beside it, because the institution is the host and the engineering is a supplier.
- The existing bilingual-pair convention (`Danish / English`) is preserved for column headings. Link labels stay as they are today so nothing needs re-translating ahead of 1.1.63 M3.
- `/credits` remains the full attribution page; the footer's credit line is a pointer, not a replacement.

**M2b (optional, ~0.1d).** A `ResearchProject` JSON-LD block in the `(site)`
layout with `sameAs` listing the three ind.ku.dk URLs, `funder: Novo Nordisk
Foundation`, and `parentOrganization: University of Copenhagen`. Machine-readable
ecosystem relationship; costs one `<script type="application/ld+json">`.

### M3 — the guides stop being a dead end

Extend [`scripts/publish-guides.sh`](../../../../scripts/publish-guides.sh) to
inject a small fixed band into each published HTML immediately after `<body>`:

```html
<div style="…inline, self-contained…">
  <a href="/">AIPLA</a>
  <a href="/guides">All guides</a>
  <a href="/project">About the project</a>
</div>
```

Inline styles and absolute in-app hrefs, deliberately: the guides are
`embed-resources: true` self-contained Quarto output that people also download
and email, so the band must not depend on the app's stylesheet, and it must
degrade to plain text when the file is opened from disk.

**Guard:** publish fails if any file in `frontend/public/guides/*.html` lacks the
band marker. Same shape as the existing
[`scripts/check-guide-staleness.sh`](../../../../scripts/check-guide-staleness.sh).

The [`guide-maintenance`](../../../../.claude/skills/guide-maintenance/SKILL.md)
skill gains a line describing the band so a future re-render does not silently
drop it.

### M4 — one brand primary (KU red) — **gated**

```css
:root {
  --brand:            0 60% 33%;   /* KU red #901A1E — to be confirmed against KU brand guidance */
  --brand-foreground: 0 0% 100%;
  --primary:          var(--brand);
  --ring:             var(--brand);
}
```

Then replace the 40 hardcoded `red-700/800/900/950` utilities with
`bg-primary` / `text-primary` / `border-primary` and a `brand` scale in
`tailwind.config`, so `/project`'s gradient hero has named stops instead of
literals.

**Why KU red rather than keeping orange:** the app is served under the KU
coat-of-arms, at `aipla.ku.dk`, hosted by IND. The orange is an inherited
template default that no AIPLA decision ever selected. One of the two must go,
and the institutional signal is the one with a reason behind it.

**Verify contrast, don't assume it.** KU red on white and white on KU red must
both clear WCAG AA 4.5:1 — asserted in a unit test rather than eyeballed, because
`--primary` also drives small text (`text-primary` on the teacher avatar chip at
[`_TeacherClientShell.tsx:121`](../../../../frontend/src/app/teacher/_TeacherClientShell.tsx#L121)).

---

## Rollout risk — read before approving M4

**The pilot starts 2026-08-14. This doc is dated 2026-08-11.**

M1, M2, M3 are additive: a footer appears, links appear, guides gain a band.
Nothing a teacher already relies on changes shape. These are safe to ship into
the pilot window.

**M4 recolours every primary button in the product**, on both the teacher and
student surfaces, three days before teachers first use it in a classroom. The
change is correct and it is also the kind of change that generates *"did
something break?"* messages during the one week where that question is expensive.

**Recommendation: ship M1–M3 now; hold M4 for an explicit go/no-go.** Either
land it now as a deliberate decision, or take it in the first post-pilot window
when a visual change costs nothing. The inconsistency has existed since the fork
and survives another fortnight without harm. What it should *not* do is land by
default as a side effect of approving the rest of the doc — hence this section.

If M4 is deferred, M1–M3 leave it strictly easier: the `(site)` group and the
token indirection are exactly the seams the recolour needs.

**Also worth an explicit choice: route group vs. opt-in component.**

| | **A — `(site)` route group** (recommended) | **B — `PageShell` component** |
|---|---|---|
| Mechanism | Framework-native nested layout | A component each page imports |
| Forget-it failure mode | Impossible — chrome is structural | Still possible; guarded by a test |
| Cost | `git mv` of 8 route directories | No file moves |
| Risk near the pilot | Low but non-zero (directory moves) | Lower |

A is the better design and the one this doc specifies. B is the pilot-safe
fallback and is a ~1h swap if the directory moves feel wrong this week.

---

## Implementation Plan

### M1 — `(site)` route group + shared chrome (~0.5d)

- [ ] Create `src/components/site/{SiteHeader,SiteFooter,PageContainer}.tsx`; `SiteFooter` starts as today's `AppFooter` markup (~120 LOC total)
- [ ] `git mv` the 8 framing route dirs into `src/app/(site)/`; add `(site)/layout.tsx` (~30 LOC)
- [ ] Delete the 5 hand-rolled back links; remove the per-page `AppFooter` imports (~-40 LOC)
- [ ] Fold `ProjectHeader` into a `SiteHeader` variant; `/project` keeps its sidebar layout (~-30 LOC)
- [ ] Route-coverage vitest guard + exemption list (~60 LOC)

### M2 — footer content + ecosystem links (~0.4d)

- [ ] Three-column footer + attribution block, stacking below `sm` (~90 LOC)
- [ ] The three ind.ku.dk links and the sunholo.com engineering credit, with `rel` + referrer policy
- [ ] *(M2b, optional)* `ResearchProject` JSON-LD with `sameAs` (~20 LOC)
- [ ] `SiteFooter` render tests: all four external hrefs present, all carry `rel="noopener noreferrer"`

### M3 — guides gain a navigation band (~0.4d)

- [ ] Band injection in `scripts/publish-guides.sh` (~25 LOC shell)
- [ ] Publish-time assertion that every `public/guides/*.html` carries the marker (~15 LOC)
- [ ] Re-publish the 11 existing guides
- [ ] One-line addition to the `guide-maintenance` skill

### M4 — one brand primary (~0.5d) — **gated on the go/no-go above**

- [ ] `--brand` token + `brand` scale in `tailwind.config`; `--primary`/`--ring` point at it (~25 LOC)
- [ ] Replace the 40 hardcoded `red-*` utilities across the 8 files
- [ ] WCAG AA contrast unit test for `--brand` against `--brand-foreground` and `--background`
- [ ] Grep guard: no literal `red-[0-9]{3}` outside the token definition (folds into the existing `local-mode-safety` CI job)

---

## Migration & Rollout

**Database migrations:** none.
**Feature flags:** none. M4's gate is a merge decision, not a runtime flag — a
half-recoloured product behind a flag is worse than either end state.
**Environment variables:** none.

**Rollback plan:** M1–M3 are self-contained frontend commits; revert individually.
M4 is a token change plus mechanical utility replacement — `git revert` restores
orange in one commit.

**Deploy path:** `dev` → tag → test → `make promote` to prod, per
[deploy.md](../../../ops/runbooks/deploy.md). **No `cloudbuild.promote.yaml` twin
is needed** — this adds no `--set-env-vars` and no `--build-arg`, so the
promote-parity footgun in CLAUDE.md does not apply here. Worth stating explicitly
since that row has been re-opened three times.

---

## Testing Strategy

### Frontend (Vitest + RTL)

- [ ] **Route coverage:** every `src/app/**/page.tsx` is inside `(site)` or on the exemption list — the M1 guard
- [ ] `(site)/layout.tsx` renders `SiteFooter` for a representative child
- [ ] `SiteFooter`: the three ind.ku.dk hrefs and `https://www.sunholo.com` are present and all carry `rel="noopener noreferrer"`
- [ ] `/chat/*` renders **no** footer (locks the deliberate exemption so a later refactor can't quietly add one)
- [ ] `PageContainer` width variants produce the expected classes
- [ ] *(M4)* `--brand` clears 4.5:1 against both `--brand-foreground` and `--background`

### Backend (pytest)

None — no backend surface.

### Manual

- [ ] Walk `/` → `/guides` → open T1 → band → back to `/guides` → `/project` → `/privacy`: container width, header, and footer are stable throughout
- [ ] Footer at 375 px: three columns stack, nothing overflows horizontally
- [ ] A downloaded guide HTML opened from `file://` still shows a legible band
- [ ] Group-code URL (`/group?code=…`) → click an outbound footer link → confirm no code in the `Referer` header

### CI parity before pushing

Per CLAUDE.md's pre-push gotcha: `cd frontend && npm run quality:check` (full —
tests **and** build), not the `:fast` variant.

---

## Security Considerations

- All outbound links: `target="_blank"` + `rel="noopener noreferrer"`.
- **Referrer leakage is the one real risk.** The class join link is a full URL carrying the group code (`…/group?code=`), and a default `Referer` on an outbound click would send that code to ind.ku.dk and sunholo.com. Footer external links set an explicit referrer policy so the code cannot leave the origin this way. Covered by a manual check above; worth a follow-up if we ever add more outbound links.
- No new data access, no new endpoint, no auth surface — so **neither** the dual-auth footgun nor the anonymous-group corner case is in play here. Stated explicitly because CLAUDE.md asks for that check on every identity-adjacent change, and the honest answer is that this one is not identity-adjacent.
- No outbound-click tracking. A research instrument used by minors does not need analytics on whether someone clicked the department's website.

---

## Performance Considerations

- Footer is static server-rendered markup. No client JS, no fetch. Bundle impact ≈ 0.
- The M3 band adds ~400 bytes to 2.1 MB guide files — immaterial.
- Route groups are a compile-time concern; no runtime cost.

---

## Success Criteria

- [ ] `npm run test:run` passing, including the new route-coverage guard
- [ ] `npm run quality:check` clean (lint + typecheck + tests + build)
- [ ] Every public framing route renders the footer; `/chat/*` provably does not
- [ ] The three ind.ku.dk pages and `https://www.sunholo.com` are ≤1 click from any framing surface
- [ ] All 11 published guides carry a working band back into the app
- [ ] One page-container recipe for prose surfaces; the five hand-rolled back links are gone
- [ ] *(M4, if approved)* zero hardcoded `red-[0-9]{3}` outside the token scale; contrast test passing

---

## Open Questions

1. **M4 now or post-pilot?** The doc recommends post-pilot. Needs an explicit call — see *Rollout risk*.
2. **Route group (A) or `PageShell` component (B)?** Recommends A. B is the pilot-safe fallback.
3. **Does the footer name the funder?** *"Funded by the Novo Nordisk Foundation, 2026–2028"* is taken from the public ind.ku.dk project page, so the fact is public. Funders often prescribe attribution wording, though — **JB should confirm the phrasing** before it ships on every page. Trivially droppable if the answer is slow.
4. **Exact KU red.** The doc assumes `#901A1E`. `/project` currently uses Tailwind `red-800` (`#991b1b`), which is close but not KU's. Someone should check the current KU brand guidance rather than us picking a plausible hex.
5. **Are there more ecosystem pages?** Three ind.ku.dk URLs were found in the repo and both content pages were verified live. If a **Center for Digital Education** page exists (CLAUDE.md names CDE as the programme home but no URL appears anywhere in the repo), it belongs in column 1. Same question for any sibling KU AI-project pages worth cross-linking.
6. **`/lessons` — framing or app?** Placed inside `(site)` here, but it is a student working surface and may want the chat treatment (no footer) instead. Low stakes; easy to move.

---

## Interaction with 1.1.63 M3

[1.1.63](tutor-register-citation-and-language.md) M3 (student-UI i18n via
`next-intl`, ~2–3d) is deferred, and its doc notes a planned CI guard against new
literal Danish in student components. This doc **adds** literal bilingual strings
to the footer — the same convention `AppFooter` already uses today, so it does
not make the eventual extraction meaningfully worse, but it is one more file for
that pass to touch. Flagging it so 1.1.63 M3 does not discover it as a surprise.

---

## Related Documents

- [AppFooter.tsx](../../../../frontend/src/components/AppFooter.tsx) — the component this generalises
- [handover-maintainability-audit.md](handover-maintainability-audit.md) — P1 "drive every footgun row to *enforced*"; the M1 route-coverage guard is one such row
- [tutor-register-citation-and-language.md](tutor-register-citation-and-language.md) — 1.1.63, the deferred i18n pass
- [guide-maintenance skill](../../../../.claude/skills/guide-maintenance/SKILL.md) — the render/publish pipeline M3 extends
- [product-axioms.md](../../../product-axioms.md) — Axioms 2 and 11
- [deploy.md](../../../ops/runbooks/deploy.md) — promotion path
