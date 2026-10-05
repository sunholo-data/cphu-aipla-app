# Seminar chat-surface fixes — LaTeX, auto-scroll, a misspelt heading, opening documents

**Status:** Design (OPEN) — **1.1.147**
**Priority:** **P1** for M0 (LaTeX) and M1 (auto-scroll): visible on every tutor turn in a live class · **P2** for M2 (spelling) and M3 (document click-through)
**Estimated:** ~2d phased (M0 LaTeX ~0.75d · M1 auto-scroll ~0.5d · M2 opsamling ~0.1d once located · M3 document click-through ~0.5d, plus a decision)
**Scope:** Frontend only, unless M2 turns out to be data. `components/chat/ChatMarkdown.tsx`, `components/chat/StreamingBubble.tsx`, `components/chat/ChatMessageList.tsx`, a new `lib/mathDelimiters.ts`, `components/workspace/DocumentsPanel.tsx`, `app/chat/[...path]/page.tsx` (the `navigateToBlock` prop), `messages/{da,en}/chat.json` + `workspace.json`. Optionally one line in `backend/skills/preambles/math_notation.md` (reaches prod by **deploy**, not seed).
**Dependencies:** none blocking. Touches the same files as [chat-svg-streaming-placeholder](implemented/chat-svg-streaming-placeholder.md) (shipped) and [1.1.108 content-localisation](content-localisation.md) (student copy goes through `useT()`). [student-notation-strip](../v2.1.0-extension/student-notation-strip.md) is the *student-input* half of notation; this doc is the *tutor-output* half and does not change it.
**Created:** 2026-10-05
**Source:** Teacher seminar 2026-10-05, [notes-2026-10-05.md](../../../notes-2026-10-05.md). M's four notes, verbatim: *"Latex rendering in chat"*, *"Spelling in table heading wrong (opsamling)"*, *"Can you click on documents to see them?"*, *"It's not auto scrolling on chat"*.

## Problem Statement

Four small defects on the student chat surface, seen by teachers on prod. Each was
traced against the code on 2026-10-05. **Nothing below was checked against prod
data**; every "confirm with" query is for M to run.

| # | Defect | Cause | Confidence |
|---|---|---|---|
| 1 | LaTeX not rendering | (a) `remark-math` 6 accepts only `$…$` / `$$…$$`; `\(…\)` and `\[…\]` reach the student as `(v = \frac{s}{t})`. (b) The streaming bubble renders raw text, so every formula shows as source until the turn ends | (a) **verified** by running the installed pipeline; that the model emitted `\(` on 10-05 is **hypothesis** · (b) **verified** by reading |
| 2 | "opsamling" misspelt in a table heading | No form of *opsamling* exists anywhere in the repository. The heading is data: a teacher-authored table title/column label, or a tutor-generated Markdown table | **verified** absent from repo; location **hypothesis** |
| 3 | Can students click documents? | Teacher-attached materials open only if the teacher flipped *studentVisible*, which defaults to **off**; otherwise they are listed by name, unclickable. Document names in tutor replies are never clickable: the chat page passes no `navigateToBlock`, so the citation handler is a no-op | **verified** by reading |
| 4 | Chat does not auto-scroll | "Near bottom" is measured **after** the content has already grown, against a 100 px threshold. Any single growth step over 100 px (a finished turn swapping from raw text to rendered Markdown, a table, an SVG, a tool card, a restored history) reads as "the student scrolled up" and stops following | **verified** by reading; browser reproduction pending |

## M0 — LaTeX renders in tutor replies (~0.75d)

### What the code does

- `frontend/src/components/chat/ChatMarkdown.tsx:242-246` runs `remarkGfm, remarkMath` and `rehypeHighlight, rehypeKatex` with default options. Installed versions: `remark-math` 6.0.0, `rehype-katex` 7.0.1, `katex` 0.16.47.
- The preprocessing `useMemo` (`ChatMarkdown.tsx:82-109`) strips citation markers and extracts SVG; it does nothing to maths delimiters.
- `backend/skills/preambles/math_notation.md:14-15` (applied to every tutor via `backend/adk/math_notation.py`) tells the model: *"`$…$` inline, `$$…$$` for display."* The instruction is right; nothing makes compliance certain, and the module's own docstring (`math_notation.py:41-44`) says only an eval can prove it.
- `frontend/src/components/chat/StreamingBubble.tsx:33-36` renders `message.content` inside a `whitespace-pre-wrap` `<p>`. **No Markdown, no KaTeX** while the turn streams; `ChatMessageList.tsx:328-335` swaps it for `MessageBubble` → `ChatMarkdown` only when the message finalises (`MessageBubble.tsx:301-302`).
- `frontend/src/components/chat/__tests__/ChatMarkdown.test.tsx` has **no maths test at all**.

