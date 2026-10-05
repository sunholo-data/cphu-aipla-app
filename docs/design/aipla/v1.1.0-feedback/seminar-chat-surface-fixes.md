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
traced against the code on 2026-10-05, and **the prod logs of the seminar were read the
same evening** (§ *M0 results* under each milestone). M0 was **redesigned** as a result:
the leading hypothesis was wrong.

| # | Defect | Cause | Confidence |
|---|---|---|---|
| 1 | LaTeX not rendering | (a) **The tutor wraps maths in backticks** — `` `$E = P \cdot t$` `` — which Markdown parses as inline code *before* `remark-math` sees it, so the student reads the raw source in monospace. (b) A command KaTeX rejects (`\text{ ^\circ C}`, `\celsius`) renders red. (c) The streaming bubble renders raw text until the turn ends. `\(…\)` / `\[…\]` — the original hypothesis — appeared **once** | (a)(b) **verified in prod logs** 2026-10-05 · (c) **verified** by reading |
| 2 | "opsamling" misspelt in a table heading | It is **"Opsring"** (for *Opspring*), a teacher-authored column label on *Den hoppende bold: Energibevarelse* — "opsamling" is phone autocorrect in M's note. The same table also has "Forsøg 1" twice | **verified** in prod Firestore |
| 3 | Documents not obviously clickable | Every material on every seminar activity was **not shared** (`studentVisible: false`, the default), so nothing could open. Even a shared one is a small list row the student must find and click; nothing is open when the workspace loads | **verified** in prod Firestore + by reading |
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

### M0 results — the 2026-10-05 prod logs (read 2026-10-05 evening)

234 tutor turns on 10-05, all `gemini-3.5-flash-lite`, `v0.1.79`–`v0.1.81`. Counted with the
query at the end of this section:

| Shape | Turns | What the student saw |
|---|---|---|
| `` `$E = P \cdot t$` `` — **maths wrapped in backticks** | **15**, in two activities (*Effekt og nyttevirkning med simulering*: 9 of 42; *Mekanisk energi*: 6 of 26) | `$E = P \cdot t$` in monospace — the source, dollars and all |
| `\text{ ^\circ C}`, `\text{ \celsius}` inside `$…$` | **3** | a KaTeX error (red source) |
| `\(…\)` | **1** | `(100\text{ g})` |
| `\[…\]` | 0 | — |
| Plain `$…$` | ~100 | typeset — **this already works** |

The students said so, in the transcript, to the tutor: *"Du har en latex-bug når du svarer
mig"* · *"Stadigvæk sender du latex tilbage"* · *"Er der meningen at der skal være de der $
tegn?"* · *"hvad betyder cdot"*. The tutor apologised and **did it again in the next turn**, and
answered the last two by explaining the source (*"`\cdot` er bare et gangetegn"*): a student
learning to read LaTeX source is the failure in its purest form.

The backtick shape is Markdown's own precedence: a code span is parsed before `remark-math`
runs, so `$` inside it is literal text. The **original design would not have fixed it** — its
normaliser explicitly *"skips inline code spans"*, which is exactly where the maths was.

Verified against the installed `katex` 0.16.47:

| Input | Result |
|---|---|
| `-20\text{ ^\circ C}` | **parse error** — `^` is not allowed in text mode |
| `100{,}0\text{ \celsius}` | **parse error** — `\celsius` is siunitx, not KaTeX |
| `38 \text{ \%}`, `67\,\%`, `80^\circ\text{C}`, `E_{\text{pot}}` | OK |

### Change (redesigned 2026-10-05)

The fix stays in the renderer, where code fences are known. One pure module,
**`frontend/src/lib/mathDelimiters.ts`**, three functions, applied in this order in the
`ChatMarkdown` preprocessing `useMemo` (after `stripCitationMarkers`, before SVG extraction):

