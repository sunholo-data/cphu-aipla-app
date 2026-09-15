# Physics symbols a student can type — a symbol strip on the composer

**Status**: **SHIPPED dev 2026-09-15** — 1.1.118
**Priority**: **P2** — nothing is broken; a student who writes *delta v* is understood. What is missing is the way in for a 16-year-old who wants to write what is on the worksheet and has a laptop keyboard
**Estimated**: **~1d** (strip component + caret insert ~0.5d · two call sites + wink ~0.25d · tests + prompt line ~0.25d). Actual: 1d
**Scope**: Frontend — one new component (`SymbolStrip`) mounted on the chat composer and the writing element; one pure helper (`insertAtCaret`). Prompt — one bullet in each student tutor. **No backend, no rendering change, no new dependency**
**Source**: Aswin, 2026-09-15, 14:32: *"Do we need a feature in chat where students can write physics notation? Like delta, phi, rho, etc"* — and M on the same day: *"students do not write notation yet and they are not going to use latex these are 16 year olds. we need a way they can easily add the latex we render for them"*
**Related**: [content-localisation.md](../v1.1.0-feedback/content-localisation.md) M4 (the copy rule this obeys) · [plan-2026-09-to-2027-04.md](plan-2026-09-to-2027-04.md) (maintenance-sized; the discipline layer is the remit, and notation is discipline) · `MessageBubble.tsx` / `ChatMarkdown.tsx` (why the two halves of the chat differ, below)

## The gap, stated plainly

The tutor writes `$\rho = \frac{m}{V}$` and the student sees it rendered
(`ChatMarkdown` runs remark-math + rehype-katex). The student's reply goes
through a single-line `<input>` on a Danish laptop keyboard, where `ρ`, `Δ`,
`²` and `°` do not exist. So the student writes *rho*, *delta v*, *m/s2* — or
more likely does not write the symbol at all, and the conversation drifts away
from the notation the worksheet uses.

Two facts shape the fix:

1. **The model needs nothing.** Gemini reads `Δv = 3 m/s²` as plainly as
   `delta v = 3 m/s^2` or `\Delta v`. There is no comprehension gap to close on
   the backend, only an *entry* gap on the keyboard.
2. **LaTeX is not the answer for the student side.** A 16-year-old is not going
   to type `\Delta`, and if one did, the student bubble renders plain text
   (`MessageBubble.tsx`, `whitespace-pre-wrap`) so they would see their own
   dollar signs. The earlier draft of this plan had a milestone to run the
   student bubble through the math pipeline; **cut**, because Unicode makes it
   unnecessary — `Δ` is a character, it renders as `Δ` everywhere.

So the whole feature is: **a way to put Unicode physics symbols into the text
field, at the caret, with one tap.** What the student sends is an ordinary
string. It survives the chat log, BigQuery, the writing export, the research
views and the tutor's context without any of them knowing this feature exists.

## What is on the worksheets

The symbol set is curated from what the activities actually use, not from the
Greek alphabet. A tally over `backend/skills/templates`, `backend/artefacts`,
the sim artefacts and `frontend/content` on 2026-09-15:

| Symbol | Count | Where |
|---|---|---|
| `°` | 58 | Boldkast (launch angle), KineBot |
| `λ` | 49 | LED Planck |
| `·` | 39 | units, everywhere |
| `²` | 26 | `m/s²`, `kg·m²` |
| `±` | 24 | uncertainty, LED Planck |
| `θ` | 17 | Boldkast |
| `≈` `ω` `Ω` `≤` `×` `≥` `π` `⁻¹` `³` `∝` `Δ` `φ` `≠` | ≤6 each | |

Aswin named `Δ`, `φ`, `ρ` — the three the tally *under*-represents because they
are what a student writes in a derivation, not what a sim labels. The strip
carries both: the symbols the sheet shows and the ones a working student
reaches for.

```
Δ  θ  φ  ρ  λ  ω  μ  α  π  Ω  ·  ×  ²  ³  ⁻¹  √  °  ±  ≈  ≤  ≥  →  ∝  ∞
```