### Verified behaviour of the installed pipeline

Run on 2026-10-05 through `unified` + `remark-parse` + `remark-gfm` + `remark-math` + `remark-rehype` + `rehype-katex` from `frontend/node_modules`:

| Input shape | Rendered? | What the student sees |
|---|---|---|
| `$v = 0{,}2 \text{ m/s}$` | yes | typeset |
| `$$E = P \cdot t$$` (own paragraph, or mid-line) | yes | typeset |
| `$v_0$` inside a GFM table cell | yes | typeset |
| `$\theta = 40°$`, `$T = 20\text{ °C}$`, `\text{strækning}` | yes | typeset (KaTeX may log a strict-mode warning for unicode in math mode) |
| `\(v = \frac{s}{t}\)` | **no** | `(v = \frac{s}{t})` — Markdown consumes the escaping backslash, so even the delimiter is lost |
| `\[E = mc^2\]`, single- or multi-line | **no** | `[E = mc^2]` |
| `$\SI{9.82}{m/s^2}$` (siunitx) | partly | `\SI` shown as unknown-macro text |
| `E = \frac{1}{2} m v^2` (unwrapped) | no | raw source |
| `Farten er $v = \frac{s}{` (mid-stream) | no | raw source, until the closing `$` arrives |
| `Det koster $5 og $10.` | **false positive** | "5 og " typeset as maths (low risk in Danish, which writes *kr.*) |

`\(…\)` and `\[…\]` are the delimiters Gemini models commonly emit when not held to `$`, which makes (a) the leading hypothesis for *"Latex rendering in chat"*. (b) is certain regardless: every formula is shown as source for the whole duration of the stream, which a teacher watching a turn arrive would also describe as "LaTeX not rendering".

### Change

1. **`frontend/src/lib/mathDelimiters.ts`** — `normalizeMathDelimiters(text: string): string`. Rewrites `\(…\)` → `$…$` and `\[…\]` → `$$…$$` (display form padded with blank lines so it is its own block). Skips fenced code blocks and inline code spans. Idempotent on `$`-delimited input. Pure; unit-tested in isolation.
2. **`ChatMarkdown.tsx`** — call it in the preprocessing `useMemo`, after `stripCitationMarkers`, before SVG extraction.
3. **Streaming renders Markdown.** `StreamingBubble` renders `ChatMarkdown` instead of raw text, with a **tail guard**: `holdOpenMath(text)` (same new module) cuts the content at an unclosed `$`, `$$`, `\(` or `\[` at the tail and renders the held-back fragment as nothing (or a `…`), so source never flashes and KaTeX never re-parses a half formula. Keep the blinking cursor. This also removes the layout jump at finalisation that feeds M1.
4. **Optional, only if the M0 query finds siunitx:** pass `rehypeKatex` a small `macros` map (`\degree` → `^\circ`; `\unit{#1}` → `\,\mathrm{#1}`; `\SI{#1}{#2}` → `#1\,\mathrm{#2}`). Do not add it speculatively.
5. **Optional belt-and-braces:** one line in `math_notation.md` — *"Never use `\(…\)` or `\[…\]`."* Reaches prod by **deploy**, not seed (`math_notation.py:36-39`). The frontend normaliser is the fix; the prompt line only reduces how often it is needed.

Do not set `singleDollarTextMath: false` to cure the currency false positive: the preamble *instructs* single-dollar inline maths.

### Acceptance

- Every row marked "no" in the table above that has a delimiter renders typeset; the unwrapped row is unchanged (no guessing at undelimited LaTeX).
- A streaming turn never shows a `$`, `\(`, `\[` or `\frac` source fragment to the student.
- Code blocks containing `\(` are untouched.

### Tests

