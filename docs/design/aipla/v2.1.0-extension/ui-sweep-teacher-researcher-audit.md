# Teacher and researcher UI: simplification audit

Status: audit, 2026-11-09, read-only. Nothing under `frontend/`, `backend/` or `scripts/` was changed.
Baseline: `dev` at `8fd71b5d`. Static reading only; the app was not run.
Paths are relative to `frontend/src/` unless they start with `frontend/` or `messages/` (= `frontend/messages/`).

Mockups: [Teacher and researcher views](https://claude.ai/artifact/6jGYs9q8quGpfHoYTowRJ8) (2026-11-11, 12 boards; private, share from its menu). M approved all of them on 2026-11-11 for a build to test, for researcher feedback.

Why: teachers in the 5-school pilot (sessions from 26 Nov 2026) said "the UI needs to be simpler, a lot going on". The rule for this sweep is **simplify without dropping a feature**. Every proposal below names where a relocated feature goes, and the checklist near the end lists what a later build must still offer.

Method: per page, (a) purpose, (b) feature inventory, (c) first-render visual load, (d) duplication, (e) proposals, (f) `ui-guidelines-check` findings. The rules are `.claude/skills/ui-guidelines-check/SKILL.md` plus Vercel's `command.md`, which was fetched (191 lines) on 2026-11-09. Upstream's own simplification commits (`07d73646`, `5d1ae76b`, `faa341d1`) were read for patterns.

## Summary

| # | Simplification (all features kept) | Effort | Pages |
|---|---|---|---|
| 1 | **Fix what makes a teacher distrust the screen, before any layout work.** <br>• Failed loads that render as "you have none": classes-list insights and recent sessions, class-page recent sessions and assigned activities, SimPicker, `_BudgetPanel.tsx:55`, CustomApproachPanel. These need a message and Retry. <br>• Four editor links drop `classId`, so the "inherited tutor" box says "default tutor" when the class has chosen one. <br>• The "Beskeder 7 d" column header stays the same on 30-day and all-time views. <br>• The editor's fake "Code" tab shows "Open question for M/JB" to every teacher. | S each, ~2d total | classes, classes/[id], activities, activities/[id], insights, programme, research/frameworks |
| 2 | **Class page.** <br>• Split the page into Lesson / After the lesson / Setup views, kept in the URL. <br>• Merge the four lists of groups (Live, Groups/codes, Class list, Recent activity) into one table with a ⋯ menu per row. <br>• This cuts about 90 controls on one scroll. | M–L | classes/[id] |
| 3 | **Give each duplicated view one home.** <br>• `CrossClassTable` renders on both `/teacher/classes` (the "insights & spend" panel) and Insights → Overview. <br>• The Insights nav entry lands on Overview instead of Lessons. <br>• The researcher scope switch exists in three places under two names. | M | classes, insights |
| 4 | **Activity editor without tabs.** <br>• Remove the Code mock and fold History into one line. <br>• One "Add to the workspace" menu replaces nine always-open optional blocks and an inline grid of 11 sims. <br>• The create and edit pages share the form, so one change fixes both. | M | activities/new, activities/[id] |
| 5 | **Activity library shows one list at a time** (Mine / Shared / All teachers, kept in the URL). Each card keeps Edit; the other row actions go into a ⋯ menu. | M | activities |
| 6 | **Library management in one place.** <br>• `/teacher/materials` keeps the folder and delete controls. <br>• The builder's materials section keeps search, upload and add only. | M | materials, activities builder |
| 7 | **Shell and copy.** <br>• Move Vejledninger from the nav into the help button. <br>• Rename the account menu's "Tilgange" to "Tutorer". <br>• Change the "Oversigt/Dashboard" breadcrumb to "Klasser", and "ture" to "beskeder". <br>• Stop translating "construct" as "begreb", which collides with physics concepts. <br>• Adopt the UI kit (`useConfirm`, `Spinner`, skeletons, `Button pending`) file by file. | S–M | all |
| 8 | **Researcher tools behind fewer doors.** <br>• Research → frameworks goes from 7 tabs to 4 for researchers and from 5 to 3 for teachers. <br>• Judge lenses move off Settings to sit next to Calibration. <br>• Programme gets "Grant…" on each request row. | M | research/frameworks, settings, programme |

Items 1 and 7 (copy only) are worth doing before 26 Nov. Items 2–6 change where a teacher finds things mid-pilot, so they need M's call on timing (see open questions).

## Cross-cutting findings

### Navigation

- **Nav destinations** (`components/teacher/ui/TeacherNav.tsx:50-130`):
  - Every teacher gets Klasser, Aktiviteter, Materialer, Indsigt and Vejledninger.
  - Simuleringer is added when the feature flag is on. It shows greyed with a lock when this teacher has no access.
  - Programmet is added for researchers and programme admins.
  - That is up to **7 items in the phone bottom bar** at 11px (`TeacherNav.tsx:227`). The code comment at `:224-226` already records "Vejledninger" being cut off.
- **Vejledninger is reference material, not a place a teacher goes every session.** That is the same reason Settings left the nav in 1.1.125 (`TeacherNav.tsx:70-72`). Move it into the help entry: the header's "Hjælp"/"Spørg AIPLA" button becomes a two-item menu, "Vejledninger" plus "Spørg AIPLA Hjælp". This takes the teacher bottom bar from 5 items to 4 and the researcher bar from 7 to 6.
- **Insights lands on the wrong tab.** The nav goes to `/teacher/insights`, which is the Overview tab. `InsightsTabs.tsx:26-27` puts Lessons first on purpose.
- **No skip link.** Neither `app/layout.tsx` nor the teacher shell has a "skip to main content" link. Add one in `app/teacher/_TeacherClientShell.tsx` before the header, pointing at the `<main>` at `:183`.
- **Breadcrumbs name a page that does not exist.** The class page, the group report and Insights call the class list "Dashboard"/"Oversigt" while the nav calls it "Klasser" (`ClassDetailPage.breadcrumb`, `TeacherGroupReportPage.dashboard`, `app/teacher/insights/page.tsx:83`).
- **State is not in the URL.** Search, filters, the scope switch, the insights window, the compare selection, class-page sections and the conversations and programme tabs are all `useState` only. The exceptions are the activity library's `?scope=all` and the lesson page's `?date=`. A teacher who refreshes or shares a link loses their place.

### Duplicated entry points

| Thing | Where it is reachable | Proposal |
|---|---|---|
| Cross-class engagement table (`CrossClassTable`) | `/teacher/classes` "Show insights & spend" panel (with a spend column) and Insights → Overview | One home: Insights. The classes page links to it. Overview becomes researcher-only "All classes", or keeps the spend column (open question 2) |
| Researcher "mine vs all" scope | Classes ("My classes \| Research view"), Insights Overview ("My classes \| All teachers"), Activities `?scope=all` | One name and one control shape, everywhere |
| Spend per class | Classes table column, class page `BudgetPanel`, Insights → Cost → By class, Programme register `_BudgetPanel` | Class page for one class; Cost for all. The classes-list column goes with the panel |
| Teaching approach / tutor | Account menu "Tilgange" → `/teacher/research/frameworks`, and the class page's Tutor setting | Already flagged as JB/AR's call (`AccountMenu.tsx:17-18`). Renaming to "Tutorer" makes both entries point at the same idea |
| Judge (fidelity) instrument | Configured on Settings (lenses), calibrated on Research → Calibration, corrected in group reports | Lenses go next to Calibration under a researcher "Research tools" tab |
| Material library management | `/teacher/materials` and the builder's Materials section, which both mount `MaterialsSection` with full folder and delete controls | Manage on `/materials`, pick in the builder |
| A class's groups | Live, Groups/codes, Class list (local names), Recent activity, all on one class page | One table |
| Group activity counts | Group report "At a glance" and "What the group did" | Show once |
| Help | Nav "Vejledninger", header "Hjælp" (help co-pilot), guide PDFs | One help menu in the header |

### Header and menus (`app/teacher/_TeacherClientShell.tsx`, `components/teacher/ui/AccountMenu.tsx`, `components/teacher/copilot/AskAiplaButton.tsx`)

- The header has the brand, one AI button, a LOCAL_MODE pill (local only), a "Forsker" pill (researchers) and the account menu. That is already lean.
- Upstream's `faa341d1` did the same consolidation, plus keyboard handling that this fork lacks (see the shell section, f).
- The copilots are already behind one header button (1.1.125 M3). That matches upstream's one-entry direction; no change is needed beyond the help/guides merge above.
- The "Forsker" pill (`_TeacherClientShell.tsx:130-140`) could become a role line inside the account menu. When a researcher is acting on someone else's class or activity, `ActingForOwnerBanner` already says so, and that is the moment it matters. This is an open question, not a recommendation.

### Copy (Danish default)

| Term today (DA / EN) | Where | Plainer |
|---|---|---|
| "Tilgange" / "Approaches" | account menu (`messages/da/teacher-shell.json:34`) | "Tutorer". For a teacher, 4 of 5 tabs on that page are tutors and faces |
| "Undervisningstilgang", "afveg fra tilgangen", "Vurderet i n af m grupper" | `LessonOverview` (teacher-visible) | Put behind one "Hvordan blev det vurderet?" disclosure |
| "begreb" used for *construct* | `ResearchFrameworksPage.railConstructs`, `howItWorks1` | "træk" (already used in `howItWorks1`). Keep "begreb" for physics concepts |
| "ture" / "turns" | classes list, class page, live view, report | "beskeder" / "messages" |
| "arbejdsbordshændelser" / "workbench events" | class insights, report | "arbejdstrin" / "work steps" |
| "Konfigurér {name}", "Gem konfiguration" | activity editor | "{name}" / "Redigér {name}", "Gem" |
| "systemprompt" | `ActivityConfigPage.intro` | Drop the term |
| "Henvis/Henvist" / "Cite/Cited" | MaterialsSection | "Tilføj/Tilføjet" |
| "Brug / tilpas" | shared activity card | "Kopiér til mine aktiviteter" |
| "Δ ift. før" | `CrossClassTable.colDelta` | "Ændring", with a tooltip |
| "(1.1.57)" | `LensConfigPanel.intro` | Remove the sprint number |
| "Level {n} of 3", "Download index.html", "MCP App", "tokens", "$" | Sim workshop | Plain teacher wording, with the cost line researcher-only (open question) |

**"Stuck" ("sidder fast")** appears only in the live class view (`app/teacher/classes/[id]/_LiveClassView.tsx:154-157`, key `LiveClassView.stuck`). It is the known "quiet 6–30 min after ≥2 turns" label and needs no change here.

### Kit adoption (UI kit landed 2026-11-05 in `11a623a6`; zero adoption so far)

Counts are across `app/teacher/**` and `components/teacher/**`, excluding tests:

- **0 files** import anything from `components/ui/` (`Button`, `Spinner`, `Skeleton`, `Badge`, `useConfirm`, `notify`). The only importer of `useConfirm` in the tree is its own test. The kit is mounted (`providers/AppProviders.tsx:15-17`) but unused.
- **7 `window.confirm` and 1 `window.prompt`:**
  - `app/teacher/activities/page.tsx:197`
  - `app/teacher/sims/_PublishPanel.tsx:125`
  - `components/teacher/MaterialsSection.tsx:238` (prompt), `:255`, `:274`
  - `components/teacher/research/MyTutorsPanel.tsx:86`
  - `CustomApproachPanel.tsx:133`
  - `PersonaEditorPanel.tsx:116`
  - Also hand-rolled confirm modals: `app/teacher/classes/page.tsx:947-1011` and `app/teacher/classes/[id]/page.tsx:461-526`.
- **17 hand-rolled `animate-spin` spinners in 12 files.** The most are in `MaterialsSection.tsx` (4) and `app/teacher/classes/page.tsx` (3).
- **39 "Indlæser…" text loading states**, including the shell itself (`_TeacherClientShell.tsx:58-63`). None use `Skeleton`/`PageSkeleton`. Upstream's `faa341d1` replaced the same pattern on 15 pages.
- **262 raw `<button>`s, 0 `<Button>`s.** No busy state uses `Button pending`, so busy labels are ad hoc ("…", "Saving…", "Asking…").
- **3 toast mechanisms on the class page alone:** the page `useToast`, an inline toast in `ClassDetailsPanel`, and a status line in `ClassVoiceSettingsPanel`. The editor has its own hand-rolled toast (`app/teacher/activities/[id]/page.tsx:342-353`).
- **No `orange-*` literals** anywhere in teacher scope.
  - Off-token colours remain: the indigo create button against the KU-red save button, the `violet-*`/`slate-*` settings cards, and the `indigo`/`slate` SettingsMap and TemplatePicker.
  - Raw `red-600` appears at `classes/page.tsx:998`, `ClassVoiceSettingsPanel.tsx:164` and `_LensConfigPanel.tsx:72,265`. Check whether they are on the brand-literal allowlist as semantic error reds; if not, they are findings.
- **Missing Retry, and silent failures.**
  - Of 29 files that set an error state, 27 have no Retry path. Not all of those are load failures; the per-page sections say which ones are.
  - The worst cases are failures that render as an empty list, which a teacher reads as "you have none". That is the UI form of CLAUDE.md's "a checker answers when it could not read its subject".
- **No unsaved-changes guard.** There is no `beforeunload` or router guard on either builder page.
- **Dates:** raw ISO strings on insights lessons, programme and conversations. Use `Intl.DateTimeFormat`.

### Patterns to borrow from upstream (ideas, not code; there is no merge base)

| Upstream | Here |
|---|---|
| `faa341d1`: one header, account menu with arrow keys, Home/End, focus on open, Esc returns focus | `AccountMenu` and `AskAiplaButton` declare `role="menu"` but have none of that keyboard behaviour |
| `faa341d1`: page skeletons instead of "Loading…" on 15 pages | 39 text loading states here |
| `07d73646`: one Settings page, five-link account menu, Retry on failed loads | Settings is already one page; Retry is the big gap |
| `07d73646`: rare actions behind one ⋯ menu per row (chats get "a single menu") | Activity cards, group rows, approach and tutor rows |
| `5d1ae76b`: plain words ("This part couldn't load"), never a silent wait | Copy table above; silent failures in each slice |

## Role gating map (researcher / programme admin)

| Surface | Plain teacher | Researcher (`useIsResearcher`) | Programme admin (`useIsProgrammeAdmin`) | Enforced where |
|---|---|---|---|---|
| Nav "Programme" | hidden | shown | shown | `TeacherNav.tsx:129` (client); backend on each call |
| Header "Forsker" pill | hidden | shown | hidden | `_TeacherClientShell.tsx:130` |
| Classes "Research view" scope | hidden | shown | — | classes page (`/teacher/classes` section) |
| Activities `?scope=all` (Research view) | hidden | shown | — | activities page (`/teacher/activities` section) |
| Insights tabs | Lessons, Overview | + Conversations, Cost | as teacher (unless also researcher) | `InsightsTabs.tsx:41-44` |
| Insights Overview scope toggle | hidden; forced `own` | shown; defaults to `all` | as teacher | `insights/page.tsx:46-49,90`; backend 403s `scope=all` |
| /insights/cost | "researchers only" notice | full | notice | `cost/page.tsx:41-44,92`; backend 403 |
| /insights/conversations | 403 → "researcher access required" | full | 403 state | backend `assert_researcher` |
| Lesson bands table | unverified (copy says researchers only) | shown if backend sends `bands` | — | backend |
| /programme | "no access" notice | read-only + **Sim workshop toggle** | read/write: budget, grant, cap edit, revoke, Sim toggle | `programme/page.tsx:501-503,614-617,627-633`; backend re-checks |
| /research/frameworks | teacher tier: Try, Approaches (read), Your approaches, Tutors, Faces | researcher tier: 7 tabs + co-pilot + editor + source search | teacher tier | backend 403 on `listTeachingFrameworks` picks the branch (`frameworks/page.tsx:105-109`) |
| Edit/delete/share approaches, tutors, faces | own rows | every authored row | — | server-computed `canEdit` |
| /settings LensConfigPanel | hidden | shown | hidden | `_LensConfigPanel.tsx:46,61`; API 404s others |
| Sim workshop | flag + per-teacher feature (greyed with lock if off) | same; researcher gate via `fetchMyFeatures().researcher` on the sims page | same | `TeacherNav.tsx:122-127`; two gate mechanisms (claim vs features) |
| Shared-library *add* | no | yes | — | MaterialsSection checkbox |
| Shared-library *delete* | **yes** (one confirm) | yes | — | `MaterialsSection.tsx:268-276` — see open questions |

---

# Per-page sections

## Teacher shell: header, nav, account menu (every /teacher page)

### (a) Purpose
The frame around every teacher page: auth gate, header, nav, banners, footer.

### (b) Feature inventory
- Brand link to `/teacher/classes` (`_TeacherClientShell.tsx:102-115`). `/teacher` itself redirects to `/teacher/classes` (`app/teacher/page.tsx:4`).
- "Spørg AIPLA" button (`AskAiplaButton.tsx`). It opens the page's work co-pilot (class list, class page, builder, approaches) and/or the help co-pilot, which is flag-gated (`aiplaHelp`). It renders nothing when neither is available.
- LOCAL_MODE pill (local only); "Forsker" pill (researchers).
- Account menu (`AccountMenu.tsx:78-103`): Settings, Tilgange (→ `/teacher/research/frameworks`), language DA|EN (this browser), Sign out. The email shows on desktop.
- Nav (`TeacherNav.tsx`), as a desktop rail or a phone bottom bar:
  - Klasser, Aktiviteter, Materialer, [Simuleringer, greyed/locked when the teacher has no access], Indsigt, Vejledninger, [Programmet].
  - The desktop rail can collapse to icons; the choice is remembered in localStorage.
- `VisitorAccessBanner`: join the programme, or switch account. `PrivacyNoticeGate`: acknowledge the KU privacy notice.
- `SiteFooter`. First sign-in seeds the teacher's onboarding demo (`useTeacherBootstrap`, `:39`).

### (c) Visual load
- Header: 2–4 controls.
- Nav: 5 items for a teacher, up to 7 for a researcher, plus the collapse toggle.
- Banners: up to 2 (visitor, privacy) until dismissed or acknowledged.

### (d) Duplication
- Help appears twice: the nav "Vejledninger" and the header "Hjælp".
- Tilgange appears twice: the account menu and the class page's Tutor setting.

### (e) Proposals
1. **Merge help into one header menu (S).** Move Vejledninger out of the nav into the help menu: "Vejledninger" (link to `/guides`) and "Spørg AIPLA Hjælp". The phone bottom bar drops to 4 items for teachers.
   - Keeps: guides and the help co-pilot, both one click from the header.
   - Note: with the `aiplaHelp` flag off, the button must still render for the guides link.
2. **Rename "Tilgange" to "Tutorer" (S).** The page behind it is mostly tutors and faces for a teacher (`/teacher/research/frameworks` section).
3. **Shell loading state (S).** Replace the "Indlæser…" text with the kit's `PageLoading`.
4. **Researcher pill (S, open question).** Fold it into the account menu as a role line, and rely on `ActingForOwnerBanner` when acting on someone else's class or activity.

### (f) ui-guidelines-check
- `components/teacher/ui/AccountMenu.tsx:72-104`: `role="menu"` with no arrow-key or Home/End handling, no focus on open, and focus is not returned to the trigger on Esc (`:43-45`). Port the keyboard model from upstream `faa341d1`, or drop `role="menu"` and use a plain list of links.
- `components/teacher/copilot/AskAiplaButton.tsx:79-110`: the same menu pattern with the same gaps.
- `components/teacher/ui/AccountMenu.tsx:92-96`: the language switch sits inside `role="menu"` as a `role="none"` item, so it is not a menu item and arrow keys (once added) will skip it. Make it a `menuitemradio` pair, or move language to Settings with a one-line pointer.
- `app/teacher/_TeacherClientShell.tsx:58-63`: text-only loading → `PageLoading`.
- `app/teacher/_TeacherClientShell.tsx:179-183`: no skip link to `<main>`. Add one as the first focusable element.
- `components/teacher/ui/TeacherNav.tsx:189,221`: the locked Sims link explains itself only through `title`, which touch users and many screen readers never get. Add sr-only text.
- `components/teacher/ui/TeacherNav.tsx:224-233`: up to 7 items at 11px in a 390px bar, with truncation already observed. This is resolved by proposal 1.

## /teacher/classes

### (a) Purpose
The teacher's landing list of classes (and, for a researcher, every teacher's
classes), with a first-run checklist, cross-class numbers and recent sessions.

