# Voice config once per page, not once per message bubble

**Status:** Design (OPEN) — **1.1.130**
**Priority:** **P2** — invisible to students today, but it is ~10,000 needless requests per class hour against the same instance that serves the tutor
**Estimated:** ~0.25d
**Scope:** Frontend — `hooks/useVoiceConfig.ts`, `components/chat/MessageBubble.tsx`, `app/chat/[...path]/page.tsx`
**Dependencies:** [voice-provider-abstraction](implemented/voice-provider-abstraction.md) (**shipped** — the hook); [1.1.63 M4](tutor-register-citation-and-language.md) (the activity-keyed cache). **Un-gated**
**Created:** 2026-09-22
**Source:** [classroom-session-2026-09-22-followups.md](classroom-session-2026-09-22-followups.md), finding 7

## Problem Statement

During the 22 September session (≈13:20–14:50 local), prod served about **10,000
`GET /api/voice/config`** requests, in bursts of 300–640 a minute, with ~9 groups
connected. Each is a Firestore read chain (skill → activity → class → persona)
on the backend sidecar inside `aipla-v01-frontend` — the same process answering
tutor turns.

### Mechanism

`useVoiceConfig(skillId, activityId)` is called **per `MessageBubble`**
(`MessageBubble.tsx:180`) and once more for the composer (`page.tsx:616`). The
hook has a module-level cache, but:

1. **Every instance refetches on `window` focus** (`useVoiceConfig.ts` focus
   effect). A chat with 40 bubbles fires 40 identical requests each time a
   student clicks back into the tab — which, with a workbench beside the chat
   and uploads opening file pickers, is constantly.
2. **No in-flight de-duplication.** Bubbles mounting together on a cache miss
   each start their own fetch.

## Design (~0.25d)

- Module-level **in-flight promise map** keyed like the cache: concurrent callers
  share one request.
- Focus refetch **once per key**, throttled (e.g. ≥30 s since the last fetch),
  owned by the module rather than each hook instance; instances subscribe to
  cache updates.
- Better still, lift it: resolve voice config once in the chat page and pass it
  down, leaving `useVoiceConfig` for callers outside the chat.

Test: mount 50 bubbles, dispatch `focus` 3×, assert ≤ 2 fetches.

## Also noted, not in scope

Prod also logged 404s on `/favicon.ico` and `apple-touch-icon*.png` at the start
of the session (every student device asks). Harmless; a one-line asset add if
anyone is touching `public/`.