- `frontend/src/lib/__tests__/mathDelimiters.test.ts` — normaliser and tail guard, including: nested braces, two inline formulas on one line, display form mid-paragraph, `\(` inside a ```` ``` ```` fence and inside a `` ` `` span (untouched), already-`$` input (identity), Danish `{,}` decimals, unterminated `$`, `$$`, `\(` at the tail.
- `frontend/src/components/chat/__tests__/ChatMarkdown.math.test.tsx` — a **fixture of real model-output shapes** (`__fixtures__/tutor-math-shapes.ts`): one case per row of the table above, plus a GFM table with maths in cells and a reply mixing an SVG block with a display formula. Assert on `.katex` count and on the **absence** of literal `\frac` / `\(` in `textContent`. When M's query returns real turns, paste 3–5 of them (anonymised, no group ids) into the fixture.
- `StreamingBubble.test.tsx` — extend: partial content with an open `$` renders no `$`; completed inline formula renders `.katex`.

### Confirm from the 2026-10-05 prod logs (M runs this)

Roles in `chat_turns` are `'student'` and `'tutor'` (`backend/analytics/research_logs.py:75-76`) — a query on `'assistant'` silently returns zero.

```sql
SELECT app_version,
  COUNT(*) AS tutor_turns,
  COUNTIF(REGEXP_CONTAINS(content, r'\\\(')) AS paren_inline,
  COUNTIF(REGEXP_CONTAINS(content, r'\\\[')) AS bracket_display,
  COUNTIF(REGEXP_CONTAINS(content, r'\$\$')) AS dollar_display,
  COUNTIF(REGEXP_CONTAINS(content, r'(^|[^$])\$[^$\s]')) AS dollar_inline,
  COUNTIF(REGEXP_CONTAINS(content, r'\\(frac|cdot|Delta|theta|text)\b')
          AND NOT REGEXP_CONTAINS(content, r'\$|\\\(|\\\[')) AS bare_latex,
  COUNTIF(REGEXP_CONTAINS(content, r'\\(SI|si|unit|qty|degree)\{')) AS siunitx
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE DATE(ts, 'Europe/Copenhagen') = '2026-10-05' AND role = 'tutor'
GROUP BY app_version;
```

`paren_inline + bracket_display > 0` confirms (a). If both are zero and `dollar_*` are non-zero, (a) is refuted and the seminar saw (b) or a KaTeX-unsupported command; pull a few rows with `LIMIT 5` to see which.

## M1 — The chat follows the conversation (~0.5d)

### What the code does

`frontend/src/components/chat/ChatMessageList.tsx`:

- `:91` `SCROLL_THRESHOLD = 100`.
- `:136-140` `isNearBottom()` = `scrollTop + clientHeight >= scrollHeight - 100`.
- `:152-164` a `ResizeObserver` on the inner content calls `isNearBottom()` **inside the resize callback**, i.e. after the new content is laid out. If the student was exactly at the bottom and the content grew by 150 px, the distance is now 150 px, so the list concludes the student scrolled up, shows the badge and does not scroll.
- `:142-146` scrolls with `behavior: "smooth"`. During fast streaming, the next resize callbacks measure a `scrollTop` that is still mid-animation, so the gap can accumulate past 100 px and lose the lock even when each step is small.
- There is **no initial scroll**: a resumed session (`initialMessages`, `:245-285`) mounts with `scrollTop = 0`, the history makes the gap far above 100 px, and the student lands at the top of an old conversation.
- Only the inner content is observed; a shrinking *container* (the `PinnedWelcome` box above it, `:231-233`, expanding; the mobile keyboard opening) changes the gap without a callback.
- `:345-352` the badge text `↓ New message` is an inline English literal on a student surface — a 1.1.108 violation that `make check-i18n` does not catch because it contains no æ/ø/å.

Growth steps above 100 px are routine: finalisation swaps the raw-text `StreamingBubble` for rendered Markdown (M0 (b)), a GFM table or SVG lands, an MCP-App or tool card mounts, the student's own message plus the typing indicator appear together. Long replies on a narrow chat column (`md:max-w-xl` in the workspace layout) make each step larger.

Relevant timing: `2a1d0619` (2026-10-05 13:33) made `PinnedWelcome` mount for **every** student session (privacy notice), reducing the scroll area's height. Whether the seminar ran on a build with it is an `app_version` question (below); it is not the cause, but it makes the symptom more frequent on small screens.