### (b) Feature inventory
- Floating class co-pilot (`manage-class`), reached through the shell's header
  copilot button; proposals Apply into the list (`app/teacher/classes/page.tsx:431`,
  `_ManageClassCopilot.tsx`). Hidden in research view.
- **New class** inline form: name, optional description; applies the account's
  default tutor at create time (`page.tsx:476-484`, `1033-1128`, `1058-1067`).
- **Getting started** checklist, 6 steps, each with a direct action: New class,
  Open the class, Adopt from the library (`/teacher/activities#shared`), Create one,
  Open class → Try as student, I've checked the opening, Copy link; guide link;
  Hide once live (`_GettingStartedCard.tsx:96-145`, `149-208`). Not in research view.
- Search (class, owner, activity title) and activity filter (all / active 7 d /
  no messages) (`page.tsx:538-564`).
- Class table, sorted by latest activity: class name (link), activity at a glance
  (turns, groups active, relative time), live group count, up to 3 assigned
  activity titles each linking to the activity editor (+N more), tutor with face
  and "default" marker, **Manage**, **Delete** (`page.tsx:568-597`, `788-945`).
- Delete class confirm dialog (`page.tsx:947-1011`).
- **Show insights & spend** (deferred, BigQuery): window select 7 d/30 d/all;
  4 summary stats (active groups, messages, spend this month, last activity);
  sortable per-class `CrossClassTable` with spend column (`page.tsx:614-711`).
- **Recent activity**: latest 10 student sessions across classes, each linking to
  the group report at that session (`page.tsx:713-772`).
- 30-second auto-refresh of the list (`page.tsx:200-204`).
- Researcher only (`useIsResearcher`, `page.tsx:112`, `442-465`): **My classes |
  Research view** toggle; research view lists every teacher's classes with
  owner, onboarding **StageChip**, "Deleted by teacher" marker; **Set up a class
  for a teacher…** dialog (teacher, name, template class to copy activities from)
  (`page.tsx:466-474`, `_SetUpForTeacherDialog.tsx`). Delete hidden in research view.

### (c) Visual load (teacher, 3 classes, before any expand)
Header: title, intro line, New class, copilot button (shell). Getting-started
card: 6 rows, up to ~7 action buttons + guide link. Toolbar: search + filter.
Table: 6 columns; per row 1 class link + up to 3 activity links + Manage +
Delete (≈6 per row → ~18). "Show insights & spend" button. Recent activity: up
to 10 links. **≈ 40 interactive elements, 4 panels.** Researcher adds 2–3.

### (d) Duplication
- Class name link and **Manage** go to the same URL on every row
  (`page.tsx:813-818` and `915-921`).
- The insights & spend panel is `/teacher/insights` again: same
  `fetchInsightsCompare` + `CrossClassTable`, same 7 d/30 d/all select, same own/all
  scope (`app/teacher/insights/page.tsx:20,58,114,163-172`). The only extras here
  are the spend column and four totals.
