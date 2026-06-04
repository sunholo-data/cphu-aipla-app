# Chat SVG renders flicker as the closing `</svg>` token arrives

**Status:** Implemented (shipped 2026-06-04)
**Priority:** P2 (UX polish — visible on every agent-emitted diagram, ~hourly during a pilot session)
**Estimated:** ~1.5h (frontend-only, ~30 LOC + a vitest)
**Actual:** ~30min wall-clock; 25 LOC impl (SVGBlock export refactor + ChatMarkdown streaming-tail regex + sentinel branch) + 5 new vitest cases (~100 LOC) in ChatMarkdown.test.tsx. 911/911 frontend tests pass.
**Scope:** Frontend — `ChatMarkdown` pre-processor + a small placeholder export from `SVGBlock`
**Dependencies:** None
**Created:** 2026-06-04

## Problem Statement

Agent-emitted SVG diagrams (force-body diagrams, decomposition triangles, KineBot velocity sketches) flicker as they stream in. The actual sequence the user sees:

1. **t=0 — agent starts emitting SVG.** The streaming content has `<svg viewBox="…"><rect …` but no closing tag yet. `ChatMarkdown` strips raw HTML at line 112 of [ChatMarkdown.tsx](../../../../frontend/src/components/chat/ChatMarkdown.tsx#L112) (`html() { return null; }`) — so during the entire SVG-streaming window **nothing is rendered where the SVG will go**. The chat content below sits in its pre-SVG position.

2. **t=1 — closing `</svg>` token arrives.** Both pre-processor regexes ([line 44-52](../../../../frontend/src/components/chat/ChatMarkdown.tsx#L44-L52)) only match a complete `<svg…</svg>` block. The instant `</svg>` lands, the regex matches → the partial is replaced with a sentinel → `<SVGBlock>` renders its 160 px placeholder div ([SVGBlock.tsx:57-59](../../../../frontend/src/components/chat/media/SVGBlock.tsx#L57-L59)). **All the content below jumps down 160 px in a single frame.** That's flicker #1.

3. **t=2 — DOMPurify dynamic import resolves.** `setCleanSvg(...)` updates state → the placeholder div's contents are swapped for the real SVG via `dangerouslySetInnerHTML`. The actual SVG might be 60 px tall or 300 px tall — anything other than ~160 ends with another small jump. That's flicker #2.

The user-perceived effect: as the agent finishes streaming, the chat **pushes down sharply** as the placeholder appears, then **adjusts again** when the SVG fills it. Often visually startling because it happens on the very last token, after the user has already read what's above.

**Current State:**

- [SVGBlock.tsx](../../../../frontend/src/components/chat/media/SVGBlock.tsx) is already `memo()`-wrapped, has a 160 px placeholder branch, and only re-sanitises when `svgString` actually changes. The flicker is NOT a memoisation problem at this layer.
- The pre-processor in [ChatMarkdown.tsx](../../../../frontend/src/components/chat/ChatMarkdown.tsx) only acts on **complete** SVG blocks (regex requires `</svg>`). During streaming, the partial markup is rendered as raw HTML and stripped by the `html()` handler — so the placeholder appearance is deferred to the closing tag.

**Impact:**

- Visible on every agent-emitted SVG, which is most physics-tutor turns in Boldkast / LED Planck / KineBot. Likely the most common rich-media path students see.
- Worse on slower devices / bigger SVGs because the DOMPurify dynamic import + sanitise step takes longer than ~50 ms. On a fast laptop the placeholder phase is barely visible; on a school iPad it lingers.
- Pairs with the just-shipped [chat-history-flicker](implemented/chat-history-flicker-on-token-refresh.md) fix (1.1.14) — together they pinch off two of the three "things move on screen unexpectedly" patterns in chat. The third is live-message reset on agent rebuild, which the F1 guard in `useSkillAgent` mostly handles.

## Proposed Solution

Reserve the 160 px placeholder **as soon as `<svg` opens**, not when `</svg>` closes. Add a third regex in the `ChatMarkdown` pre-processor that detects an open `<svg…` *without* a matching `</svg>` at the tail of the content, and replaces just that partial with a streaming-placeholder sentinel. Render the sentinel as a 160 px box (the same dimensions `SVGBlock` already uses for its post-mount-pre-sanitise state).

Sequence after the fix:

1. **t=0 — agent emits `<svg viewBox="…"`.** Pre-processor matches the open partial → sentinel inserted → 160 px placeholder div renders. Layout below shifts down 160 px **once, at the start of the SVG stream**, not at the end. The student has the full SVG-streaming duration to register the layout change rather than being startled by a last-frame jump.

2. **t=N — `</svg>` arrives.** The complete-block regex now matches → the partial sentinel is replaced with the full-SVG sentinel → `<SVGBlock>` renders. The placeholder div and the SVGBlock placeholder are the same 160 px height, so React reconciles them in place — no layout jump.

3. **t=N+ε — DOMPurify resolves.** `setCleanSvg` updates → SVG content fills the box. The min-height stays at 160 px so any final SVG ≤ 160 px doesn't shift; > 160 px grows downward by the delta, which is much less than the all-at-once jump in the current behaviour. (Future enhancement: parse the `viewBox` from the partial and reserve a proportional height.)

**Implementation diff sketch:**

```ts
// ChatMarkdown.tsx
const SVG_FENCE_RE   = /```[a-zA-Z]*\r?\n(<svg[\s\S]*?<\/svg>)\s*\r?\n?```/g;
const SVG_RAW_RE     = /(^|\n)\s*(<svg[\s\S]*?<\/svg>)\s*(?=\n|$)/gi;

// NEW: open <svg ...> at the tail of content with no closing tag. Order
// matters — runs LAST, after both complete-block regexes have already
// substituted closed SVGs with sentinels. Anything still containing
// `<svg` at this point is necessarily unterminated → streaming partial.
const SVG_STREAMING_TAIL_RE = /(^|\n)\s*(<svg[\s\S]*)$/i;

const SVG_STREAMING_SENTINEL = "AIPLA_SVG_STREAMING_PLACEHOLDER";

// ... inside the useMemo pre-processor:
processed = processed.replace(SVG_STREAMING_TAIL_RE, () => {
  return `\n\n${SVG_STREAMING_SENTINEL}\n\n`;
});

// ... in the p() renderer:
if (first === SVG_STREAMING_SENTINEL) {
  return <SvgStreamingPlaceholder />;
}
```

Plus a one-liner export from SVGBlock so both the streaming and the post-sanitise-pre-render states share the same 160 px box class — keeps the visual identical.

**Scope locks:**

- **In scope:**
  - `ChatMarkdown.tsx` — new `SVG_STREAMING_TAIL_RE` + sentinel + `p()` handler branch.
  - `SVGBlock.tsx` — export a `SvgStreamingPlaceholder` component (literally the existing `<div className="svg-container my-4 min-h-[160px]" aria-busy="true" />`) so both paths share the dimensions.
  - Vitest: feed `ChatMarkdown` partial content (open `<svg` but no `</svg>`) → assert placeholder is rendered. Feed complete content → assert full `SVGBlock` is rendered. Feed partial → then complete → assert no extra `<div>` thrash.
- **Out of scope:**
  - Parsing the `viewBox` to size the placeholder proportionally. Future enhancement; the 160 px box already covers typical sketches.
  - Threading `isStreaming` from `useSkillAgent` down through `MessageBubble` → `ChatMarkdown`. The tail-regex approach is local, doesn't need extra plumbing, and works for non-streaming sources (resumed history that happens to have a malformed unterminated SVG would also placeholder-out instead of leaking raw `<svg` text — net win).
  - Backend or persisted-history changes.
  - Any change to the recharts SVG paths in [teacher/insights](../../../../frontend/src/components/teacher/insights/) — they don't stream and aren't affected by this issue.

## Acceptance Gates

- [ ] During streaming (open `<svg` without `</svg>`), `ChatMarkdown` renders a 160 px `aria-busy` placeholder div in the position the SVG will land.
- [ ] When `</svg>` arrives, the placeholder is replaced by `SVGBlock` rendering the actual SVG **without an extra layout jump** beyond what `SVGBlock`'s own post-DOMPurify rerender does.
- [ ] Multiple SVGs in the same message: closed earlier-in-message SVGs render normally; only the tail's open partial gets the placeholder.
- [ ] No regressions in existing `ChatMarkdown` tests; existing `SVGBlock` tests still pass.
- [ ] `npm run quality:check` green.

## Risks

| Risk | Mitigation |
|---|---|
| `SVG_STREAMING_TAIL_RE` accidentally matches in-prose mentions like "the `<svg>` tag" | The regex requires `^` or `\n\s*` before `<svg` AND continues to end-of-string. In-prose mentions are followed by more text (`...the <svg> tag in HTML works like…`), so the to-end-of-string anchor saves us. Test case pins this. |
| Substitution races: pre-processor runs on every render with the latest content; partial → complete transition might briefly show two placeholders | After complete-block regex replaces the closed SVG with its sentinel, no `<svg` literal remains for the streaming regex to match. Single source of truth per render. |
| Open `<svg` text from a sanitised-history resume where the SVG was corrupted in storage | Placeholder appears instead of nothing or raw text — strictly an improvement over the current behaviour. |

## Pre-implementation Verification

- [x] Re-read [SVGBlock.tsx](../../../../frontend/src/components/chat/media/SVGBlock.tsx) — confirmed memo + 160 px placeholder are already correct; the flicker is upstream.
- [x] Re-read [ChatMarkdown.tsx:44-52](../../../../frontend/src/components/chat/ChatMarkdown.tsx#L44-L52) — confirmed both regexes require `</svg>`, so no placeholder is reserved during streaming.
- [x] Verified `html() { return null; }` at line 112 is the reason the partial `<svg` is invisible during streaming (not rendered as raw text).

## Implementation Plan

Single FE-only sprint, no backend. Direct-to-dev.

| # | What | Files | LOC est |
|---|---|---|---|
| M1 | `SVG_STREAMING_TAIL_RE` + sentinel pre-processor branch + `p()` handler + `SvgStreamingPlaceholder` export | `frontend/src/components/chat/ChatMarkdown.tsx`, `frontend/src/components/chat/media/SVGBlock.tsx` | ~25 |
| M2 | Vitest: partial → placeholder; complete → SVGBlock; multiple-SVG message; in-prose `<svg>` mention does NOT match | `frontend/src/components/chat/__tests__/ChatMarkdown.test.tsx` | ~50 |
| M3 | `npm run quality:check` green; commit + push; move docs to `implemented/`; update SEQUENCE row 1.1.15 | — | — |

**Total:** ~75 LOC max (impl + tests). ~1.5h wall-clock.

## Upstream-feedback worth?

Marginal. The pre-processor pattern is template-inherited but the streaming-tail-placeholder is more of a tutor-specific UX fix than an architectural anti-pattern. Will mention in a comment in `ChatMarkdown.tsx` so future template-bumps see the reasoning, but won't file a separate upstream entry unless we observe upstream Aitana hitting the same flicker.