### Change

Replace "measure after growth" with **stick state recorded before growth**:

- `stickRef` (a ref, not state): `true` on mount and whenever the session id changes.
- `onScroll`: recompute `stickRef = distanceFromBottom <= THRESHOLD`, **ignoring scroll events caused by our own programmatic scroll** (set a flag before scrolling; clear it on the next frame).
- `ResizeObserver` on **both** the inner content and the scroll container: if `stickRef`, set `scrollTop = scrollHeight` immediately (`behavior: "auto"`); otherwise show the badge.
- When the student **sends** a message, force `stickRef = true` (sending is an explicit "I am here"). Expose this as a prop/callback from the page, or detect a new `role: "user"` message at the tail.
- Keep `behavior: "smooth"` only for the badge click.
- Move the badge copy to `messages/{da,en}/chat.json` (`ChatMessageList.newMessage`) and read it with `t()`; replace the `↓` glyph with a lucide `ArrowDown` icon.

A library (`use-stick-to-bottom`) does this, but it is one more dependency in the security-audit pile for ~40 lines; prefer the in-house version unless it turns out harder than described.

### Acceptance

- At the bottom, a single growth of 600 px keeps the view at the bottom.
- Scrolled up 300 px by the student, growth does not move the view and the badge appears; clicking it scrolls down and hides it.
- A resumed session opens at the latest message.
- Sending a message from a scrolled-up position scrolls to the bottom.

### Tests

`frontend/src/components/chat/__tests__/ChatMessageList.scroll.test.tsx`. The global `ResizeObserver` in `src/test/setup.ts:5-8` is a no-op, so the file installs a **controllable** mock (capture the callbacks; a `fire()` helper) and stubs `scrollHeight` / `clientHeight` / `scrollTop` on the scroll element with `Object.defineProperty`. Cases mirror the four acceptance bullets, plus "a programmatic scroll does not clear the stick state". Assert on `scrollTop`, not on `scrollTo` having been called. No `localStorage` is touched, so `make test-frontend-ci-node` is not required for M1.

### Confirm from the 2026-10-05 prod logs (M runs this)

Scrolling is client-only, so the logs can show *exposure*, not the bug itself:

```sql
SELECT app_version,
  COUNT(*) AS tutor_turns,
  APPROX_QUANTILES(LENGTH(content), 4) AS length_quartiles,
  COUNTIF(LENGTH(content) > 400) AS long_turns,
  COUNTIF(REGEXP_CONTAINS(content, r'\n\|\s*-{3}')) AS with_table,
  COUNTIF(STRPOS(content, '<svg') > 0) AS with_svg,
  COUNT(DISTINCT session_id) AS sessions
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE DATE(ts, 'Europe/Copenhagen') = '2026-10-05' AND role = 'tutor'
GROUP BY app_version;
```

Plus `make screen-sizes ENV=prod DAYS=1` for the viewport widths in use. A high share of turns over ~400 characters (≈ 5+ lines in the chat column) is consistent with the 100 px threshold being crossed in one step.

## M2 — The misspelt "opsamling" heading (~0.1d once located)

### What was searched

`git grep -niE "opsam|opsml|samling"` across the whole repository (frontend messages, `frontend/src/lib/activityTemplates.ts`, `backend/skills/templates/*/SKILL.md`, `backend/frameworks/*.yaml`, `infrastructure/mcp-sandbox/artefacts/`, content Markdown): **no occurrence of *opsamling* in any spelling**, correct or not. The only `samling` hits are *kredsløbssamling*, *formelsamling* and *samlingen* — all spelt correctly. The platform's own copy therefore does not contain the heading.

### Where it must be (hypotheses, in order)

1. **A teacher-authored table element** — `TableElement.title` (≤120 chars) or `TableColumn.label` (≤80), `backend/db/models/activity_config.py:121-151`, stored in Firestore `activity_configs` (`backend/db/activity_configs.py:35`) and, for published activities, `activities` (`backend/db/activities.py:26`). Rendered by `WorkbenchTable.tsx:318-321`. Either typed by the teacher or proposed by the authoring co-pilot.
2. **A tutor-generated Markdown table in chat** — a heading such as *Opsaming* in a GFM table the model wrote.
3. A teacher-authored sim's own HTML (stored as data, not in the repo).