- The scope toggle exists twice with two names: "Research view" here,
  "All teachers" on `/teacher/insights` (`ClassesPage.researchView` vs the insights
  page's `allTeachers`).
- "Recent activity" exists here (all classes, 10) and on the class page (one
  class, 10), and the row "Activity" column already shows the latest time per class.
- The Getting-started "Copy link" duplicates the class page's "Copy join link".

### (e) Simplification proposals (every feature kept)
1. **Drop the Manage button; the class name is the link** (or make the whole row
   the link). Feature kept: opening a class. S.
2. **Move Delete off the overview row** into the class page's settings, as a
   "Delete this class" danger row at the bottom of Class settings, still behind a
   confirm. Feature kept: delete class. Removes a destructive button from every
   row of the page teachers land on. S.
3. **Replace the insights & spend panel with a one-line link** "Numbers across
   your classes →" to `/teacher/insights`, and add the spend column and the four
   totals there (it already has scope + window). Features kept: per-class
   engagement, spend column, totals, window. M (needs `fetchTeacherSpend` on the
   insights page).
4. **Collapse "Recent activity" by default** (or show 3 with "Show more"), since
   the table's Activity column already answers "is anything happening". Feature
   kept: jump to a recent session report. S.
5. **Rename the column pair** "Activity" (messages) / "Activities" (assigned),
   which sit two columns apart (`page.tsx:573,575`): e.g. "Last used" and
   "Activities". Copy only. S.
6. **Researcher scope**: name the toggle the same on both pages ("Your classes |
   All teachers' classes"), and consider making it a URL param (`?scope=all`) so
   a researcher can link to it. S.

### (f) ui-guidelines-check findings
- `app/teacher/classes/page.tsx:264-266,288-290,704-707` – a failed insights read clears the data and then renders "No engagement recorded in …"; a broken read reads as "your classes had nothing" → keep an error state with Retry.
- `app/teacher/classes/page.tsx:181-192,720-723` – per-class session fetches that fail are dropped (allSettled) and an all-failed result shows "No student sessions yet" → distinguish "could not load" from "none".
- `app/teacher/classes/page.tsx:947-1011` – hand-rolled modal: no focus moved into it, no focus trap, focus not returned → `useConfirm()` from `components/ui/confirm.tsx`.
- `app/teacher/classes/page.tsx:998` – `bg-red-600 hover:bg-red-700` on the destructive button → `bg-destructive` token (or the kit `Button` destructive variant).
- `app/teacher/classes/page.tsx:533,635,934,1001` – "Loading classes…" text and three hand-rolled `Loader2 animate-spin` → `Skeleton` / `Spinner` / `Button pending`.
- `app/teacher/classes/page.tsx:117,122,113,121` – search, filter, research view and window live in `useState` only; Back/refresh loses them → query params.
- `app/teacher/classes/page.tsx:1084-1103` – new-class inputs have no `name`/`autoComplete="off"`; placeholder fine.
- `app/teacher/classes/_SetUpForTeacherDialog.tsx:39,68` – inline English fallbacks "could not load teachers", "failed to set up the class" → message keys.
- `app/teacher/classes/_SetUpForTeacherDialog.tsx:75` – modal has no Escape handler and no focus management → kit dialog / `useConfirm` pattern.
- `app/teacher/classes/_GettingStartedCard.tsx:128` – `aria-label="done"` hard-coded English → message key.
- `components/teacher/insights/CrossClassTable.tsx:174-187` – sortable headers lack `aria-sort` on the `<th>`.
- Performance: `page.tsx:181-183` fans out one request per class every 30 s (`200-204`), even while the tab is hidden → pause when `document.visibilityState === "hidden"` (the compare view already does, `ClassCompareView.tsx:123`).

## /teacher/classes/[id]

### (a) Purpose
Everything about one class: running a lesson (live view, join codes), setting it
up (name, tutor, voice, activities) and reading it afterwards (latest lesson,
concepts, insights, spend, sessions, pairings).

### (b) Feature inventory
Header and shell
- Breadcrumb "Dashboard" → `/teacher/classes`; title; subtitle with group and
  activity counts; **Compare groups** (`app/teacher/classes/[id]/page.tsx:371-384`,
  `components/teacher/compare/CompareGroupsLink.tsx`).
- Researcher acting on another teacher's class: amber "editing X's class" banner
  (`ActingForOwnerBanner.tsx:27-53`); the activity picker switches to the owner's
  library (`page.tsx:135-157`). Gated on ownership, not role.
- Read-only analytics co-pilot for this class, via the shell's header copilot
  button (`_ClassAnalyticsCopilot.tsx`, `page.tsx:901`).
- "Where settings live" map with links to class / tutor / activities
  (`page.tsx:386`, `SettingsMap.tsx`).
After the lesson
- **Latest lesson** card: struggled-with or most-discussed concept chips, next-time
  line, **Open the lesson overview**, **All lessons**; and the 5-step
  **After-lesson review** offer (Start / Not now; Back / Next / Done / Add to next
  activity, which opens a new activity prefilled with the next-time brief)
  (`lessons/LatestLessonCard.tsx:58-104`, `lessons/AfterLessonReview.tsx`).
- **Concepts across the class** (collapsible, open state remembered): concept map
  with spread bars, legend, click a concept → per-group status with flags and
  3 teacher-override buttons per group (`ClassConceptsOverview.tsx`,
  `ClassConceptGraph.tsx:140-213`).
In class now
- **Live** (polls 10 s): raised hands with **Acknowledge** and a group-report link;
  AI rolling class summary; per-group status (active/idle), activity, turns,
  "stuck" flag, each a link to the group report (`_LiveClassView.tsx`).
- **Groups**: join address explained; **New group** (mints and copies the code);
  per live code: last active, **Copy join link**, **Copy code**, **Reset session**
  (inline confirm), **Revoke** (inline confirm with consequence), **Report**;
  **Revoked codes (n)** disclosure with date, last activity, local names and
  Report link (`page.tsx:397-588`).
- **Class list** (collapsed): names and note per code, stored only in this
  browser; **Download as Excel**; **Import from Excel/CSV** (`_ClassListSheet.tsx`).
Setup
- **Class settings**: rename + description with Save, "last edited by"
  (`ClassDetailsPanel.tsx`, `page.tsx:618-631`); **Teaching approaches** link to
  `/teacher/research/frameworks`; **Tutor** picker (cards; click selected card to
  clear; "What does this teaching approach do?" disclosure; group-talk tutors
  blocked without recording) (`TutorPicker.tsx`); **Student voice input** and
  **Record this class** toggles; "Use the tutor's voice" to clear a legacy voice
  override (only when one exists) (`ClassVoiceSettingsPanel.tsx`).
- **Activities assigned to this class**: **New activity** (→ builder with
  `classId`), **Add activity** (inline picker of the library), per activity
  **Edit** and **Remove**, failed-materials warning with Retry
  (`page.tsx:672-771`, `FailedMaterialsWarning.tsx`).
Numbers
- **Spend** (collapsed): period select, total, projection, voice share, by day,
  top activities, top groups (`BudgetPanel.tsx`).
- **Show class insights** (deferred): window select, 6 KPI cards with
  definitions and queries, 7-day trend, per-group bar (links to reports),
  per-activity bar (`insights/ClassInsightsPanel.tsx`).
- **Recent activity**: 10 latest sessions linking to the report at that session;
  **CSV** and **JSON** export of all sessions with transcripts
  (`page.tsx:796-873`, `_exportHelpers.ts`).
- **Groups that can help each other** (collapsed) (`ClassGroupPairings.tsx`).
- Page toast for code/copy/reset/revoke/add/remove results (`page.tsx:887-898`).

### (c) Visual load (class with 6 codes, 3 activities, 6 tutors, one past lesson)
**12 stacked sections**: settings map, latest lesson, concepts, live, groups,
class list, class settings, activities, spend, insights button, recent activity,
pairings. Before any expand: header 2, map 2, latest lesson ~4, concept graph
(nodes clickable), live 6 group links, groups 1 + 6×5 = 31, class settings 3
fields/Save + approaches link + 6 tutor cards (12 incl. disclosures) + 2 toggles,
activities 2 + 3×2, recent activity 2 + 10 links, 4 section toggles. **≈ 90
interactive elements on one scroll.** The per-code row alone is five equal-weight
buttons.

### (d) Duplication
- **The class's groups appear four times**: Live per-group list
  (`_LiveClassView.tsx:132-163`), Groups codes list (`page.tsx:421-539`), Class list
  table of the same codes with join links (`_ClassListSheet.tsx:310-359`), and
  Recent activity grouped by code (`page.tsx:828-871`). Each links to the same
  group report.
- **The join link** is shown/copyable in Groups (Copy join link), in the Class
  list (link column + Excel), and on `/teacher/classes` Getting started.
- **"Report" and "View"** are two labels for the same destination
  (`page.tsx:533` vs `850`).
- **Numbers live in three places**: Spend (collapsible section), Insights (a
  dashed "Show" button), and the analytics co-pilot — two different disclosure
  patterns for the same kind of content. Per-class spend also appears on
  `/teacher/classes` and per-programme on `/teacher/programme`.
- **Section title repeated inside its own body**: "Spend" (`page.tsx:774`) and
  BudgetPanel's own "Spend" heading (`BudgetPanel.tsx:61-63`); "Name" h3
  (`page.tsx:619`) directly above the "Class name" label (`ClassDetailsPanel.tsx:89-91`).
- **Activity editing** reachable from here (Edit), from `/teacher/classes` row
  titles, and from `/teacher/activities`. Fine as navigation, but the class page
  also offers New activity, which `/teacher/activities` offers too.
- The tutor is chosen here, and "Teaching approaches" links out to the researcher
  frameworks page, while `SettingsMap` also links "Tutor" back to
  `#class-settings` on the same page.

### (e) Simplification proposals (every feature kept)
1. **Split the page into three tabs** (URL-synced `?tab=`): **Lesson** (Live,
   Groups/codes, raised hands), **After** (Latest lesson + review, Concepts,
   Pairings, Recent activity + exports, Insights, Spend), **Setup** (name,
   tutor, voice/recording, activities, delete-class from proposal 2 on the list
   page). Default tab: Lesson when any group was active in the last 90 min (the
   live window the report already uses), otherwise After if there is a lesson,
   otherwise Setup. Every section keeps its content; only placement changes. M–L.
   (A no-tabs fallback with most of the gain is proposals 2–4.)
2. **One groups table instead of three lists**: merge Live status, codes and the
   class list into one table — code, names (local, editable inline), status
   (active/idle/stuck/hand raised with Acknowledge), last active, and actions.
   Per row show **Copy join link** and **Report**; put **Copy code**, **Reset
   session**, **Revoke** in a "⋯" menu. Download/Import Excel become two buttons
   in that table's header. Features kept: all of Live's per-group signals,
   acknowledge, every code action, names, import/export, revoked codes
   disclosure. M. Cuts ~30 buttons to ~12 for six groups.
3. **One "Numbers" section** holding Spend and Insights as two collapsibles of the
   same kind (both lazy-loaded on open), instead of one collapsible and one dashed
   button. Features kept: spend period/by day/top lists, all six KPIs, trend,
   per-group and per-activity bars. S.
4. **Remove the "Where settings live" box from the class page**, or show it once
   and let it be dismissed (as Getting started is). Its content moves to the
   Setup tab's intro line and to the guide. Feature kept: the class / tutor /
   activity explanation. S. Note its copy is also wrong here — see (f).
5. **Class settings**: drop the extra "Name" heading; collapse the tutor cards to
   the chosen tutor plus "Change tutor" (opens the grid). Features kept: rename,
   description, every tutor, approach summaries, clear tutor. S–M.
6. **Recent activity** shows 3 rows with "Show all", and the CSV/JSON pair becomes
   one "Export ▾" menu. Features kept: both formats, all rows. S.
7. **Activities section**: one primary button "Add activity" opening a small
   menu "From your library…" / "Create new…". Features kept: both paths. S.
8. **Copy**: breadcrumb "Dashboard" → "Classes" (it links to Classes, and the nav
   says Klasser, the crumb says Oversigt); "Report"/"View" → one word ("Open
   report"); "Reset session" → "Start fresh conversation" (it archives, it does not
   delete); title "Create a new chat-only concept activity from scratch" →
   "Create a new activity". S.

### (f) ui-guidelines-check findings
- `app/teacher/classes/[id]/page.tsx:144-146,160-166,710-713` – if the library fetch fails, `assignedActivities` is empty and the page says "No activities assigned yet" while the subtitle counts them (`page.tsx:382`) → show a load error with Retry; derive "assigned" from `cls.activityIds`, not from the library.
- `app/teacher/classes/[id]/page.tsx:127-129,823-826` – failed session read becomes "No student sessions yet" and disables Export → error state with Retry.
- `app/teacher/classes/[id]/page.tsx:229-237` – class load error has no Retry → add Retry calling `refresh()`.
- `app/teacher/classes/[id]/page.tsx:223-227` – "Loading class…" text → `Skeleton` (upstream `faa341d1` pattern).
- `app/teacher/classes/[id]/page.tsx:887-898` – a third toast system (`useToast` + hand-placed live region) beside the kit's `notify()`; `ClassDetailsPanel.tsx:139` renders its toast as a bare text node with no live region, so "Class updated" is not announced → `notify()`.
- `app/teacher/classes/[id]/page.tsx:461-526` – inline reset/revoke confirms are hand-rolled → `useConfirm()` with the existing consequence text as body; keeps the two-step.
- `app/teacher/classes/[id]/page.tsx:488,752` – the `Settings` cog is the icon for both "Reset session" and "Edit" → `RotateCcw` / `Pencil`.
- `app/teacher/classes/[id]/page.tsx:260,276,286` – clipboard failures are swallowed and the toast still says "Copied" → toast only on success, else show the text to copy.
- `components/teacher/ClassVoiceSettingsPanel.tsx:117` – `<h2>` inside a section whose title is already `<h2>` ("Class settings") with `<h3>` siblings → `<h3>`.
- `components/teacher/ClassVoiceSettingsPanel.tsx:164` – `text-red-600` / `text-emerald-600` literals → `text-destructive` and a success token.
- `components/teacher/TutorPicker.tsx:112-118` – load failure says "Reload the page" → Retry button.
- `components/teacher/TutorPicker.tsx:91` – clicking the selected card silently clears the tutor; no confirm, no visible "clear" affordance → explicit "Use default tutor" control.
- `components/teacher/TutorPicker.tsx:140` – save error has no `role="alert"`.
- `components/teacher/BudgetPanel.tsx:82-85` – load error has no Retry.
- `components/teacher/ClassConceptGraph.tsx:94-109` – override: a non-OK response does nothing, and a network error is an unhandled rejection (try/finally, no catch); the teacher's click silently fails → show an error, keep the choice visible.
- `components/teacher/ClassConceptGraph.tsx:112-114` and `ClassGroupPairings.tsx:49` – failure text without Retry.
- `app/teacher/classes/[id]/_LiveClassView.tsx:54-62` – Acknowledge failure is an unhandled rejection with no message → catch and say so.
- `components/teacher/insights/ClassInsightsPanel.tsx:163` – per-activity bars are labelled with the raw `skillId` → activity title.
- `components/teacher/SettingsMap.tsx:86-112` – `slate-*` / `indigo-*` literals for "you are here" → tokens (`text-brand`, `muted`).
- Copy bug: `messages/en/teacher-shell.json` `SettingsMap.activityDetail` ("what you author here"; da "dette ændrer du på siden her") renders on the class page (`page.tsx:386`), where it is false → per-highlight wording or drop the "here".
- `components/teacher/lessons/LatestLessonCard.tsx:69` – `lesson.date` printed raw (ISO) → `Intl.DateTimeFormat`.
- No kit adoption anywhere in this page's tree: zero imports from `components/ui/` (Button, Spinner, Skeleton, useConfirm, notify).

## /teacher/classes/[id]/compare

### (a) Purpose
Show one workbench element (table, chart, writing, checklist) of one activity for
every group of the class side by side, with chart-slope outliers.

### (b) Feature inventory
- Back to class; activity select; element select; **Refresh every 30 seconds**
  checkbox; "read N ago" stamp; teacher-only note (`ClassCompareView.tsx:147-196`).
- Grid of group cards: code, updated time, revoked marker, miniature of the work,
  fitted slope and "differs from most groups" outlier highlight; stale and retry
  states (`ClassCompareView.tsx:200-292`).
- Reached only from **Compare groups** in the class page header
  (`CompareGroupsLink.tsx`).

### (c) Visual load
Low: 2 selects + 1 checkbox + grid. **≈ 4 controls.** Fine.

### (d) Duplication
- The per-group final work is also shown one group at a time in the report's
  "What they ended with" (`work/FinalWorkPanel.tsx`), using the same renderers —
  intentional reuse, not a problem.

### (e) Simplification proposals
1. Keep the page. Move its entry into the proposed "After" tab (or beside the
   groups table) rather than the page header, where it competes with the title.
   Feature kept: the link. S.
2. Copy: "Element" → "What to compare"; drop the "not meant for the projector"
   line or move it into the subtitle. S.

### (f) ui-guidelines-check findings
- `components/teacher/compare/ClassCompareView.tsx:65-68` – activity/element choice is not in the URL; a teacher cannot bookmark or share "compare the graph" → `?activity=&element=`.
- `components/teacher/compare/ClassCompareView.tsx:133-135` – picker load error has no Retry (the read error below does, `:230-238`).
- `components/teacher/compare/ClassCompareView.tsx:274,278,281,329` – `text-[11px]` at the floor; fine, but four uses in one card — consider `text-xs`.

## /teacher/reports/groups/[groupId]

### (a) Purpose
One group's latest (or a chosen, via `?session_id=`) session: AI summary,
teaching-approach read, numbers, final work, and the full transcript with exports.

### (b) Feature inventory
- Breadcrumb: Dashboard → class → lesson (when derivable) → code → "Session
  history" (`app/teacher/reports/groups/[groupId]/page.tsx:273-303`).
- Live badge or "last active N ago"; activity and start time line (`:305-328`).
- **Summary**: AI narrative, "updated N ago", **Refresh** (forces a new summary,
  a model call), "based on N turns · audio · sim · model · generated at" line
  (`:330-378`).
- **Teaching approach**: label, "Read about this approach" (→ `/project/tutors/<id>`),
  summary, where it drifted, spoken-included note (`TeachingApproachSection.tsx`).
  Researcher only (payload-gated by the backend, `TeachingApproachSection.tsx:17-20`):
  construct table, bands, evidence turn links that open the transcript at `#N`,
  criteria, "Correct this" with band/turns/reason, correction history, compare
  every run (`FidelityConstructDetail.tsx`).
- **At a glance**: group time, messages, sim runs (`:387-413`).
- **What the group did**: two bullets (`:415-433`).
- **What they ended with**: final tables, charts, writing, checklist, concept
  states (`work/FinalWorkPanel.tsx`).
- **Source material**: transcript toggle (remembered per browser), **CSV** and
  **JSON** export of turns + work, labelled timeline with citations
  (`:448-513`); lesson-recording transcript when one exists
  (`GroupTranscriptSection.tsx`).
- Live poll every 12 s for the latest session (`:173-178`).

### (c) Visual load (teacher, before expand)
6 sections + breadcrumb with 3–4 links; Refresh, Read about, transcript toggle,
CSV, JSON. **≈ 10 controls**; reading load is the issue, not controls.
Researcher: + the construct-detail disclosure (large).

### (d) Duplication
- **At a glance** and **What the group did** state the same two numbers:
  `report.messageCount` and `report.simRunCount` (`:405-410` and `:421-422`).
- The summary's "based on N chat turns" repeats the message count a third time
  (`:369`), and the transcript toggle a fourth (`:473`).
- "Dashboard" crumb vs nav label "Classes" (as on the class page).

### (e) Simplification proposals (every feature kept)
1. **Merge At a glance and What the group did** into one line under the title:
   "45 min · 32 messages · 4 sim runs". Features kept: all three numbers and the
   group-time tooltip. S.
2. **Move the model/time provenance** (`· <model> · generated HH:MM`, `:374-375`)
   into a hover/`<details>` "How this summary was made", or show it only to
   researchers. Feature kept: provenance. S.
3. **Rename Refresh** to "Write a new summary" (it costs a model call; the page
   already refreshes data on its own). S.
4. **Order**: Summary → What they ended with → Teaching approach → Source
   material. A teacher reads the work before the tutor's fidelity. S.
5. **Add a session switcher** (or link "All sessions for this group") — the crumb
   says "Session history" but the page shows one session and offers no way to
   another except going back to a list. Unverified whether another surface lists
   a group's sessions; see open questions. M.
6. Copy: "workbench interactions / events" (da "arbejdsbordshændelser") →
   "work steps"; "Sim runs" → "Simulation runs"; crumb "Session history" →
   "Session". S.

### (f) ui-guidelines-check findings
- `app/teacher/reports/groups/[groupId]/page.tsx:234-241` – error says "Refresh to try again" with no button → Retry calling `load()`.
- `app/teacher/reports/groups/[groupId]/page.tsx:216-222` – "Loading report…" text → `Skeleton`.
- `app/teacher/reports/groups/[groupId]/page.tsx:95,100,375` – times built by slicing the ISO string (`slice(0,16)`, `slice(11,16)`); if the backend sends UTC (the comment at `:42` shows a `Z` timestamp), Danish teachers see times an hour or two off → `Intl.DateTimeFormat` in local time. (Likely, not verified against the backend.)
- `app/teacher/reports/groups/[groupId]/page.tsx:483,491` – CSV/JSON handlers are `void`ed promises; a failed timeline read produces a silent or empty file with no message → catch and notify.
- `app/teacher/reports/groups/[groupId]/page.tsx:310` – `animate-pulse` live dot; covered by the global reduced-motion rule in `globals.css:168`, so fine.
- `app/teacher/reports/groups/[groupId]/page.tsx:161` – load failure is `console.warn` only; the poll keeps old data with no "last refresh failed" line (the compare view has one) → show stale notice.
- `components/teacher/GroupTranscriptSection.tsx:21-23` – no `.catch`; relies on `fetchGroupTranscript` never rejecting (unverified) → add a catch.


## /teacher/activities

### (a) Purpose
This is the teacher's activity library. Each activity is a card where the teacher can change its status, filing and class assignment. The shared catalogue of other teachers' published activities sits underneath. Researchers get a "Research view" across all teachers.

### (b) Feature inventory
- New activity: header button (`app/teacher/activities/page.tsx:294`) and an empty-state button (`:354`).
- Search and filters for your own library: free text plus Subject, Level and Tags facet rows, active-filter chips and Clear all (`ActivityFilterBar`, `:312`; `components/teacher/ActivityFilterBar.tsx`).
- Count line ("N of M activities") (`:259-264`).
- Status help paragraph (`:305-309`).
- Per own card (`ActivityCard`, `:624-769`):
  - title
  - status pill. It toggles Private ↔ Shared in one click, and a draft gets a read-only Draft badge instead (`:668-672`, `VisibilityControl` `:551-577`)
  - composition row: sim, elements, documents (`CompositionRow`, `components/teacher/activityDisplay.tsx`)
  - failed-materials warning with a per-document Retry (`FailedMaterialsWarning`, `:677`)
  - teaching-goal snippet
  - filing summary (own and inherited facets) with the File/Done toggle. It opens `ActivityFacetEditor` with subject, level and tags (`:690-693`)
  - students'-language badge
  - Edit link, Duplicate, Delete (with confirm) (`:698-720`)
  - class assignment chips, one per class, which toggle assigned/unassigned (`:738-766`). A draft shows a "Draft — not assignable yet, Review & save" notice instead (`:727-737`).
- Shared activities section (`SharedActivitiesSection`, `:439-509`), anchored at `#shared`, which the getting-started checklist deep-links to. It has its own filter bar (`:476`), groups by owner, shows a "Showing N of M" line, and each card has Use / adapt (adopt as a draft copy) (`:532-541`).
- Researcher only (`useIsResearcher`, `:63`):
  - My library / Research view toggle (`:273-292`). `?scope=all` opens the research view (`:67-73`).
  - Research cards that link to the editor and show the owner (`ResearchCard`, `:407-435`).
  - research hint and empty state

### (c) Visual load (first render, teacher with 8 activities and 3 classes)
- Header: title, count and 1 button. Then the status-help paragraph.
- Filter bar: a search box plus 3 chip rows (Subject, Level, Tags), each with "All" plus options. That is about 10–15 chips.
- Each own card has about 8 controls plus 5 read-outs: pill, File, Edit, Duplicate, Delete and 3 class chips. Eight cards come to about 64 controls.
- Shared section: heading, intro, a second full filter bar (about 10–15 more controls) and N cards with Use / adapt.
- Roughly **90–100 interactive controls** load on the first render of the page. Two identical filter bars are stacked on one page.

### (d) Duplication
- Class assignment exists twice. The activity card's class chips (`:182-194`) and the class page's add/remove (`app/teacher/classes/[id]/page.tsx:338`, `:356`) both call `patchClassActivities`, with two different control shapes.
- "New activity" has four entry points: here (`:294`, `:354`), the class page (`app/teacher/classes/[id]/page.tsx:677`), the getting-started card (`app/teacher/classes/_GettingStartedCard.tsx:187`) and the after-lesson review (`components/teacher/lessons/AfterLessonReview.tsx:52`). Having several is fine, but see the create page: its Back always goes to Classes.
- There are two filter bars, one for the library and one for the catalogue (`:312`, `:476`), and the materials library has a third variant of the same facet idiom (`components/teacher/MaterialsSection.tsx` facet strip).
- Status is explained three times: the status help paragraph (`:307`), the pill's tooltip (`visibilityHelp`, `:569`) and the History tab's visibility sentence (`app/teacher/activities/[id]/page.tsx:559`).

### (e) Simplification proposals (every feature kept)
1. **One list at a time.** Replace the stacked "Your activities" and "Shared activities" lists with a segmented control: **My activities | Shared by colleagues** (researchers also get **All teachers**). Only one list and one filter bar render at a time. The `#shared` deep link selects the second segment. Keep the selection in the URL (`?view=shared` / `?scope=all`). This relocates the shared catalogue and adopt action (to the segment), and folds the research view into the same control. Effort M.
2. **Collapse the filter bar.** Show the search box plus one "Filter" button (with a count badge). The Subject, Level and Tags rows open under it. Active-filter chips stay visible at all times. Relocated: the facet rows, behind the Filter button. Effort S.
3. **Card actions into one menu.** Keep **Edit** as the card's one visible action. Move Duplicate, Delete, File (filing editor) and "Share with colleagues / Make private" into a "⋯" menu. The status pill becomes a read-only badge, and changing visibility becomes an explicit, labelled menu item, which also removes the risk of one-click publishing. Relocated: Duplicate, Delete, File and the visibility toggle all go to the ⋯ menu. Effort M.
4. **Assignment as a summary plus a picker.** Show "In: 7B, 8A" as text, with one "Assign ▾" button that opens checkboxes per class. The chip row disappears from cards at rest. Relocated: the per-class chips move into the Assign popover. Effort S–M.
5. **Remove the status-help paragraph** (`:305-309`). Its content is already in the pill tooltip and would sit in the ⋯ menu item text. Effort S.
6. **Add "Try as student" to the ⋯ menu.** Today it exists only inside the editor (`app/teacher/activities/[id]/page.tsx:307`). This is an addition, not a relocation, so it is optional.

### (f) ui-guidelines-check findings
- app/teacher/activities/page.tsx:197 – `window.confirm` for delete → `useConfirm()`.
- app/teacher/activities/page.tsx:189-191, 202-205, 216-218, 230-232, 244-246 – assign, delete, duplicate, visibility and adopt failures are swallowed (`catch {}`), and the teacher sees nothing → `notify()` error with the action name.
- app/teacher/activities/page.tsx:317-322 – the load-failed EmptyState says "Try again in a moment" but has no Retry → add a Retry action that re-runs the fetch.
- app/teacher/activities/page.tsx:174-176 – a failed shared-catalogue load sets `[]`, so the section silently disappears, which reads as "nobody has shared anything". Show an error line with Retry.
- app/teacher/activities/page.tsx:122-124 – a failed class load makes every assignment control vanish without a word. Show a notice instead.
- app/teacher/activities/page.tsx:565-576 – one click publishes an activity to every teacher, with no confirm or undo → confirm, or an undo toast.
- app/teacher/activities/page.tsx:571 – `focus:outline-none focus:ring-1` → `focus-visible:ring-2`.
- app/teacher/activities/page.tsx:64-73, 274-291 – the scope toggle reads `?scope=all` but never writes it, and the filters are not in the URL either, so Back and links lose the view → sync both to query params.
- app/teacher/activities/page.tsx:316 – plain "Loading activities…" text → `Skeleton` cards (the kit has them).

---

## /teacher/activities/new

### (a) Purpose
This page creates a new activity: pick a template or start blank, fill in the builder, and save it straight into one class.

### (b) Feature inventory
- Back to classes (`app/teacher/activities/new/page.tsx:165-171`).
- Arrival seeds:
  - `?classId=` preselects the class (`:61`, `:116-117`)
  - `?brief=` from the after-lesson review seeds the teaching goal (`:65-72`)
  - the account default seeds the language and the concept-map section (`:75-89`)
- Loading, error, "concept-dialogue skill not seeded" and "no class yet" states (`:195-216`).
- "Where settings live" map (`SettingsMap`, `:219`).
- Template picker (`components/teacher/TemplatePicker.tsx`): family filter chips (All plus 4 families with counts), a horizontal strip of the 23 templates plus a "Start from scratch" card, scroll buttons and an "applied" badge.
- Class `<select>` (`:231-246`).
- The whole builder body (see the builder section below).
- Save errors, the Create button (`:257-267`), and the success panel with Configure activity, Create another and Back to classes (`:311-355`).
- Authoring co-builder (floating, feature-flagged by `useTeacherFeature("authoringCopilot")`, `app/teacher/activities/[id]/_AuthoringCopilot.tsx:476`). It applies proposals into the draft (`:276-288`).

### (c) Visual load
Before the first form field the page shows the back link, h1, intro, the SettingsMap (3 rows, 2 links), the template header with 5 filter chips, the template strip (24 cards, 2 scroll buttons) and the section nav (4 chips). The builder follows (see below). Roughly **35 controls sit above the "Activity name" field**.

### (d) Duplication
- `SettingsMap` appears here and on the edit page (`app/teacher/activities/[id]/page.tsx:286`). `InheritedTutor` already says the same thing about where the tutor lives ("Change in class settings"), as does the TeachingGoalLint note about the tutor's approach.
- The success panel's "Configure activity" sends the teacher to the same builder they just used. Its help copy (`messages/en/teacher-activities.json` → `NewActivityPage.liveHelp`, "Configure it to add a workspace…") predates the workspace being on the create page, so it now describes a second step that no longer exists.

### (e) Simplification proposals
1. **Skip the success panel.** On Create, route to the editor with a toast: "Live for 7B. Create another." The toast carries the "Create another" action, and Back stays in the breadcrumb. Relocated: Configure becomes the default destination, and Create another moves into the toast or a header button. Effort S.
2. **Template picker as an entry choice.** Show two large choices first, **Start from a template** or **Start from scratch**. The 23-card strip opens only after the first choice, and once one is applied it collapses to "Template: X · Change". Relocated: the strip moves behind "Start from a template" or "Change". Effort M.
3. **Protect typed work.** Today picking a template after typing silently overwrites the title, goal and every element (`hooks/useActivityBuilder.ts:272-`). Add a confirm, or an Undo toast. This is not a removal; it makes the template strip safe to keep visible.
4. **Drop the SettingsMap from the builder** (see the edit page). Effort S.
5. **Back goes to where you came from.** The back control always pushes `/teacher/classes` (`:167`), even when the teacher came from Activities. Make it a `<Link>` to `/teacher/activities`, or use the breadcrumb pattern the edit page uses. Effort S.

### (f) ui-guidelines-check findings
- app/teacher/activities/new/page.tsx:165-171 – a navigation done as `<button onClick={router.push}>` → `<Link>` (Cmd-click and middle-click work).
- app/teacher/activities/new/page.tsx:170, 173, 264 – lucide icons without `aria-hidden`.
- app/teacher/activities/new/page.tsx:211, 262, 324-352 – `indigo-600` / `green-*` / `slate-*` literals. The **Create** button is indigo while the edit page's **Save** is `bg-primary` (KU red) → use `bg-primary` and the `Button` kit. (`check-brand-literals` only guards `red-*`, which is why this is not caught.)
- app/teacher/activities/new/page.tsx:252 – `text-red-600` error → `text-destructive`.
- app/teacher/activities/new/page.tsx:197 – the loading text uses `animate-pulse` → `Skeleton`.
- app/teacher/activities/new/page.tsx (whole form) – there is no unsaved-changes guard (`beforeunload` or a router guard), and none exists anywhere under `app/teacher` or `components/teacher`. A long builder form can be lost with one click on the nav.
- components/teacher/TemplatePicker.tsx:22-24 (`useEffect` `measure` on resize) is fine. No finding beyond the overwrite in (e)3.

---

## /teacher/activities/[id] (the activity editor)

### (a) Purpose
This page edits one saved activity, in the same builder as create, with a live student preview, save and Try as student.

### (b) Feature inventory
- Breadcrumb back to Activities (`app/teacher/activities/[id]/page.tsx:173-185`).
- Load with a 404 → empty form, plus an error state (`:99-140`, `:187-220`).
- h1 "Configure {name}" with the students'-language badge, and an intro (`:226-235`).
- Acting-for-owner banner when a researcher edits someone else's activity (`:240`, `components/teacher/ActingForOwnerBanner.tsx`).
- Tabs (`:242-277`):
  - **Teaching goal**: the builder (below)
  - **Code**: a "v2" roadmap mock with fixed Boldkast source, three disabled buttons, three fake check results and an "Open question for M/JB" note (`:396-492`)
  - **History**: provenance (original vs adapted from X), visibility, created and updated dates, "last edited by", and a Year-2 roadmap banner (`:512-583`)
- Settings map (`:286`).
- Builder body, with `InheritedTutor` as the tutor slot (`:287-291`).
- Save (`:296-303`), Try as student (act- activities only) (`:307`, `components/teacher/TryAsStudentButton.tsx`).
- Teaching-goal lint after save (`:164`).
- Researcher only: model tier, default or smart. It saves immediately (`:314-318`, `components/teacher/ModelTierControl.tsx:36`).
- Authoring co-builder, feature-flagged (`:323-334`).
- Toast for save success and failure (`:86`, `:342-353`).

**The builder body** (`components/teacher/ActivityBuilderBody.tsx`), shared with create:
- Template slot (create only).
- Sticky section nav: Setup, Lesson, Workspace, Materials, with counts and scroll-spy (`components/teacher/BuilderLayout.tsx:132-203`).
- **Setup**: activity name, students' language plus help, class control (create only) and the inherited tutor card with a "Change in class settings" link (`:100-142`; `components/teacher/InheritedTutor.tsx`).
- **Lesson**:
  - teaching goal, linted on blur (`:144-166`)
  - TeachingGoalLint: per line Move to tutor notes or Keep, plus Undo for an auto-move (`components/teacher/TeachingGoalLint.tsx`)
  - Tutor notes, shown only when it has content, with "Move back to the teaching goal"
  - **What students see first**: student introduction (Markdown), "I'll introduce this activity in class myself", up to 4 starter prompts (add/remove), and an intro preview (`components/teacher/ActivityOpeningEditor.tsx`)
- **Workspace**:
  - intro paragraph
  - SimPicker: selected-sim card with remove and a large screenshot. Otherwise an inline grid of all 11 sims, with search and level chips once there are more than 6 (`components/teacher/SimPicker.tsx:35-`)
  - checklist: add, edit and remove steps (`:181-225`)
  - Data tables, max N: title, columns (label, unit, type), rows (`TableEditor`)
  - Charts: title, kind, table, x/y (`ChartEditor`)
  - Calculator: title, variables, formula, formula validation, "?" help tooltip (`CalculatorEditor`)
  - Note (Markdown) (`NoteEditor`)
  - Writing fields: title, task, word target (`WritingEditor`)
  - Solution editor prompt (`SolutionEditor`)
  - Document upload prompt (`DocumentEditor`)
  - Concept list nudge with Suggest concepts and Not now, plus the concept map editor (concepts, builds-on, done-when, check questions and answers, Suggest via co-pilot). Both are behind `NEXT_PUBLIC_CONCEPT_MAP` (`:242-256`).
- **Materials** (`MaterialsSection` in cite mode):
  - cited-material chips, each with View extracted text, Reference ↔ In context, Students can open ↔ Tutor only, Remove, and an "Opens first" marker
  - image chips: visible/hidden, remove
  - search, Upload (documents and images). Researchers also get "Share to the shared library".
  - "Files into {folder}" hint
  - facet strip: Subject, Folders (with New folder and a delete X per folder), Level, Tags
  - active-filter chips
  - library rows: title (opens the extracted-text dialog), meta, RAG status with Retry, summary, tags with Edit tags (subject and folder selects, add and remove tag), Cite/Cited, Delete
  - Load more, and the extracted-text dialog
- Builder hints, which flag a language mismatch, duplicate column names and untitled tables (`components/teacher/BuilderHints.tsx`).
- Live preview, pinned on the right, with a full-screen pop-out (`components/teacher/ActivityPreview.tsx`).

### (c) Visual load
Before the "Activity name" field the page shows the breadcrumb, h1, intro, the tab bar (3 tabs, one carrying a literal "v2" badge), the SettingsMap (3 rows, 2 links) and the section nav (4 chips). That is six bands of chrome.

With nothing added yet, the Workspace section alone renders the intro, the sim picker grid (11 screenshot cards, a search box and level chips) and **nine "X (optional) + Add X" blocks, each with its own help paragraph** (checklist, tables, charts, calculator, note, writing, solution, document, concept map).

The Materials section opens with a roughly 90-word paragraph (`MaterialsSection.citeIntro`), then 4 facet rows and the whole document library list.

Estimate: **40–50 controls plus 11 sim cards plus the document rows**, on one scrolling page, before the teacher has added anything.

### (d) Duplication
- **Where the tutor lives** is explained three times: the SettingsMap's Tutor row, InheritedTutor's footnote and "Change in class settings" link, and the TeachingGoalLint `precedence`/`noApproach` copy.
- **Visibility** shows in the History tab and on the library card. **Provenance** shows only in History.
- **Library management inside the builder.** New folder, delete folder, delete document, and organise subject/folder/tags all appear inside the builder's Materials section, as well as on `/teacher/materials` (the same component, `mode="library"`).
- **Two ways to see the student view**: the live preview with its pop-out, and Try as student.
- **The page title says "Configure" twice**: breadcrumb `crumb` "Configure: {name}" and h1 `title` "Configure {name}".

### (e) Simplification proposals
1. **Remove the tab bar.**
   - The **Code** tab is a non-functional roadmap mock. It shows teachers fake Boldkast source with a hard-coded "12.4 KB" and three fake green checks (`:417`, `:471-484`), three disabled buttons, and an internal note addressed "Open question for M/JB" (`messages/en/teacher-activities.json` → `ActivityConfigPage.openQuestion`, Danish "Åbent spørgsmål til M/JB"). Remove it from the teacher UI. If the mock is still wanted for design review, keep it in the design doc it cites (`docs/design/aipla/post-pilot/teacher-artefact-authoring.md`) or put it behind the researcher claim.
   - Fold **History** into one line under the h1: "Created 3 Oct · Last edited 5 Nov (by X) · Adapted from Y". The Year-2 roadmap banner goes away with the tab.
   - Relocated: provenance, dates, last-edited-by and visibility move to the header line. The Code mock goes to the design doc or researcher-only.
   - Effort S.
2. **Workspace: add on demand.**
   - Replace the nine always-open "Add X" blocks with one **"Add to the workspace"** button. It opens a menu or grid of element types, each with icon, name and one line from its existing `help` key: Checklist, Data table, Chart, Calculator, Note, Writing field, Your solution, Document upload, Concept map. Only added elements render as editors.
   - Show the sim the same way: "Add a simulation" opens the existing SimPicker grid in a dialog. A chosen sim stays as the card it is today.
   - Relocated: each element's empty-state header and help move into the add menu, and the sim catalogue grid moves into a dialog.
   - Effort M.
3. **Lesson: progressive disclosure for the opening.** Collapse "What students see first" (student intro, teacher-introduces checkbox, starter prompts, preview) to one summary row: "Students see: the default introduction · Change". It auto-opens when any of those fields is set. Relocated: the whole `ActivityOpeningEditor`, behind the disclosure. Effort S.
4. **Materials in the builder: cite only.**
   - In cite mode, show search, Upload and the result list with **Add/Added**.
   - Move folder create/delete, document delete and the Organise editor to `/teacher/materials`, reached by a "Manage the library" link.
   - Replace the 90-word paragraph with one line plus a "?" disclosure.
   - On each added-material chip, merge the two toggles into one small menu: "Tutor: looks it up / always has it · Students: can open / cannot".
   - Relocated: folder management, document delete and Organise go to /teacher/materials; the two chip toggles go into a chip menu; the long explanation goes behind "?".
   - Effort M.
5. **Drop the SettingsMap from the builder.** InheritedTutor already says where the tutor is chosen and links there. Keep SettingsMap on the class page, or as a one-time "how it fits together" dismissible. Relocated: the SettingsMap's links go to the InheritedTutor link and the nav. Effort S.
6. **Fix the tutor box first** (a correctness issue that also confuses).
   - Every link into the editor except the post-create "Configure" omits `classId`: `app/teacher/activities/page.tsx:411` and `:655`, `app/teacher/classes/page.tsx:888`, `app/teacher/classes/[id]/page.tsx:721`.
   - With `classId=""`, `InheritedTutor` returns the `"default"` state (`components/teacher/InheritedTutor.tsx:43-46`). It then shows "Default tutor — this class hasn't chosen one yet" even when every class the activity is in has chosen a tutor. The SettingsMap's tutor link also falls back to `/teacher/classes`.
   - The backend goal lint is unaffected, because it resolves the class from the activity (`backend/analytics/teaching_goal_lint.py:384`).
   - Show "Used in 7B (tutor: Sofie), 8A (tutor: …)" from the activity's assignments instead.
   - Effort S–M.
7. **Plainer header.** h1 = the activity name, with no breadcrumb "Configure:" prefix. Save = "Save". Effort S.

### (f) ui-guidelines-check findings
- app/teacher/activities/[id]/page.tsx:51-57, 396-492 – a shipped roadmap mock with fake data and an internal note to M/JB is visible to every teacher. Remove it, or gate it to researchers.
- app/teacher/activities/[id]/page.tsx:242-277 – `role="tablist"` without arrow-key navigation or a roving `tabIndex`, and the active tab is not in the URL. Moot if the tabs are removed as in (e)1.
- app/teacher/activities/[id]/page.tsx:199-219 – the load error says "Refresh to try again" and has no Retry button → add Retry.
- app/teacher/activities/[id]/page.tsx:86, 342-353 – a hand-rolled toast region → `notify()`.
- app/teacher/activities/[id]/page.tsx:296-303 – a hand-rolled submit button with a text swap → `Button` with `pending`.
- app/teacher/activities/[id]/page.tsx:192 – a hand-rolled `Loader2 animate-spin` → `Spinner` or a `Skeleton` of the builder.
- app/teacher/activities/[id]/page.tsx (form) – no unsaved-changes guard. "Try as student" opens the *saved* activity in a new tab, so unsaved edits are silently absent from what the teacher tries. At minimum, say "Save first" when the form is dirty.
- components/teacher/InheritedTutor.tsx:43-46 – a missing `classId` renders a confident wrong answer ("this class hasn't chosen one yet") instead of "unknown". See (e)6.
- components/teacher/SimPicker.tsx:43-45 – a catalogue load failure sets `[]`, which renders "No simulations available in this environment yet". A failure reads as "none exist" → show an error with Retry.
- components/teacher/MaterialsSection.tsx:443 – removing an image chip deletes the server copy immediately, before the activity is saved, with `.catch(() => {})`. A teacher who abandons the edit has still lost the image, and a failed delete is silent → defer the delete to save, or confirm.
- components/teacher/MaterialsSection.tsx:238 – `window.prompt` for "New folder" → an inline input.
- components/teacher/MaterialsSection.tsx:255, 274 – `window.confirm` (delete folder, delete document) → `useConfirm()`.
- components/teacher/MaterialsSection.tsx:243-245, 263-265, 289-291, 312-314 – folder create/delete, document delete and the tag edit fail silently ("Non-fatal") → `notify()`.
- components/teacher/MaterialsSection.tsx:579 – every upload auto-opens the extracted-text modal and takes focus away mid-build → show "View what was extracted" as a link on the new row instead.
- components/teacher/MaterialsSection.tsx:687, 916, 952, 1086 – four hand-rolled `Loader2` spinners → `Spinner`, and `Button pending` for Upload and Load more.
- components/teacher/CalculatorEditor.tsx:20 – `focus:outline-none` with only a colour change on focus → `focus-visible:ring-2`.
- components/teacher/BuilderLayout.tsx:16-44, components/teacher/SettingsMap.tsx:97-112, components/teacher/TemplatePicker.tsx (10 `indigo-*`), components/teacher/SimPicker.tsx (6), components/teacher/InheritedTutor.tsx:116 – the builder is a `slate-*` / `indigo-*` island. Indigo is the "selected" and link colour here, while KU red (`primary`) is everywhere else → tokens (`primary`, `muted`, `border`).
- components/teacher/ActivityBuilderBody.tsx:173, 189, 219 – icons without `aria-hidden` (`MessageCircle`, `Plus`, `X`). The X sits inside a labelled button, so this is low priority.
- components/teacher/ActivityBuilderBody.tsx:128-129 – the language options are hard-coded "Dansk" / "English". These are endonyms, so leaving them is acceptable; add `translate="no"`.

---

## /teacher/materials

### (a) Purpose
This is the shared curriculum library outside any activity: upload documents, file them and read what the tutor will get from them.

### (b) Feature inventory
(`app/teacher/materials/page.tsx:42` mounts `MaterialsSection mode="library"`.)
- Intro (`libraryIntro`).
- Search (debounced), Upload of documents and images.
- Researcher only: "Share to the shared library (asserts copyright clearance)" checkbox (`components/teacher/MaterialsSection.tsx:1103-1113`).
- "Files into {subject · folder}" hint, upload error, spend-denied notice.
- Facet strip:
  - Subject
  - Folders, plus **New folder** (window.prompt) and a **delete X on every folder chip** (`:599-631`)
  - Level, including "No level"
  - Tags (multi)
- Active-filter chips with Clear all.
- List rows:
  - title, which opens the extracted-text dialog
  - origin, level, subject, topic
  - RAG status with Retry. Retry shows on the teacher's own docs, and on shared docs only for researchers (`:746`).
  - summary
  - tags, plus **Organise**: subject select, folder select (same scope), add/remove tag
  - **Delete** (any teacher can delete a *shared* document for everyone, after a confirm; `:268-276`)
- Load more with an "N of M" count. Retry on load failure (`:690-699`).

### (c) Visual load
- Search, Upload (+1 checkbox for researchers), then 4 facet rows. The Folders row carries one delete X per folder (9 seeded physics folders, so 9 X buttons sit next to 9 filter chips) plus New.
- Each row has 3 controls (title, Organise, Delete) plus a possible Retry. With a 20-row page that comes to about **75 controls**.

### (d) Duplication
- Every library-management control here also appears inside the activity builder's Materials section (the same component).
- This is the third facet-filter UI across the slice (library, catalogue, materials).

### (e) Simplification proposals
1. **Separate filtering from folder management.** Filter chips only filter. Add a **"Manage folders"** button that opens a small dialog listing folders with rename (new), delete (with its count-aware confirm) and create (an inline input, not `window.prompt`). Relocated: New folder and delete-folder move into the Manage folders dialog. Effort M.
2. **Row actions into a ⋯ menu.** Keep the title link (extracted text) and the status visible. Organise and Delete go into a row menu. Relocated: Organise and Delete, to the row menu. Effort S.
3. **Collapse facets behind "Filter"**, the same pattern as the activities page. Effort S once the activities version exists (a shared component).
4. **Make this the one home for library management** (see the builder (e)4). Keep a "Manage the library" link from the builder.

### (f) ui-guidelines-check findings
(The `MaterialsSection` findings under the editor apply here too: lines 238, 255, 274, the silent catches and the hand-rolled spinners.)
- components/teacher/MaterialsSection.tsx:612-622 (the folder delete X inside a filter chip) – a destructive control a few pixels from the select target → move it to Manage folders.
- components/teacher/MaterialsSection.tsx:690-699 – Retry exists here, which is good. The error text is the raw `e.message` from the API (`:163-167`) → a plain sentence, with the detail on hover.

---

## /teacher/sims (Sim workshop)

### (a) Purpose
Teachers describe a simulation to an assistant, then review, try, publish and download each checked version. Researchers also review library requests here.

### (b) Feature inventory
- Gates:
  - build flag (`useTeacherFeature("simWorkshop")`, `app/teacher/sims/page.tsx:61-73`)
  - per-teacher access, with a locked state and an "Ask to have it switched on" mailto to M (`:53-55`, `:81-99`)
- Header: Import a sim (an .html, optionally with .yaml; `:266-285`, `:169-200`) and Refresh (`:286-293`). The page also polls every 8 s while visible (`:58`, `:237-243`).
- "Drafts are only visible to you" note (`:297`), import status, load error.
- Drafts nav: New simulation (also a big button in the empty state), and one chip per draft with title, version, level and **cost (≈ $, tokens)** (`:326-379`). Picking a chip reopens that draft's chat.
- "The chat is this draft" note, plus **Try it**: a live sandboxed preview of the latest version (`app/teacher/sims/_SimDraftPreview.tsx`).
- Publish panel (`app/teacher/sims/_PublishPanel.tsx`):
  - approve checkbox, then Publish (needs level 3)
  - published state: live/withdrawn, "in library", a newer-draft notice
  - Ask for the shared library, with a note
  - Withdraw (window.confirm)
- Version panel: version and level; downloads for the portable file, `index.html` and the catalogue `.yaml`; level help; "what stopped it"; three screenshots (at rest, after clicking, on a phone) (`:464-561`).
- Earlier versions as a `<details>` holding compact version panels (`:410-429`).
- Researcher only: library review queue. Researchers can try the published sim, write a note, and approve or decline (`app/teacher/sims/_LibraryReview.tsx`, gated at `:430` via `fetchMyFeatures().researcher`, `:123-127`).
- Docked sim-author assistant (`TeacherCopilot`, `:434-444`).

### (c) Visual load
- Header: 2 buttons. Then a note, the drafts row (New plus N chips), the preview frame (up to 620 px), the publish panel (2–3 controls), and the latest-version panel with 3 download buttons and 3 screenshots.
- Then earlier versions, the review queue for researchers, and the assistant column.
- Roughly **15–20 controls plus two large media areas**. The page is dense, but its purpose is clear.

### (d) Duplication
- **Refresh** duplicates the 8-second automatic poll.
- "Try it" (the live frame) and the three screenshots show the same thing two ways. That is deliberate (a screenshot exists even without a sandbox), but on an environment with a sandbox the screenshots are secondary.
- Researcher status is resolved by `fetchMyFeatures().researcher` here and by `useIsResearcher()` (claim) everywhere else in this slice: two mechanisms for one gate.

### (e) Simplification proposals
1. **One "Download ▾" menu.** "Portable file" is the default item, and `index.html` and the catalogue entry sit under "For developers". Relocated: two of the three download buttons move into the menu. Effort S.
2. **Remove the Refresh button**, or move it into an overflow menu next to Import. Polling already refreshes. Relocated: Refresh moves to the overflow, so it stays reachable. Effort S.
3. **Screenshots behind "Checks and screenshots ▸"** when a live preview is available, together with the level help and "what stopped it". Keep them open when there is no sandbox (`previewUnavailable`). Relocated: screenshots and level help move into the disclosure. Effort S.
4. **Plainer copy.**
   - "Level 3 of 3" → "Checks passed: 3 of 3".
   - "Download catalogue entry" → "Download settings file".
   - Drop "MCP App" from `portableHelp`.
   - Move the cost line (≈ $ · tokens) to researchers, or into a hover. This one is a product question (see open questions).
   - Effort S.

### (f) ui-guidelines-check findings
- app/teacher/sims/page.tsx:578-584, 600-601 – a failed screenshot fetch is swallowed, and the placeholder pulses forever → show "Screenshot unavailable".
- app/teacher/sims/page.tsx:480-495 – `download()` has no try/catch. A failed fetch is an unhandled rejection with no feedback → `notify()` error.
- app/teacher/sims/page.tsx:137-139 – a failed `listMyTeacherSims` is silent, so the publish panel can show "not published" for a live sim.
- app/teacher/sims/_PublishPanel.tsx:125 – `window.confirm` for withdraw → `useConfirm()`.
- app/teacher/sims/page.tsx:326-379 – the drafts nav uses `aria-current` on buttons that do not navigate. Acceptable, but `aria-pressed` is the closer fit.
- app/teacher/sims/page.tsx:53-55 – M's personal address is hard-coded as the access-request route. This is a maintainability issue for when AD shares the load: move it to config.

---


## /teacher/insights (Overview tab: cross-class compare)

**(a) Purpose.** Sortable table of the teacher's classes by engagement over a time window. Researchers can widen it to every teacher's classes.

**(b) Feature inventory**
- Breadcrumb back to `/teacher/classes` (`page.tsx:77-85`).
- Time window select: 7d / 30d / all (`:153-176`).
- Researcher only: "My classes / All teachers" scope toggle. Researchers default to "all" (`:46-49`, `:90`, `:119-151`).
- Insights sub-tabs (`InsightsTabs`). Teachers see Lessons and Overview. Researchers also see Conversations and Cost (`components/teacher/insights/InsightsTabs.tsx:25-44`).
- Window label line (`:97-100`).
- Error and loading states (`:102-112`).
- `CrossClassTable` (`components/teacher/insights/CrossClassTable.tsx`):
  - Six sortable columns: class, groups, messages, Δ vs prior, sim runs, last activity (`:66-84`).
  - An Owner column when the rows span more than one owner, which only happens in the researcher "all" view (`:102-120`).
  - The class name links to `/teacher/classes/[id]` (`:200-203`).
  - Empty state (`:160-166`).

**(c) Visual load at first render.** Teacher: 1 select, 2 tabs, 6 sort buttons, plus one link per class. Researcher: add the 2-button scope toggle, 2 more tabs and a 7th column.

**(d) Duplication**
- **The same `CrossClassTable` is already on `/teacher/classes`.** It sits inside the opt-in insights panel, under "Per class", and adds a Spend column (`app/teacher/classes/page.tsx:284`, `:690-701`). It uses the same `fetchInsightsCompare`, the same window choices, and the same researcher all/own switch (`researchView`). So for a plain teacher the Overview tab is a strict subset of something the dashboard already shows.
- Per-class spend appears three times: the Spend column on `/teacher/classes`, "By class" on the Cost tab (`cost/page.tsx:131-139`), and the per-class KPI cards.
- The Insights entry in the main nav goes to `/teacher/insights`, which is Overview (`components/teacher/ui/TeacherNav.tsx:65`). But `InsightsTabs` deliberately puts **Lessons first** "because a teacher's first question after a lesson is 'what did the class get?'" (`InsightsTabs.tsx:23-28`). So the nav lands on the second tab.

**(e) Simplification proposals (every feature kept)**
1. **Point the Insights nav entry at `/teacher/insights/lessons`** (S). Change one href in `TeacherNav.tsx:65`, or make `/teacher/insights` redirect to Lessons and move Overview to `/teacher/insights/classes`. Nothing is dropped.
2. **Remove the Overview tab for plain teachers, and keep it for researchers as "All classes"** (M). The teacher's cross-class table stays reachable at `/teacher/classes` → "Per class", which also has spend. For a plain teacher, Insights then becomes a single destination (Lessons), and `InsightsTabs` hides itself (`:47`). For a researcher, the scope toggle and Owner column move with the tab. Every feature in (b) stays reachable.
3. Bring the time window into the URL (`?since=`) so Back and shared links keep it (S).

**(f) ui-guidelines-check**
- `app/teacher/insights/page.tsx:168`: `focus:outline-none` on the select, and the wrapping label (`:162`) has no focus ring. Keyboard focus is invisible. Fix: add `focus-within:ring-2 ring-ring` on the label, or drop `outline-none`.
- `app/teacher/insights/page.tsx:102-106`: a failed load shows only the raw error string, with no Retry. Fix: wrap it with a Retry button that re-runs the effect.
- `frontend/messages/{da,en}/teacher-research.json` → `CrossClassTable.colMessages` is "Beskeder 7 d" / "Messages 7d", but the window can be 30d or all. **The column header is wrong whenever the window isn't 7d**, on both this page and `/teacher/classes`. Fix: drop "7 d", or pass the window into the label.
- `components/teacher/insights/CrossClassTable.tsx:174-188`: the sortable `<th>` has no `aria-sort`, so screen readers aren't told the sort state. Fix: put `aria-sort={active ? (asc ? "ascending" : "descending") : "none"}` on the `th`.
- `components/teacher/insights/CrossClassTable.tsx:231`: `emerald-700` / `rose-700` are fine semantically, but the delta is shown by colour plus sign only. OK. No finding.

---

## /teacher/insights/lessons

**(a) Purpose.** A class's lessons, newest first. A lesson is an (activity, date) pair. Pick one to open.

**(b) Feature inventory**
- Breadcrumb (`app/teacher/insights/lessons/page.tsx:76-81`).
- Class select, remembered in `?class=` (`:84-101`).
- Insights tabs.
- List rows showing activity title, date, group count and an "Open" link (`:114-133`).
- Empty states for no classes and no lessons (`:109`, `:113`).
- Error state (`:104-108`).
- Also reached from `LatestLessonCard` on the class page (`components/teacher/lessons/LatestLessonCard.tsx:97`).

**(c) Visual load.** 1 select, 2–4 tabs, and one "Open" link per lesson. This is already lean.

**(d) Duplication.** `LatestLessonCard` on `/teacher/classes/[id]` links here, which is fine because it is the entry point. The class picker repeats context the teacher has just left on the class page. That is acceptable, since `?class=` is preserved.

**(e) Proposals**
- Make the whole row the link, not a separate "Open" (S). The target gets bigger, the control count drops, and nothing is lost.
- Format the date with `Intl.DateTimeFormat` and a weekday ("tirsdag 18. nov.") (S). Teachers recall lessons by day, not by ISO date.

**(f) ui-guidelines-check**
- `app/teacher/insights/lessons/page.tsx:121`: raw `l.date` (ISO). Fix: `Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "short" })`.
- `app/teacher/insights/lessons/page.tsx:104-108`: error text with no Retry. Also, one `error` flag covers both the class-list failure and the lessons failure. Fix: show Retry for whichever load failed.

---

## /teacher/insights/lessons/[classId]/[activityId]?date=

**(a) Purpose.** One lesson for the whole class, in this order: concepts, how the tutor taught, what next, then the groups.

**(b) Feature inventory** (`components/teacher/lessons/LessonOverview.tsx`)
- Breadcrumb back to Lessons for the class (`page.tsx:76-84`).
- Title and subtitle (date · groups).
- Pending notice with **"Summarise them now"** (a model call, capped at 8), the cap hint and the failure message (`LessonOverview.tsx:71-103`).
- Concepts section (`:123-246`):
  - Concept search.
  - Four filter chips: all / struggled / discussed / understood.
  - A clickable chip per concept.
  - A concept × group colour matrix, where each row header is also a button.
  - A legend line.
  - Concept detail: counts, "on the concept map", and per-group evidence (`:248-271`).
- Approach section (`:273-325`):
  - Approach name.
  - Coverage list, up to 5 lines: assessed / too short / abstained / not judged / other approach.
  - Not assessed or synthesis-pending state, then the synthesis text.
  - "Group by group" disclosure with drift notes.
  - Bands table (**"researchers only"** by copy; whether it shows depends on the backend sending `bands`, so the gating is unverified client-side).
- What next (`:362-392`): class-level synthesis, and a "From each group" disclosure.
- Groups list (`:394-431`): code, message count, "not summarised" badge, struggle/drift flags, main concept, and "Open report" linking to `/teacher/reports/groups/[code]?session_id=…&lessonActivity=…&lessonDate=…`.
- Error, not-found and missing-date states (`page.tsx:89-98`).

**(c) Visual load at first render.** About 6 fixed controls (search + 4 filters + summarise), plus one chip and one row-button per concept (so 2N for N concepts), plus up to 5 coverage lines, 2 disclosures, the bands table, and one "Open report" per group. With 15 concepts and 8 groups that is roughly **50 interactive elements** before anything is expanded.

**(d) Duplication**
- The concept **chip row** (`:168-183`) and the matrix **row-header buttons** (`:207-213`) do the same thing: both toggle `selected`. Every concept appears twice, one above the other.
- Group codes are listed in four places on one page: matrix columns, concept detail, approach "group by group", and the groups list. That is acceptable as context, but it adds noise.
- The "Struggled" / "Understood" vocabulary also appears on the class page's concept graph (other slice). Worth checking the two use the same words.

**(e) Proposals**
1. **Drop the concept chip row** (S). The matrix row headers already select a concept, and the search box and filters already narrow the list. Selection survives through the row-header buttons, which should get `aria-pressed`.
2. **Put the approach diagnostics behind one disclosure** called "How was this judged?" (S). It would hold the coverage breakdown lines (too short / abstained / not judged / other approach), the bands table and "group by group". The section then opens with the approach name, one coverage line ("assessed in 5 of 8 groups") and the synthesis paragraph. Every line is kept, one click down.
3. Move the pending/summarise box below the concepts (S). Or keep it but make it one line: "3 groups not summarised yet — Summarise now". It currently sits above the thing the teacher came for.
4. Add a colour legend for the matrix (S). See (f).

**(f) ui-guidelines-check**
- `components/teacher/lessons/LessonOverview.tsx:240`: the only legend line explains where "understood" comes from. Nothing tells a sighted user that amber means struggled, sky means discussed, emerald means understood and blank means not mentioned. Colour-only encoding. Fix: add a swatch legend next to the filters.
- `components/teacher/lessons/LessonOverview.tsx:207-213`: the row-header button toggles selection but has no `aria-pressed`. The chip version at `:173` has it. Fix: add `aria-pressed`, and remove the chips (e1).
- `app/teacher/insights/lessons/[classId]/[activityId]/page.tsx:94-98`: "could not be loaded" with no Retry. Fix: a Retry button that bumps `reload`. The state is already there (`:44`).
- `components/teacher/lessons/LessonOverview.tsx:346`: bands rows show raw construct ids in `font-mono`. Fine for a researcher-only table, but if a teacher ever receives `bands` it is jargon. Unverified.

---

## /teacher/insights/conversations (researcher only)

**(a) Purpose.** Every student conversation, grouped by teaching approach, with the transcript and the group's final work.

**(b) Feature inventory** (`app/teacher/insights/conversations/page.tsx`)
- `?approach=<id>` deep link that opens a tab, only on arrival (`:86`). This is used by `TutorCrossviewPanel.tsx:53`.
- **Export CSV** and **Export JSONL** for the active tab (`:245-262`).
- Excluded-sessions note and unattributed-turns note (`:271-278`).
- One tab per approach, with session counts. Approaches with no conversations are included as zero tabs, and there is a "Not recorded" bucket with an explainer (`:280-307`).
- A table of up to 100 sessions per tab: id, tutor (plus whether it was set by the tutor or by the class/activity), class id, activity id, style, turns (readable/total), last, and "Read" (`:317-375`).
- Transcript card: close button, `FinalWorkPanel` (the group's final work on that activity) and `ChatLogTranscript` (`:379-407`).
- Forbidden, unreadable, empty-tab and loading states.

**(c) Visual load.** 2 export buttons, 2 notes, about 9 tabs (7 published approaches + "Not recorded" + custom ones), and an 8-column table with up to 100 "Read" buttons.

**(d) Duplication**
- Transcripts are also readable from `/teacher/reports/groups/[groupId]` (other slice). That is a different entry point (one group versus one approach), so it is acceptable.
- The tab strip is a hand-rolled copy of `TeacherTabs` (`:280-301`).

**(e) Proposals**
1. **Merge the two export buttons into one "Export ▾" menu** with CSV and JSONL (S). Both formats are kept.
2. **Show class and activity names, not 10- and 14-character id slices** (`:351-352`) (M, because names need a lookup or a backend join). Keep the id in a tooltip.
3. **Open the transcript in a side sheet, or scroll and focus to it.** Right now it renders below a table of up to 100 rows, off-screen (S–M).
4. Use `TeacherTabs`, and put the active tab in the URL as `?approach=` so Back works (S).

**(f) ui-guidelines-check**
- `app/teacher/insights/conversations/page.tsx:280-301`: a hand-rolled `role="tablist"` with no `aria-controls`, no roving `tabIndex` and no arrow keys. Fix: use `components/teacher/ui/TeacherTabs`.
- `app/teacher/insights/conversations/page.tsx:379-407`: clicking "Read" mounts the transcript below the table with no focus move or scroll. Keyboard and screen-reader users don't learn that anything happened. Fix: focus the transcript heading, or use a sheet.
- `app/teacher/insights/conversations/page.tsx:266`: the export error is a plain `<p>` with no `role="alert"`, so it isn't announced. Fix: add `role="alert"`.
- `app/teacher/insights/conversations/page.tsx:358`: hardcoded date format `slice(0,16).replace("T"," ")`. Fix: `Intl.DateTimeFormat`.
- `app/teacher/insights/conversations/page.tsx:230-236`: the unreadable state copy says "Try again" but there is no button. Fix: add Retry.
- `app/teacher/insights/conversations/page.tsx:366`: the disabled "Read" button has no `disabled:` styling, so it looks active. Fix: `disabled:opacity-50`.

---

## /teacher/insights/cost (researcher only)

**(a) Purpose.** Cross-class spend for a period, with the smart-model share.

**(b) Feature inventory** (`app/teacher/insights/cost/page.tsx`)
- Period select: this month / last month / all time (`:74-87`).
- Total (`:104-107`).
- Smart-tier section: share, a by-reason table, and an over-threshold warning (`:149-190`).
- Spend tables by cohort, model, voice (only if voice was used) and class (`:111-139`).
- A researchers-only notice for anyone else (`:92-95`).

**(c) Visual load.** 1 select and 4–5 small tables. Light.

**(d) Duplication.** "By class" duplicates the Spend column on `/teacher/classes` (own classes only) and the per-class spend in the class-page budget panel (other slice).

**(e) Proposals.** The page is fine as it is. If Overview becomes the researcher-only "All classes" tab (see /teacher/insights e2), add the Spend column there (`spendByClassId` is already supported, `CrossClassTable.tsx:40-42`) and drop "By class" here (S). The data stays available in one table, sortable with engagement next to it.

**(f) ui-guidelines-check**
- `app/teacher/insights/cost/page.tsx:96-99`: error with no Retry. Fix: add Retry.
- `app/teacher/insights/cost/page.tsx:77`: the select is labelled only by an `sr-only` span inside the label. OK. No finding.

---

## /teacher/programme (researcher read-only, programme-admin read/write)

**(a) Purpose.** Who may spend on AIPLA (the register), who has asked (the request queue), who holds which role, and the programme's daily budget.

**(b) Feature inventory** (`app/teacher/programme/page.tsx`, `_BudgetPanel.tsx`, `_GrantForm.tsx`)
- Tabs: Register (n), Requests (pending n), Roles (n) (`page.tsx:582-603`).
- "Nobody is notified" notice (`:608-610`). Roles intro (`:612`).
- **Daily budget panel**, on the Register tab only:
  - Spent today, of the budget.
  - Programme admin only: budget input, warn/block select, Save, Remove budget (`_BudgetPanel.tsx:60-139`).
- **Grant form**, programme admin only, on the Register tab: email, monthly cap (≤ $50) and a required note. Submit (`_GrantForm.tsx`).
- **Register table** (`page.tsx:316-458`):
  - Sort by stage / by grant toggle.
  - Columns: email (with revoked/lapsed badge), tier, onboarding stage chip + next step, cap (inline editor + Save for admins, an "uncapped" alarm), spend this period, expires, granted by + via badge, note, Sim workshop toggle (researchers *and* programme admins), and Revoke (two-step) for admins.
- **Requests table**: email, name, institution, message, status, asked (`:460-497`).
- **Roles table**: email, role chips, grant summary or "no grant" (`:219-276`).
- No-access notice, error and loading states.

**(c) Visual load.**
- Programme admin, Register tab: 3 tabs, notice, budget panel (input + select + 2 buttons), grant form (3 inputs + button), sort toggle, then a 9-column table with 3–4 controls per row.
- With 20 teachers that is **about 70 interactive controls on one screen**.
- A researcher sees the same table minus the cap editor and Revoke, but keeps a checkbox per row.

**(d) Duplication**
- A request row has no "Grant" action. To admit someone who asked, an admin reads the email in Requests, switches to Register, and retypes it into the Grant form. Two tabs serve one job.
- Tier, cap and grant appear in both Register and Roles, deliberately (the Roles "no grant" case). Fine.
- The same register is also reachable through the CLI (`make list-access`), which is out of scope.

**(e) Proposals**
1. **Add "Grant…" on each pending request row** that opens the Grant form pre-filled with the email, and with the institution and message as the note (M). The standalone Grant form stays for people who never asked. This removes the retyping.
2. **Collapse the budget panel and the grant form behind two buttons** at the top of Register: "Daily budget: $x of $y ▸" and "Add a teacher ▸" (S). Both are kept and become one click away. The register table becomes the first thing on the page.
3. **Thin the register table** to email, stage, cap/spend, Sim workshop and actions. Expires, granted-by/via, tier and note go into an expandable row detail, or a "More columns" toggle (M). All columns survive.
4. Use `TeacherTabs` and put the tab in the URL as `?tab=requests`, so the "ask" mail can link straight to the queue (S).

**(f) ui-guidelines-check**
- `app/teacher/programme/_BudgetPanel.tsx:55`: `if (!payload) return null` runs **before** the error is rendered. A failed budget load (`:38`) shows nothing at all, and a researcher can't tell "no budget" from "couldn't read". Fix: render the error with Retry when `payload` is null and `error` is set.
- `app/teacher/programme/page.tsx:194-203`: Revoke has `try/finally` with no `catch`. A failed revoke shows nothing and leaves an unhandled rejection. Fix: catch, show the error inline, and use `useAsyncAction`.
- `app/teacher/programme/page.tsx:157` and `:206`: the busy label is a bare "…". Fix: "Gemmer…" / "Saving…" via `t()`, or `Button pending`.
- `app/teacher/programme/page.tsx:583-602`: tab buttons carry `aria-current="page"`, which is wrong for in-page tabs, and there are no arrow keys. Fix: `TeacherTabs`.
- `app/teacher/programme/page.tsx:432` and `:490`: raw ISO `expiresAt` / `requestedAt`. Fix: `Intl.DateTimeFormat`.
- `app/teacher/programme/page.tsx:620-623`: error with no Retry, even though `load` exists. Fix: a Retry button calling `load`.
- `app/teacher/programme/_GrantForm.tsx:59-66`: the email input has no `name`, `autoComplete="off"` or `spellCheck={false}`. A password manager may offer to fill it. Fix: add them.
- Copy: `TeacherProgrammePage.subtitleReadOnly` says "(read-only)" to researchers, but researchers **can** flip the Sim workshop per teacher (`page.tsx:630`, `canSetFeatures={mayRead}`). Fix: change the subtitle to "… (you can switch features; caps and grants are set by a programme admin)".

---

## /teacher/research/frameworks (reached from the account menu "Approaches"; teacher and researcher tiers)

**(a) Purpose.** For researchers, this is where to read, edit and assign the published teaching approaches, author tutors and faces, try tutors, see usage, and check calibration. A teacher gets a reduced version focused on authoring.

**How a teacher reaches it.** `AccountMenu` → "Tilgange / Approaches" (`components/teacher/ui/AccountMenu.tsx:85`). The page asks for the framework list, and for a non-researcher **the 403 is the branch condition** for the teacher view (`page.tsx:105-109`, `:279-316`).

**(b) Feature inventory**

*Teacher tier* (`:284-315`): a note explaining that the published approaches aren't editable here, then 5 tabs:
1. **Try them** (`TutorPreviewPanel`): pick up to 2 tutors, type a student-like message, "Ask both". Shows side-by-side replies with face, approach and register, plus a "What this tutor was told" disclosure.
2. **Approaches** (`PublishedApproachList`): read each of the 7: summary, behaviour count, an open/close per approach showing constructs, behaviours, and the verbatim instruction.
3. **Your approaches** (`CustomApproachPanel`):
   - Create or edit with name, summary, instruction, register (`RegisterPicker`), and up to N sources (citation, URL, note).
   - Share / make private, Edit and Delete (confirm) icon buttons.
   - An author line and a "researchers can see" notice.
4. **Tutors** (`MyTutorsPanel`):
   - New tutor: name, approach (required), face.
   - A "variant of" button per tutor (`TutorVariantDialog`).
   - Share / private and Delete (confirm).
   - Grouped into "Yours" and "Available to you".
5. **Faces and voices** (`PersonaEditorPanel`): create or edit name, title, avatar picker, voice select and voice prompt (Gemini only). Share / private and Delete (confirm).

*Researcher tier* (`:323-399`):
- "How a tutor gets its approach" disclosure, with a citations box.
- Co-pilot proposal note.
- 7 tabs:
  1. **Approaches**: a vertical rail of the published approaches (placeholder / edited / construct count), and a detail card with:
     - badges (unedited, approach edited, wording edited, placeholder),
     - **Edit teaching approach** (`FrameworkStructureEditor`: summary; per-construct name, what it is, behaviours, avoid, evaluation; references with citation, checked-by and note; reset form; discard saved override; Save),
     - **Source passage search** (`SourcePassagePanel`, which searches the private literature corpus),
     - then `CustomApproachPanel` below the rail.
  2. **Who teaches with what** (`TutorApproachPanel`): a per-tutor approach select, "Undo my choice", and an activity-tutors subsection.
  3. **Try them**.
  4. **Tutors**.
  5. **Faces and voices**.
  6. **Usage** (`TutorCrossviewPanel`): every approach (published and authored), author, status, tutors assigned, turns taught, a link to the conversations for that approach, and the variant count.
  7. **Calibration** (`CalibrationSetPanel`): per-construct agreement with the AI judge, and a JSONL download.
- **Floating tutor co-pilot** (`_TutorCopilot.tsx`, skill `tutor-authoring-assistant`).

**(c) Visual load.**
- Teacher: 1 note, 5 tabs, and the Try panel (≈7 tutor chips, a textarea, a button).
- Researcher: 1 disclosure, 7 tabs, a 7-item rail, a detail card (edit button + search input + search button), the custom-approach list (3 icon buttons per row) and the floating co-pilot.
- That is **about 30 controls** before anything is expanded, and on top of it are the 2 parallel tab systems (outer tabs and the rail).

**(d) Duplication**
- **The menu label doesn't match what's behind it.** The account menu says "Approaches", but for a teacher 4 of the 5 tabs are about tutors and faces. A teacher wanting to "make my own tutor" won't guess "Tilgange".
- `CustomApproachPanel` mounts twice for researchers: under the Approaches rail, and (for teachers) as its own tab. That is fine as code, but the two tiers place it differently.
- Tutor choice is split across pages. **Choosing** a tutor for a class happens on the class page (other slice). **Giving a tutor an approach** happens here under "Who teaches with what" (researcher) and "Tutors" (create with approach). The `LessonOverview` copy `noFramework` tells a teacher to "Pick an approach for the class's tutor". For a teacher that means creating a tutor here and then selecting it on the class page. **Unverified** whether teachers understand that route.
- The judge-lens configuration, also researcher-only, lives on **/teacher/settings** (`app/teacher/settings/_LensConfigPanel.tsx`), not here. Calibration of the same judges is here. One topic, two pages.

**(e) Proposals**
1. **Rename the account-menu entry to "Tutorer" / "Tutors"**, and the page title to "Tutors and teaching approaches" (S). The account-menu key `AccountMenu.approaches` is the change. No feature moves.
2. **Researcher tabs from 7 to 4** (M):
   - "Approaches": rail + editor + custom approaches, as now.
   - "Tutors": a sub-section stack of Tutors, then "Who teaches with what" as a per-row approach select, then Faces and voices.
   - "Try them".
   - "Research tools": Usage, Calibration, and the **judge lenses moved in from Settings**.
   Every panel survives, one level down at most.
3. **Teacher tabs from 5 to 3** (S): "Try them", "Approaches" (published list, then "Your approaches" below it, which is the same order the researcher tier already uses), and "Tutors" (tutors, then faces and voices).
4. **Put the tab in the URL** (`?tab=`), so a guide or a mail can deep-link and Back works (S). `TeacherTabs` already has an `onChange`.

**(f) ui-guidelines-check**
- `app/teacher/research/frameworks/page.tsx:91`: tab state is `useState` only. A refresh or a link always lands on "Approaches". Fix: sync with `?tab=`.
- `app/teacher/research/frameworks/page.tsx:317-322`: the error copy says "Reload to try again", with no button. Fix: add Retry.
- `app/teacher/research/frameworks/page.tsx:153-159` vs `:82-85`: the comment says the co-pilot's Apply "opens the editor on it". The handler only sets a note; it doesn't open the editor or select the approach in the rail. **Unverified** which one is intended. If the comment is right, this is a dropped wiring.
- `components/teacher/research/CustomApproachPanel.tsx:133`, `MyTutorsPanel.tsx:86`, `PersonaEditorPanel.tsx:116`: `window.confirm`. Fix: `useConfirm()` from `components/ui/confirm.tsx`.
- `components/teacher/research/CustomApproachPanel.tsx:132-153`: `remove` and `toggleShare` have `try/finally` with no `catch`. A failure is silent, with an unhandled rejection. Fix: catch and set an error. `MyTutorsPanel` already does this.
- `components/teacher/research/CustomApproachPanel.tsx:276`, `:302`: the `loadFailed` error (`:105`) is rendered **only inside the open draft form**, and the list renders nothing while `rows === null`. A failed load looks like an empty panel with no message. Fix: render the error and Retry above the list.
- `components/teacher/research/TutorPreviewPanel.tsx:58`: catalogue failure is `.catch(() => undefined)`. The picker shows no tutors and no message. Fix: show a failed-read message with Retry.
- `components/teacher/research/TutorPreviewPanel.tsx:66`: a third tutor click is silently ignored at the max of 2. Fix: disable the unpicked chips when 2 are picked, or say "pick up to two" inline when it happens.
- `components/teacher/research/TutorApproachPanel.tsx:118`, `components/teacher/research/SourcePassagePanel.tsx:70`: `Loader2 animate-spin`. Fix: the kit `Spinner`.
- `components/teacher/research/PublishedApproachList.tsx:28`, `MyTutorsPanel` (`failed`), `PersonaEditorPanel.tsx:128`: failed reads say so but have no Retry. Fix: add Retry.
- `components/teacher/research/TutorPreviewPanel.tsx:133`, `CustomApproachPanel` save button: `bg-brand ... text-white`. Fix: `text-primary-foreground` (token), or use the kit `Button`.

---

## /teacher/settings

**(a) Purpose.** Account-wide defaults that seed new activities and classes, plus a signpost to per-class and per-activity settings. Researchers additionally get the judge-lens configuration.

**(b) Feature inventory**
- **Defaults card** (`_DefaultsCard.tsx`): new-activity language (none / da / en), tutor for new classes (from the persona catalogue), concept-map default on/off, beta feature opt-ins (only flags built as `beta`, so it is empty on dev), and a save confirmation note.
- **Signpost** EmptyState: "everything else lives where it applies", linking to `/teacher/classes` (`page.tsx:30-43`).
- **Researcher only, `LensConfigPanel`** (`_LensConfigPanel.tsx`):
  - Per lens: enabled checkbox, model (`ModelSelector`, Google only), the default prompt (disclosure + "copy into editor"), prompt override textarea, Save prompt, Reset.
  - **Experiment box**: session id, lens select, Run. Shows the result profile or the abstain reason.
- Reached from the account menu only (`AccountMenu.tsx:79`). It left the nav in 1.1.125 (`TeacherNav.tsx:70-72`).

**(c) Visual load.** Teacher: 2 selects, 1 checkbox, a beta area and 1 link. Light. Researcher: add per lens 1 checkbox, 1 model selector, 1 disclosure, 1 textarea and 2 buttons (×2–3 lenses), plus the experiment box (input, select, button). **The page roughly quadruples.**

**(d) Duplication.** Judge lenses (here) and judge calibration (`/teacher/research/frameworks` → Calibration) are halves of one research job on two unrelated pages. The "Tutor for new classes" default here overlaps with the class tutor picker on the class page. That is by design ("seeds, never fights").

**(e) Proposals**
1. **Move `LensConfigPanel` to the researcher "Research tools" tab** on `/teacher/research/frameworks` (S–M). Settings then becomes the same small page for everyone. Every lens control and the experiment box move intact.
2. Hide the "Beta features" block when `BETA_FLAGS` is empty (S). Today it always renders an empty-state sentence (`_DefaultsCard.tsx:127-150`). The comment says it is shown "so teachers learn where betas will appear", which is a judgement call for M. See the open questions.

**(f) ui-guidelines-check**
- `app/teacher/settings/_LensConfigPanel.tsx:72`, `:265`: `text-red-600`. Fix: `text-destructive`. The brand-literal guard evidently doesn't cover this file, or allowlists it. Worth checking `scripts/check-brand-literals.sh` scope.
- `app/teacher/settings/_LensConfigPanel.tsx:64-69`, `:179`, `:259` and `_DefaultsCard.tsx:59-152`: raw `violet-*` / `slate-*` palette instead of tokens (`border-border`, `text-muted-foreground`, `bg-muted`). These are the only teacher-shell surfaces in this slice not on tokens.
- `app/teacher/settings/_LensConfigPanel.tsx:67` and `_DefaultsCard.tsx:62`: decorative icons with no `aria-hidden`. Fix: add `aria-hidden="true"`.
- `app/teacher/settings/_DefaultsCard.tsx:152` and `_LensConfigPanel.tsx:194`: the save/failure note is a plain `<p>`/`<span>`, not announced. Fix: `role="status"`, or `notify()`.
- Copy: `LensConfigPanel.intro` shows the sprint number "(1.1.57)" in UI text. Fix: remove it.

---


# Features that must survive

A later build is checked against this list. Every item is reachable today; a simplification may move it, never drop it.

### Shell

- [ ] Brand link home to the class list; `/teacher` redirects to `/teacher/classes`
- [ ] One header entry to the page's work co-pilot (class list, class page, builder, approaches)
- [ ] Help co-pilot (flag `aiplaHelp`)
- [ ] Guides (`/guides`) reachable from every teacher page
- [ ] Account menu: Settings, approaches/tutors page, language DA|EN, sign out; signed-in email visible
- [ ] Nav: classes, activities, materials, insights; Sims (flag, locked state with how-to-ask); Programme (researcher or programme admin)
- [ ] Collapsible desktop nav, remembered per browser
- [ ] Researcher role is visible somewhere on every page
- [ ] Visitor banner (join programme, switch account); privacy notice acknowledgement
- [ ] Footer (privacy, terms, credits); first-sign-in demo seed

### Classes, class page, compare, group report

Classes list
- [ ] Open a class
- [ ] Create a class (name, description; default tutor applied)
- [ ] Delete a class (with confirm)
- [ ] Class co-pilot (manage-class) with Apply
- [ ] Getting-started checklist, its six step actions, guide link, Hide when live
- [ ] Search classes; filter by activity state
- [ ] Per-class: last activity, turns, groups active, live code count, assigned activity titles (linking to editor), tutor (+ default marker)
- [ ] Cross-class engagement table (sortable), window 7 d/30 d/all, spend column, four totals
- [ ] Recent sessions across classes, linking to a session report
- [ ] Researcher: all-teachers scope, owner, stage chip, deleted-by-teacher marker, Set up a class for a teacher (teacher, name, template)

Class page
- [ ] Compare groups entry
- [ ] Acting-for-owner banner and last-edited line
- [ ] Analytics co-pilot for this class
- [ ] Class / tutor / activity explanation (settings map)
- [ ] Latest lesson: concept chips, next time, open lesson overview, all lessons
- [ ] After-lesson review: five steps, skip, Add to next activity
- [ ] Concepts across the class: graph, legend, per-group status, flags, teacher override
- [ ] Live: raised hands + Acknowledge, AI class summary, per-group active/idle/turns/stuck, link to report
- [ ] New group code (auto-copied)
- [ ] Per code: copy join link, copy code, reset session, revoke, report
- [ ] Revoked codes list with date, last activity, local names, report link
- [ ] Class list: names/notes per code (browser only), download Excel, import Excel/CSV, storage-unavailable warning
- [ ] Rename class, edit description
- [ ] Choose tutor, clear tutor, see what an approach does, group-talk tutors blocked without recording
- [ ] Link to teaching approaches
- [ ] Student voice input toggle; record-this-class toggle with consent text
- [ ] Clear a legacy custom voice
- [ ] New activity for this class; assign from library; edit; remove; failed-materials warning with Retry
- [ ] Spend: period, total, projection, voice, by day, top activities, top groups
- [ ] Class insights: window, six KPIs with definitions/queries, trend, per-group and per-activity bars
- [ ] Recent sessions (10) with report links; CSV and JSON export of all sessions
- [ ] Groups that can help each other

Compare
- [ ] Activity + element pickers, auto-refresh toggle, read-at stamp, per-group miniatures, slope + outlier, stale + retry

Group report
- [ ] Breadcrumb to class and lesson
- [ ] Latest or chosen session (`?session_id=`); live badge / last active
- [ ] AI summary, regenerate, provenance line
- [ ] Teaching approach read, drift, read-about link
- [ ] Researcher: construct detail, evidence links into transcript, corrections, history, run comparison
- [ ] Group time, messages, sim runs
- [ ] Final work (tables, charts, writing, checklist, concepts)
- [ ] Transcript with work interleaved, citations, remembered open state
- [ ] CSV and JSON export
- [ ] Recording transcript


### Activities, builder, materials, sims

Activities library
- [ ] Create a new activity (header and empty state)
- [ ] Search own activities; filter by subject, level and tags (multi); clear filters; see the count "N of M"
- [ ] See each activity's composition (sim, elements, documents), goal snippet and students' language
- [ ] See failed materials on a card, and retry each from the card
- [ ] Change visibility Private ↔ Shared; see Draft as a read-only state with the "Review & save" route
- [ ] File an activity (subject, level, tags) and see inherited facets from its materials
- [ ] Edit, Duplicate (as a draft) and Delete (with confirm)
- [ ] Assign and unassign an activity to each class; a draft cannot be assigned
- [ ] Browse colleagues' shared activities grouped by owner, with their own search and filters, and adopt one ("Use / adapt")
- [ ] The `#shared` deep link from the getting-started checklist
- [ ] Researcher: switch to all teachers' activities (`?scope=all`), see the owner, and open any activity in the editor

Create and edit (builder)
- [ ] Preselect the class from `?classId`; seed the goal from `?brief`; seed the language and concept map from account defaults
- [ ] Templates: filter by family, apply one, start blank; see the "applied" state
- [ ] Choose the class (create); see the inherited tutor and link to class settings
- [ ] Name, students' language, teaching goal with lint (Move to tutor notes / Keep / Undo), tutor notes with "move back"
- [ ] Student introduction, "I'll introduce it myself", up to 4 starter prompts, intro preview
- [ ] Attach or remove a sim (search, level filter, screenshot)
- [ ] Checklist, data tables, charts, calculator (with formula validation and help), note, writing fields (word target), solution editor, document upload, concept map (concepts, builds-on, done-when, check questions; Suggest via co-pilot; the before-lesson nudge)
- [ ] Materials: search, upload document or image, cite/uncite, Reference vs In context, Students can open vs Tutor only, "Opens first" marker, image visible/hidden, view extracted text, tag/subject/folder editing, RAG status and retry
- [ ] Section nav with counts; builder hints (language mismatch, duplicate columns, untitled tables)
- [ ] Live preview plus the full-screen pop-out
- [ ] Save or Create with success and failure feedback; Create another; go to the editor after create
- [ ] Try as student (act- activities)
- [ ] History: original vs adapted from X, visibility, created and updated dates, last edited by someone else
- [ ] Researcher: acting-for-owner banner; model tier (default or smart)
- [ ] Authoring co-builder (flagged): proposals with Apply / Edit / Dismiss into the draft

Materials library
- [ ] Search, upload, researcher "share to shared library"
- [ ] Filter by subject, folder (including Unfiled), level (including No level) and tags
- [ ] Create a folder; delete a folder (its docs become unfiled, true-count confirm)
- [ ] Organise a document: subject, folder (same scope), tags
- [ ] Delete a document (own or shared, scope-aware warning)
- [ ] RAG status with retry (shared docs: researchers only)
- [ ] Extracted-text viewer; load more

Sim workshop
- [ ] Locked state with "ask to have it switched on"; unavailable state when flagged off
- [ ] New simulation (new chat); open an earlier draft and its chat
- [ ] Import a sim (.html, or .html + .yaml)
- [ ] Per-draft version, level and cost line
- [ ] Try the latest version live in the sandbox
- [ ] Publish (approve plus level 3); ask for the shared library with a note; withdraw; see library status, declined note and newer-draft notice
- [ ] Download the portable file, index.html and the catalogue entry, per version
- [ ] Screenshots (at rest, after clicking, phone); "what stopped it"; level help
- [ ] Earlier versions
- [ ] Researcher: library review queue (try, note, approve, decline)
- [ ] Docked sim-author assistant; refresh (manual and automatic)

---


### Insights, programme, research, settings

Insights
- [ ] Insights is reachable from the main nav; Lessons is reachable as an Insights destination.
- [ ] Cross-class engagement table: sort by class, groups, messages, Δ vs prior, sim runs, last activity; class name links to the class page.
- [ ] Time window 7d / 30d / all on the cross-class table.
- [ ] Researcher: all-teachers vs my-classes scope; Owner column in the all view.
- [ ] Per-class spend sortable beside engagement (the `/teacher/classes` Spend column).
- [ ] Lessons list per class with `?class=` memory; open a lesson.
- [ ] Lesson: summarise pending sessions (capped at 8) with failure message; pending and unsummarisable counts.
- [ ] Lesson: concept search, status filter, concept × group matrix, concept detail with per-group evidence, "on the concept map" marker, legend on where "understood" comes from.
- [ ] Lesson: approach name, coverage (assessed, too short, abstained, not judged, other approach), synthesis, group-by-group readings with drift, bands table (researcher).
- [ ] Lesson: class "what next" synthesis and per-group next-time lines.
- [ ] Lesson: groups list with flags, not-summarised badge, main concept, "Open report" deep link carrying `session_id`, `lessonActivity`, `lessonDate`.
- [ ] Researcher Conversations: per-approach tabs incl. zero-conversation approaches and "Not recorded"; `?approach=` deep link; excluded and unattributed notes; session table; transcript with final work; CSV and JSONL export.
- [ ] Researcher Cost: period; total; smart-tier share by reason with threshold warning; by cohort, model, voice, class.

Programme
- [ ] Register with stage chip and next step, sort-by-stage, cap and spend per teacher, uncapped alarm, expires, granted by/via, note.
- [ ] Programme admin: grant (email, cap ≤ ceiling, required note), edit cap inline, two-step revoke.
- [ ] Researcher and programme admin: per-teacher Sim workshop switch.
- [ ] Daily programme budget: read (spent today of budget) for both roles; set, warn/block and remove for programme admin.
- [ ] Requests queue with name, institution, message, status, date; pending count on the tab.
- [ ] Roles table with role chips and "no grant" warning.
- [ ] "Nobody is notified" notice.

Research / tutors
- [ ] Teacher: try up to 2 tutors side by side, with "what this tutor was told".
- [ ] Teacher: read the published approaches (constructs, behaviours, verbatim instruction).
- [ ] Teacher and researcher: create, edit, delete, share/unshare a custom approach with register and sources.
- [ ] Teacher and researcher: create a tutor (name, approach, face); make a variant; share/unshare; delete.
- [ ] Teacher and researcher: create and edit faces and voices (avatar, voice, voice prompt); share/unshare; delete.
- [ ] Researcher: "how it works" and citations explainer.
- [ ] Researcher: approaches rail with edited/placeholder state; structure editor (constructs, behaviours, avoid, evaluation, references with checked-by); reset form; discard saved override.
- [ ] Researcher: source passage search per approach.
- [ ] Researcher: assign an approach to each tutor (incl. activity tutors); "No stated approach" vs "Undo my choice".
- [ ] Researcher: usage cross-view with link to that approach's conversations; variant count.
- [ ] Researcher: calibration set table and JSONL download.
- [ ] Researcher: tutor-authoring co-pilot and its proposal note.

Settings
- [ ] Default activity language, default class tutor, concept-map default, beta opt-ins.
- [ ] Signpost to per-class and per-activity settings.
- [ ] Researcher: per-lens enable, model, default prompt view and copy, prompt override save and reset; experiment (score a session with a lens).

---


# Open questions for M

Grouped by area, with the decision that unblocks the most work first.

**Timing and scope**
1. Which of these land before the 26 Nov pilot sessions? Two things are suggested before then:
   - the trust fixes (summary item 1);
   - the copy-only changes (item 7).
   The layout changes (items 2–6) move things teachers will have just learned.
2. Class page: split it into Lesson / After the lesson / Setup tabs, or keep one long page with fewer, merged sections? If it is merged into one table, the browser-only class list (local names) sits beside server data. The privacy guard (`_ClassListSheet.test.tsx`) would then have to cover the merged component.

**Duplicates: which home wins**

3. Should a plain teacher still see Insights → Overview? The same table is already on `/teacher/classes`, with spend added. If yes, which copy goes: the panel on the classes page, or Overview, which would become a researcher-only "All classes"?
4. Should the Insights nav entry open Lessons instead of Overview?
5. Is Cost → By class still needed once per-class spend is in one place?
6. Approaches appears both in the account menu and in the class page's Tutor setting (already flagged as JB/AR's decision, `AccountMenu.tsx:17-18`). Which entry survives, and is "Tutorer" the right name for it?
7. Should Delete class move off the list row into class settings? Should the per-class "Where settings live" box stay at all? Its copy says activities are edited "here", which is wrong on the class page.

**Activities and materials**

8. The "Code" tab mock: remove it from the deployed UI, or keep it for researchers only, for design conversations?
9. Creating an activity requires a class, although activities do not belong to a class (ALS-1). Should "Create" from the library allow "no class yet"?
10. An activity can sit in several classes with different tutors. Which tutor should the editor show? The answer shapes the `classId` fix.
11. Any teacher can delete a *shared* library document for every teacher, after one confirm (`MaterialsSection.tsx:268-276`). Adding to the shared library is already researcher-only. Should deleting shared documents be researcher-only too?
12. Sharing an activity (Private → Shared) takes one click. Should it ask for confirmation or offer undo?
13. If the concept map or the authoring co-builder flag is graduating for the pilot schools, the "Add to the workspace" menu should include it from the start. Is either graduating?

**Researcher surfaces**

14. Researchers can switch the Sim workshop on per teacher, yet the Programme page calls itself "read-only" for them. Which is intended?
15. Judge lenses: keep them on Settings, or move them next to Calibration under a researcher "Research tools" tab? Are lenses still in active use (RUBRIC-1)?
16. The Danish word for "construct": "træk", "element" or "konstrukt"? It must not be "begreb", which already means a physics concept on the lesson page.
17. The approach co-pilot's "Apply" button: should it open the structure editor on the proposal, as the page comment says, or only show the note, as the code does?
18. Conversations: may the researcher table show class and activity **names** across teachers, or must it stay at ids?
19. `LessonOverview.noFramework` tells a teacher to "pick an approach for the class's tutor". The only route appears to be: create a tutor with an approach under Tutors, then select it on the class page. Is that the intended route, and should the copy say so?

**Smaller**

20. Should the AI model name on the group report be visible to teachers, or to researchers only?
21. Should a group report link to all of that group's sessions? The crumb says "Session history", but the page shows one session.
22. Sim workshop:
    - Should teachers see the per-draft cost ("≈ $0.42 · 312k tokens"), or only researchers?
    - The access-request mail goes to M's personal address, hard-coded at `app/teacher/sims/page.tsx:53-55`. Should that change before AD takes a share of support?
23. The "Forsker" pill in the header: keep it, or fold it into the account menu now that `ActingForOwnerBanner` covers editing someone else's work?
24. The "Beta features" block on Settings: always visible with an empty state, or hidden until a beta exists?
