# Sprint Plan: CHROME-1 — site chrome, global footer, ecosystem interlinking

## Summary

Ship all four milestones of
[site-chrome-and-ecosystem-links.md](site-chrome-and-ecosystem-links.md) (1.1.74).

**Duration:** ~1.5–2 days
**Scope:** Frontend + the guide publish script
**Dependencies:** none
**Risk Level:** Low (M1–M3, additive) → Medium (M4, sitewide recolour)
**Design Doc:** [site-chrome-and-ecosystem-links.md](site-chrome-and-ecosystem-links.md)

## Locked decisions (open questions resolved 2026-08-11)

| # | Question | Decision | Basis |
|---|---|---|---|
| 1 | M4 now or post-pilot? | **Now.** All four milestones ship in this sprint | M: *"dont worry about timing and pilots"* |
| 2 | Route group (A) or `PageShell` (B)? | **A — `(site)` route group** | Design-doc recommendation; makes the footer structural, not opt-in |
| 3 | Name the funder in the footer? | **Yes** — *"Funded by the Novo Nordisk Foundation, 2026–2028"* | Public fact on the authoritative ind.ku.dk project page. Wording is one line and trivially revised if JB prefers different phrasing |
| 4 | Exact KU red | **`#901A1E` → `hsl(358 69% 33%)`** | The repo's own `aipla-mark.svg` uses `#901a1e`, and [`branding.ts`](../../../../frontend/src/lib/branding.ts) describes that mark as *"KU red on a rounded white tile"*. `designguide.ku.dk` publishes its palette only as downloadable PDF/swatch files, so the in-repo mark is the best authoritative source we have. `/project`'s current Tailwind `red-800` (`#991b1b`) is close but is not KU's |
| 5 | More ecosystem pages? | **Yes — a fourth link.** [Center for Digital Education (CDE)](https://www.ind.ku.dk/english/research/center-for-digital-education/) is live and **features AIPLA on its own news section** | Found 2026-08-11. CLAUDE.md names CDE as the programme home; this is its page |
| 6 | `/lessons` — framing or app? | **Own-shell.** Stays outside `(site)`, mounts `SiteFooter` itself | It has bespoke contextual chrome (a group-code bar with change-code/leave actions). A `SiteHeader` above that would be two headers. Same treatment as `/teacher` |

### Dark-mode contrast — a real finding from doing the maths

KU red `hsl(358 69% 33%)` scores **8.9:1** against white — excellent for
`bg-primary` + white text in light mode. Against the **dark** background
(`hsl(222.2 84% 4.9%)`) it scores **~2.2:1**, which fails.

So dark mode gets a lightened brand: **`hsl(358 69% 45%)`**, which holds
**5.4:1** white-on-red. The design doc said *assert, don't eyeball* — this is why.
A contrast unit test locks both modes.

One knock-on: the teacher avatar chip
([`_TeacherClientShell.tsx:121`](../../../../frontend/src/app/teacher/_TeacherClientShell.tsx#L121))
uses `bg-primary/10 text-primary`, i.e. brand-coloured *text*, which is the one
usage that cannot clear AA on a dark page at any brand lightness that also works
as a fill. It moves to `text-foreground` on the tint.

## Milestones

### M1 — `(site)` route group + shared chrome (~0.5d)

- `src/lib/ecosystem.ts` — the four ku.dk URLs + the sunholo.com credit, one source of truth
- `src/components/site/{SiteHeader,SiteFooter,PageContainer}.tsx`
- `src/app/(site)/layout.tsx`; `git mv` 7 route dirs in (`/`, `guides`, `credits`, `privacy`, `terms`, `workshop`, `group`, `project`)
- Delete `AppFooter.tsx`; repoint `/teacher` and `/lessons` at `SiteFooter`
- Delete the 5 hand-rolled back links
- Fold `ProjectHeader` into a `SiteHeader` variant

**Exit:** every public framing route renders header + container + footer; URLs unchanged.

### M2 — footer content + ecosystem links (~0.4d)

- Three-column footer, stacking below `sm`
- Column 1 = the four ind.ku.dk links; attribution block = host + funder; credit line = *"AI platform engineering by Sunholo"* → `https://www.sunholo.com`
- `rel="noopener noreferrer"` + `referrerPolicy="no-referrer"` on every outbound link (the group-code leak)
- `ResearchProject` JSON-LD with `sameAs` (M2b)

**Exit:** four ku.dk pages + sunholo.com reachable in ≤1 click from any framing surface.

### M3 — guides stop being a dead end (~0.4d)

- Band injection in `scripts/publish-guides.sh`, inline-styled, absolute in-app hrefs
- Publish-time assertion that every `public/guides/*.html` carries the marker
- Re-publish the 11 guides
- One line in the `guide-maintenance` skill

**Exit:** `grep -L 'aipla-guide-nav' frontend/public/guides/*.html` returns nothing.

### M4 — one brand primary (~0.5d)

- `--brand` / `--brand-foreground` tokens; `--primary`/`--ring` point at them; dark override at 45%
- `brand` scale in `tailwind.config.ts`
- Replace the 40 hardcoded `red-*` utilities across 8 files
- WCAG AA contrast test (both modes) + a grep guard against new `red-[0-9]{3}`

**Exit:** zero hardcoded `red-[0-9]{3}` outside the token scale; contrast test green.

## Guards shipped with the sprint

| Guard | Catches |
|---|---|
| Route-coverage test | A new public page added outside `(site)` without an explicit exemption |
| Own-shell footer test | `/teacher`, `/lessons` silently losing their `SiteFooter` mount |
| `/chat/*` no-footer test | A refactor quietly adding a footer to the chat surface |
| Guide-band publish assertion | A re-render dropping the nav band |
| Contrast test | A brand-colour tweak that fails AA in either mode |
| `red-[0-9]{3}` grep guard | Re-introducing a hardcoded brand colour |

## Order of execution

M1 → M2 → M4 → M3. M3 last because re-publishing 11 × 2.1 MB guides is the
noisiest diff and is independent of the rest.

## Verification

`cd frontend && npm run quality:check` (full CI parity — lint + typecheck +
tests + build), per CLAUDE.md's pre-push gotcha. Plus a manual walk of
`/` → `/guides` → a guide → back → `/project` → `/privacy`.