### Lookup (M runs, prod read)

Chat first, cheapest:

```sql
SELECT ts, role, activity_id, app_version, SUBSTR(content, 1, 300) AS head
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE DATE(ts, 'Europe/Copenhagen') BETWEEN '2026-09-28' AND '2026-10-05'
  AND REGEXP_CONTAINS(LOWER(content), r'ops[a-zæøå]{0,3}m[a-zæøå]{0,3}(ng|ing|nig|lig)|opsml')
ORDER BY ts;
```

Then Firestore, from `backend/` with prod ADC (read-only; a throwaway, not committed):

```bash
cd backend && GOOGLE_CLOUD_PROJECT=aipla-prod-2026 uv run python - <<'EOF'
import json, re
from db.firestore import query_documents
pat = re.compile(r"ops[a-zæøå]{0,3}m[a-zæøå]{0,3}(ng|ing|nig|lig)|opsml", re.I)
for coll in ("activity_configs", "activities"):
    for d in query_documents(coll, filters=[]):
        s = json.dumps(d, ensure_ascii=False, default=str)
        for m in pat.finditer(s):
            print(coll, d.get("activityId") or d.get("id"), s[max(0, m.start()-80):m.end()+40])
EOF
```

(Confirm `query_documents`' signature and the environment variable the client reads before running; the snippet is a shape, not a tested script.)

### Change

- **If found in activity data:** correct the field through the activity builder as the owning teacher (or tell the teacher); no code change. If the co-pilot wrote it, note it in the open questions — a spelling slip in co-pilot output is a model-quality observation, not a bug.
- **If found in a tutor turn:** nothing to fix in code; record it.
- **If found in neither:** ask M for a screenshot; do not guess.

No test unless the heading turns out to come from code, in which case the fix lands in `frontend/messages/da/*.json` and `make check-i18n` covers it.

## M3 — Students can open the documents they are shown (~0.5d + a decision)

### What is and is not clickable today (verified)

| Where | Clickable? | Code |
|---|---|---|
| Teacher material marked *student-visible* | **yes** — opens inline in the workbench | `DocumentsPanel.tsx:151-164`, `openContent` `:94-108` |
| Teacher material **not** student-visible (the **default**) | **no** — listed by name under *"Bruges også af tutoren — navnet vises, indholdet deles ikke"*, dashed border, no handler | `DocumentsPanel.tsx:170-197`; default `student_visible=False` at `backend/db/models/activity_config.py:93`, `studentVisible: false` on attach at `components/teacher/MaterialsSection.tsx:322` |
| Image materials, student uploads | yes — thumbnail / zoom | `DocumentsPanel.tsx:133-149`, `:199-215` |
| A document the tutor names in a reply | **no** — plain text. The backend emits no `aitana://doc/…` links (no non-test hit in `backend/`), and even if it did, the chat page passes no `navigateToBlock` to `ChatMessageList` (`app/chat/[...path]/page.tsx:1300`), so `InlineCitation` would call the no-op stub at `ChatMessageList.tsx:131-134` |
| PDF links (`https://….pdf`) in a reply | yes — `PDFCard` | `ChatMarkdown.tsx:122-127` |
| On a phone, any document | only from the *workspace* tab; the chat tab has no route to it | `page.tsx` mobile tab bar |

The off-by-default is deliberate — only copyright-cleared material may be shown to students (see the curriculum-clearance decision) — so the seminar question most likely came from a teacher seeing names their students could not open.

### Change

- **M3a — say why.** For a not-shared material, add a one-line explanation the student can read (`workspace.json`: *"Din lærer har ikke delt indholdet af dette dokument"*), and on the teacher side make the per-material *students can open* toggle visible at a glance in `MaterialsSection` (state, not only an icon). No change to the default.
- **M3b — a document named in chat opens it.** Pass a real `navigateToBlock` from the chat page that opens the matching student-visible material in the workspace documents panel (lift `openDoc` out of `DocumentsPanel` behind a small context, or a callback through `StudentWorkspace`), switching the mobile tab to the workspace. A not-shared doc opens nothing and shows M3a's message.
- **M3c — the tutor links what it cites** (only if M decides): the tutor writes a Markdown link whose target is `aitana://doc/{docId}/block/0` for student-visible materials. Needs a prompt line and a guard that it never links a not-shared doc. **Not in this milestone without a decision** (open question 2).

### Acceptance and tests

- `DocumentsPanel.test.tsx` (extend): a not-shared material renders the explanation and has no button; a shared one opens.
- `__tests__/chatDocumentNavigation.test.tsx`: an `aitana://doc/{id}/block/0` chip in a tutor message, with `id` student-visible, opens that doc in the panel; with `id` not shared, it shows the explanation and fetches nothing.

### Confirm from the 2026-10-05 prod logs (M runs this)

```sql
SELECT activity_id, COUNT(*) AS turns,
  COUNTIF(REGEXP_CONTAINS(LOWER(content), r'dokument|materiale|tekst(en)?|bilag|pdf')) AS mentions_document
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE DATE(ts, 'Europe/Copenhagen') = '2026-10-05' AND role = 'tutor'
GROUP BY activity_id ORDER BY mentions_document DESC;
```

Then, for the top activities, whether their materials are `studentVisible` (the `activity_configs` lookup in M2, printing `materials[].studentVisible`). The research telemetry `document.open` events (`reportDocumentEvent`, 1.1.45 M5) show whether students opened anything at all that day.

## Handover to a cloud agent

**Read first:** `CLAUDE.md` (the i18n rule, and the footguns table — in particular *"A test passes on the laptop and fails in CI because of the Node version"*), then the files cited per milestone. Milestones are independent; ship each as its own commit to `dev` (conventional commits, no PR).

**Files:** `frontend/src/lib/mathDelimiters.ts` (new) · `frontend/src/components/chat/{ChatMarkdown,StreamingBubble,ChatMessageList}.tsx` · `frontend/src/components/workspace/DocumentsPanel.tsx` · `frontend/src/components/teacher/MaterialsSection.tsx` · `frontend/src/app/chat/[...path]/page.tsx` · `frontend/messages/{da,en}/{chat,workspace}.json` · tests as listed.

**Commands before pushing:**

```bash
cd frontend && npm run quality:check          # lint + typecheck + tests + build (CI parity)
make check-i18n                                # every new student string in messages/{da,en}
make audit-trust-cards                         # if anything near workbench elements moved
make test-frontend-ci-node                     # only if a change touches localStorage/sessionStorage
```

Then check the dev build went green (`gcloud builds list --project=aipla-dev-2026 --region=europe-north1`): a red gate silently stops dev deploying.

**Browser verification** (static checks cannot see either M0 streaming or M1): use the `aitana-frontend-verify` skill against dev with a demo group code; ask the tutor for a formula, watch the stream (no `$` or `\frac` source visible), scroll up mid-stream (no forced jump, badge appears), reload (opens at the bottom). Use a narrow viewport as well as desktop.

**Do not:**

- Do not post-process model output on the **backend** to rewrite delimiters; normalisation belongs to the renderer, where code fences are known.
- Do not set `singleDollarTextMath: false`, and do not attempt to typeset unwrapped LaTeX heuristically.
- Do not flip the `studentVisible` default or show not-shared document content: it is a copyright control.
- Do not add a hardcoded string to any student or teacher component; English and Danish both go in `messages/`.
- Do not read or write prod data (`aipla-prod-2026`); the queries above are for M.
- Do not edit `docs/design/aipla/tutors/*.md` or `frontend/content/project/tutors/*.md` (generated).
- Do not "fix" M2 by inventing a correction in code without a located source.

## Open questions for M

1. **M0:** what does the 10-05 query show — `\(` / `\[`, or `$` only? If `$` only, which turn looked broken (a screenshot settles whether it was the stream)?
2. **M3c:** should the tutor link the documents it cites (`aitana://`), so a named document is one click away, or is the workspace list enough?
3. **M3a:** was the seminar question about *not-shared* materials (a teacher-side visibility issue), or about something else — e.g. a phone, where documents sit behind the workspace tab?
4. **M2:** a screenshot or the activity name would make the lookup unnecessary.
5. Which `app_version` was prod on during the seminar — before or after `2a1d0619` (13:33), which mounts the privacy box above every student chat?
6. The streaming bubble's byline shows the raw `skillId` (`StreamingBubble.tsx:27`), while the finished bubble shows the persona name — a visible flicker of a technical id at every turn. Fold into M0, or leave?
