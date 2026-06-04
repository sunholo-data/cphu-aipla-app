# Sprint: CHAT-SVG-STREAMING-PLACEHOLDER — reserve SVG space while streaming, no last-token jump

**Sprint ID:** `CHAT-SVG-STREAMING-PLACEHOLDER`
**Design doc:** [chat-svg-streaming-placeholder.md](chat-svg-streaming-placeholder.md)
**Branch:** direct-to-dev (per AIPLA workflow)
**Base commit:** `dev` HEAD (`9eac9eb` post-CHAT-HISTORY-FLICKER)
**Estimate:** ~1.5h wall-clock
**Created:** 2026-06-04
**Status:** planned

## Sprint goal

Stop the chat content from jumping ~160 px when the closing `</svg>` token lands. Detect an open `<svg…` at the tail of streaming content, reserve the placeholder space immediately. When `</svg>` arrives, the placeholder is reconciled in-place with the rendered SVG — no second jump.

## Scope locks

**In scope:**
- `frontend/src/components/chat/ChatMarkdown.tsx` — add `SVG_STREAMING_TAIL_RE`, extend the `useMemo` pre-processor to inject a streaming-placeholder sentinel for unterminated `<svg`, and add a `p()`-handler branch that renders `SvgStreamingPlaceholder` for that sentinel.
- `frontend/src/components/chat/media/SVGBlock.tsx` — export `SvgStreamingPlaceholder` as a sibling component that returns the same 160 px `aria-busy` div used today inside `SVGBlock` for the pre-sanitise state. Refactor `SVGBlock` to reuse it so both paths share one source of truth on dimensions.
- `frontend/src/components/chat/__tests__/ChatMarkdown.test.tsx` — new vitest cases.

**Out of scope:**
- `viewBox`-derived placeholder sizing. Future enhancement.
- Threading `isStreaming` through `MessageBubble` → `ChatMarkdown`. Tail-regex approach is local and works for both streaming and (rare) corrupted-history cases.
- Backend changes.
- Recharts / teacher-insights SVG paths — different surface, no streaming.

## Workflow

Direct-to-dev. Branch `dev`. Commit + push when M1 + M2 are green.

## Milestones

| # | What | Files | LOC est |
|---|---|---|---|
| M1 | Extract `SvgStreamingPlaceholder` export + add `SVG_STREAMING_TAIL_RE` pre-processor branch + `p()` handler branch | `SVGBlock.tsx`, `ChatMarkdown.tsx` | ~25 |
| M2 | Vitest: partial input → placeholder; complete input → real SVGBlock; in-prose `<svg>` mention does NOT match; multiple-SVG message handled correctly | `__tests__/ChatMarkdown.test.tsx` | ~50 |
| M3 | `npm run quality:check` green; move docs to `implemented/`; SEQUENCE row 1.1.15 → shipped; commit + push | docs + SEQUENCE | — |

**Total:** ~75 LOC max. ~1.5h wall-clock.

## Acceptance gates

- [ ] Partial input (open `<svg` no `</svg>`) → ChatMarkdown renders a 160 px placeholder where the SVG will land
- [ ] Complete input → ChatMarkdown renders the full SVGBlock (existing behaviour preserved)
- [ ] In-prose mention `the <svg> tag is...` → does NOT match the streaming regex (regex anchored to end-of-string)
- [ ] Multiple SVGs in one message, only the last unterminated → only that last one gets the placeholder
- [ ] All existing ChatMarkdown + SVGBlock tests pass
- [ ] `npm run quality:check` (lint + typecheck + vitest + build) green
- [ ] Commit message: `fix(chat): reserve SVG placeholder while streaming so closing tag doesn't jump layout`
- [ ] Push to dev triggers a build that succeeds

## Risks

| Risk | Mitigation |
|---|---|
| `SVG_STREAMING_TAIL_RE` accidentally matches in-prose `<svg>` mentions | Regex anchored to end-of-string (`$`) — only matches if the open `<svg` continues to the end of content. Vitest case pins this. |
| Pre-processor order matters — must run AFTER both complete-block regexes | Test the multiple-SVG case (one complete + one streaming) to lock the order. |
| Placeholder dimensions diverge from SVGBlock's post-sanitise div | Share via `SvgStreamingPlaceholder` export. Single source of truth on class names + min-height. |

## Dependencies

- 1.1.14 [chat-history-flicker fix](implemented/chat-history-flicker-on-token-refresh.md) is independent of this — both close perception gaps but in different layers.

## Out of scope (do NOT start)

- viewBox-derived placeholder sizing
- isStreaming prop threading
- Backend changes
- Recharts SVG paths
- Upstream PR filing (this is more of a tutor UX fix than a template anti-pattern)