Greek first, operators second — a stable order the student learns, not a
frequency order that would look random. Twenty-four chips; on a 390 px phone
the row scrolls horizontally. Deliberately **not** a full Greek keyboard, a
fraction builder or an equation editor (MathLive is ~150 KB and its own
accessibility surface; the ask was *"not too much UI"*).

## The UI

- An **`Ω` toggle button** in the composer's button row, beside the mic and
  camera. Pressed state = strip open. `aria-expanded`, `aria-controls`.
- When open, **one row of chips above the input**, `overflow-x-auto`, 40 px tap
  targets, each chip `title`d with its name (`Δ — delta`) so hover and screen
  readers get a word, not a glyph.
- A chip **inserts at the caret** and keeps focus in the field. Two details are
  load-bearing:
  - `onMouseDown={preventDefault}` on every chip, so the click never steals
    focus from the input. Without it the field blurs, the selection is lost,
    the symbol lands at the end, and on the writing element every chip tap
    fires the blur-commit save.
  - After the controlled-value update, the caret is restored in a
    `requestAnimationFrame` — React re-renders the `<input>` with the new value
    before the browser can place the caret, so setting it synchronously is
    undone.
- **Closed by default. On a student's first visit it winks**: opens on mount,
  stays ~2 s, closes — enough to say "this exists" without occupying the
  composer. Remembered per device in `localStorage`
  (`aipla.symbolStrip.winked`), wrapped in try/catch like every other
  browser-storage use. Under `prefers-reduced-motion` the wink still happens
  (it is information, not decoration) but with no transition.
- The strip does **not** auto-close on send. Whether it is open is the
  student's choice, and a student doing a derivation wants it open for many
  turns.

Two call sites, one component (the *one consumer* footgun in `CLAUDE.md`
applies to abstractions that claim two consumers — so both are wired here):

| Surface | Field | Wink |
|---|---|---|
| Chat composer (`app/chat/[...path]/page.tsx`) | `<input>` | yes |
| Writing element (`WorkbenchWriting.tsx`) | `<textarea>` per section | no — the chat has already introduced it |

Copy (the toggle's label, the chip names) lives in a `copy` object resolved
from the surface's language (`composerVoice.tts.language` on the chat page —
the same resolution the read-aloud button uses), per
[1.1.108 M4](../v1.1.0-feedback/content-localisation.md). The symbols
themselves are language-neutral.

## Prompt side — one bullet

A notation gap must not become a nag. Each student tutor's anti-pattern list
gains one line: treat `Δv`, `delta v` and `dv` as the same thing, mirror the
student's notation (`Δ` when they write `Δ`, not `\Delta`), and never comment
on notation style — only on the physics. This is `problem-set-hints` and
`concept-dialogue`; the four teacher tools do not talk to students.

## Deliberately not

- **Rendering the student's message as LaTeX.** Unicode removes the need. If a
  student ever pastes `$…$` it stays literal in their bubble, which is honest.
- **Backslash shortcuts** (`\rho␣` → `ρ`). Zero UI, but zero discoverability
  for the audience that will not type a backslash; if the strip is used and a
  power-user asks, it is an afternoon.
- **A `<textarea>` composer.** Separate change; nothing here needs it.
- **Per-activity symbol sets.** Tempting (LED Planck wants `λ h c`, Boldkast
  wants `θ g v₀`), but it makes the strip a thing teachers configure, and the
  fixed set is small enough that scrolling to `λ` is cheaper than a settings
  panel. Revisit if a teacher asks.

## Verification

- `SymbolStrip.test.tsx`: chip inserts at the caret (middle of the text, not
  the end), keeps focus, `mousedown` is prevented; the toggle flips
  `aria-expanded`; the wink opens then closes and writes the storage key; a
  second mount with the key set does not wink; storage throwing does not break
  the strip.
- `insertAtCaret.test.ts`: insertion at start / middle / end / over a
  selection; caret lands after the inserted text.
- `WorkbenchWriting.test.tsx`: a chip tap changes the section's value without
  a save round-trip (no blur-commit).
- By hand on dev: iPad Safari — the row does not push Send off the screen and
  focusing the input after a chip does not re-zoom.