1. **`unwrapCodedMath(text)`** — *the fix for what the seminar saw.* An inline code span whose
   **entire** content is one maths expression loses its backticks: `` `$…$` `` → `$…$`,
   `` `$$…$$` `` → `$$…$$`, `` `\(…\)` `` → `$…$`. The rule is "the whole span is maths"
   (anchored match on the span's content, after trimming), so `` `price = $5` ``, a span of
   shell, or any span with text outside the delimiters is untouched. Fenced code blocks are
   never touched. A span that is maths-shaped but contains a backtick-escaped double backtick is
   left alone (too ambiguous to be worth a rule).
2. **`normalizeMathDelimiters(text)`** — as originally designed: `\(…\)` → `$…$`, `\[…\]` →
   `$$…$$` (display padded to its own block), skipping fences and (now remaining) code spans.
   Kept although it fired once: it is cheap, and Gemini drifts to it when the preamble is long.
3. **`repairTextModeMaths(text)`** — inside `$…$` only, two narrow rewrites for the shapes
   seen: `\text{<ws>^\circ<ws>C}` → `^\circ\text{C}` (and `^{\circ}`, `°` variants) ·
   `\celsius` → `^\circ\text{C}`. Not a general LaTeX fixer — a list of observed shapes, each
   with its prod example in the test. Add `macros: { "\\celsius": "^\\circ\\text{C}",
   "\\degree": "^\\circ" }` to `rehypeKatex` as the belt for the second; the text-mode `^` cannot
   be a macro, which is why (3) exists.

Then:

4. **Streaming renders Markdown** (unchanged from the original design): `StreamingBubble` renders
   `ChatMarkdown` with a tail guard, `holdOpenMath(text)`, that holds back an unclosed `$`, `$$`,
   `\(`, `\[` **or an unclosed backtick** at the tail, so neither source nor a half code span
   flashes. Removes the finalisation layout jump that feeds M1.
5. **`rehypeKatex` `{ throwOnError: false, errorColor: "inherit" }`** — a formula KaTeX still
   cannot parse renders as its source in the body colour instead of red. Source is bad; red
   source reads as *the app is broken*.
6. **Prompt line**, `backend/skills/preambles/math_notation.md`: *"Write maths with `$…$` or
   `$$…$$` directly in the sentence — never inside backticks or code formatting, never `\(…\)`
   or `\[…\]`. Inside `\text{…}` write words only; put `^\circ` outside it."* Reaches prod by
   **deploy**, not seed (`math_notation.py:36-39`). The renderer is the fix; this only lowers
   the rate.
7. **The tutor must not explain its own markup.** When a student says the formatting is broken,
   the right reply is not *"`\cdot` er bare et gangetegn"*. The preamble line in (6) closes with
   *"If a student says the maths looks wrong, rewrite it in plain words and symbols (×, ·, °)
   for the rest of the conversation."* This is the only lever that works when the renderer is
   the one at fault.

Do not set `singleDollarTextMath: false` to cure the currency false positive: the preamble *instructs* single-dollar inline maths.

### Acceptance

- The 15 backtick turns and 3 text-mode turns from 10-05, replayed through `ChatMarkdown`, render
  with **no** literal `$`, `\cdot`, `\frac` or `\text` in `textContent` and no `.katex-error`.
- Every delimiter row of the earlier table marked "no" renders typeset; unwrapped LaTeX is unchanged.
- `` `price = $5` ``, `` `npm run dev` `` and a fenced block containing `` `$x$` `` are byte-identical after preprocessing.
- A streaming turn never shows a `$`, `` ` ``, `\(`, `\[` or `\frac` source fragment.

### Tests

- `frontend/src/lib/__tests__/mathDelimiters.test.ts` — each function in isolation: whole-span
  unwrap vs. partial span (left alone), span inside a fence (left alone), two coded formulas on
  one line, `{,}` decimals, nested braces; the delimiter rewrites; each text-mode repair with its
  prod example and an already-correct input (identity); tail guard on unclosed `$`, `$$`, `\(`, `` ` ``.
- `frontend/src/components/chat/__tests__/ChatMarkdown.math.test.tsx` with
  `__fixtures__/tutor-math-shapes.ts`: **five real 10-05 turns**, anonymised (no group or session
  ids) — two backtick turns from *Effekt og nyttevirkning*, one from *Mekanisk energi*, the
  `\text{ ^\circ C}` turn, the `\celsius` turn — plus the synthetic rows from the table above.
  Assert `.katex` count, no `.katex-error`, and no literal source in `textContent`.
- `StreamingBubble.test.tsx` — partial content with an open `$` or `` ` `` renders neither; a
  completed inline formula renders `.katex`.
- Backend: `test_math_notation.py` asserts the preamble carries the backtick and `\text` lines.

### Re-run after shipping (read-only)

Roles in `chat_turns` are `'student'` and `'tutor'` (`backend/analytics/research_logs.py:75-76`) — a query on `'assistant'` silently returns zero.

```sql
SELECT DATE(ts, 'Europe/Copenhagen') AS d, app_version,
  COUNT(*) AS tutor_turns,
  COUNTIF(REGEXP_CONTAINS(content, r'`\$')) AS backtick_wrapped,
  COUNTIF(REGEXP_CONTAINS(content, r'\\\(')) AS paren_inline,
  COUNTIF(REGEXP_CONTAINS(content, r'\\\[')) AS bracket_display,
  COUNTIF(REGEXP_CONTAINS(content, r'\\text\{[^}]*(\^|\\circ|\\celsius)')) AS text_mode_maths
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE role = 'tutor' AND ts > TIMESTAMP('2026-10-01')
GROUP BY 1, 2 ORDER BY 1;
```

The renderer makes these harmless whatever the counts; the counts measure the prompt line (6).
A student turn matching `(?i)latex|\$ tegn|cdot|formel.*(mærkelig|forkert)` is the direct
symptom and should go to zero.

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

### M0 results — located 2026-10-05

It is **"Opsring"**, not "opsamling" (phone autocorrect in the note). Prod Firestore,
`activities/act-c94eb3dc1fcdf26a` (*Den hoppende bold: Energibevarelse*, owned by AR's
account), teacher-authored:

| Table | Columns as authored | Should be |
|---|---|---|
| Slip A (150 cm) | **Opsring** (no unit), Forsøg 1, Forsøg 2, **Forsøg 1**, Gennemsnit | Opspring, …, **Forsøg 3** |
| Slip B (180 cm) | **Opsring**, Forsøg 1, Forsøg 2, Forsøg 3, **5. Gennemsnit** | Opspring, …, Gennemsnit |

It cost more than a typo. Students asked *"hvorfor står der forsøg to gange under slip A?"* and
*"hvad skal jeg skrive under opsring?"*; the tutor read the ambiguous column as the drop height,
computed 68,3 / 68 and told a student the ball bounced to over 100 %. It then told the student
the duplicate column was *"en fejl i tabellens opsætning"* — correct, and the only place the
defect was reported.

**Change:** data, not code — tell the owner (AR) and correct it in the builder. Two platform
follow-ups, *not* in this milestone: the builder could flag duplicate column labels on save (a
deterministic check, cheap), and spelling in teacher-authored labels is out of scope.

### What was searched (before the lookup)

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

### M0 results — 2026-10-05

All seven activities in the seminar class attached the same two cleared UVM documents (*Fysik C
læreplan*, *Vejledning til Fysik C*), and one attached the teacher's own *Prompt for Energi.pdf*.
**Every one was `studentVisible: false`.** So at the seminar there was nothing a student could
open; the names sat in the dashed "not shared" list. That alone answers *"can you click on
documents?"* with *no*. M's follow-up (2026-10-05): **even when they can, they are not
obviously clickable** — a shared document is a small row in a list, and the workspace opens
with nothing in it.

### Decision (M, 2026-10-05): open one by default, switch with a visible control

The documents surface stops being a list you open things from and becomes a **reader that is
already open**:

- **On load, the first shared document is open.** "First" is the order the teacher attached
  them in (`materials[]` order), so the teacher controls which one a student lands on. No
  `document.open` research event is emitted for the automatic open — only for a student's own
  choice — or the telemetry would record reading that never happened. Emit
  `document.default_shown` instead, once per session.
- **A visible switcher above the reader**, when there is more than one shared document: a row
  of tabs (wrapping; a `<select>` under ~400 px width), each showing the document title, the
  current one selected. Tabs, not a dropdown, at desktop width: the point is that the other
  documents are *seen* to exist. `role="tablist"`, keyboard arrows, the title in `aria-label`.
- **One shared document → no switcher**, just the reader with its title as a heading.
- **Not-shared materials stay out of the switcher.** They remain listed by name below the reader,
  collapsed, with M3a's explanation — the copyright control is unchanged.
- **Zero shared documents → no empty reader.** The panel shows the not-shared names and M3a's
  line; nothing pretends to be openable.
- **Phone:** the workspace tab opens on the reader. M3b's "named in chat → opens it" switches
  the tab *and* the selected document.
- Remembered per student per activity in `localStorage` (the last document they chose wins over
  "first" on return), wrapped in try/catch — a per-viewer convenience, so browser storage is the
  right place. Run `make test-frontend-ci-node` (CLAUDE.md footgun: Node 22 vs 26 `localStorage`).

**Teacher side, same milestone:** the materials list in the builder shows the
*students can open it* state as words on every row ("Eleverne kan åbne den" / "Kun tutoren"),
not an icon, and the first shared material carries "Åbnes først for eleverne". This is
where the seminar's real cause sits: seven activities, nobody had shared anything, and
nothing on screen said so.

### Change

- **M3-default — the reader above.** `DocumentsPanel.tsx`: lift `openDoc` initial state to the
  first shared material; add `DocumentSwitcher` (tabs / select); new strings in
  `messages/{da,en}/workspace.json` via `useT()`. `MaterialsSection.tsx`: the state labels.
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
