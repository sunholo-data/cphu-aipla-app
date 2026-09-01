# Design brief: Persistent sessions by group code

**Status:** Ready to implement  
**Source:** 2026-05-25 meeting: *"make sure that if using same code the same session will come up"*  
**Target repo:** `sunholo-data/cphu-aipla-app`  
**Depends on:** ADR-001 (group IDs), ADR-005 (chat log storage)

---

## Problem

In v0.1, a group code is stateless — entering the same code on a new device or after a refresh starts a fresh session. Students who move between devices, or who close the browser mid-session, lose their conversation history and workbench progress.

---

## Decision

**Group code = session key.** Entering a group code always resumes the most recent active session for that group, not a blank slate. A session remains active for 30 days (aligned with the group code TTL in ADR-001). After 30 days, or if the teacher explicitly resets the group, a fresh session starts.

---

## What to persist

| Data | Store | Key |
|---|---|---|
| Chat message history | BigQuery (existing, ADR-005) | `group_id` |
| Workbench state snapshot | Firestore / Redis (lightweight) | `group_id:activity_id` |
| Self-assessment checklist state | Same as workbench | `group_id:activity_id` |
| Current activity (which activity the group is in) | Same | `group_id` |

---

## Restore flow

```
Student enters group code "bold-kazoo-87"
  │
  ├─ Backend: look up group_id in session store
  │   ├─ No session found → fresh start (existing behaviour)
  │   └─ Session found (< 30 days old)
  │       ├─ Load chat history → inject into chat surface
  │       ├─ Load workbench state → postMessage to workbench iframe on mount
  │       └─ Show resume banner: "Welcome back — continuing from your last session"
  │
  └─ Student sees their previous conversation + workbench where they left off
```

---

## Workbench state restore

On initial load, the parent frame sends the stored state to the workbench artefact:

```javascript
// Parent frame, after iframe reports ready
iframeEl.contentWindow.postMessage({
  type: 'aipla:restore',
  state: {
    v0: 17.5,
    theta: 62,
    gravity: 'moon',
    checklistSteps: [true, true, false, false]
  }
}, '*');
```

Each workbench artefact must handle `aipla:restore` on mount and apply the state before rendering. This is a required part of the integration spec for all artefacts (add to LED Planck and KineBot briefs).

---

## Session reset (teacher-controlled)

In the teacher UI (class detail screen), each group has a [Reset session] button. This:
1. Archives the current session log (keeps it for research; does not delete)
2. Clears the workbench state snapshot
3. Next join with the same code starts fresh

The group code itself does not change — teacher does not need to redistribute a new code.

---

## Edge cases

| Scenario | Behaviour |
|---|---|
| Two devices join with the same code simultaneously | Both see the same chat history. Messages from either device append to the shared log. Last workbench state wins (last-write). |
| Group code expires (> 30 days) | Code no longer works at join. Teacher generates a new code. Old session log retained in BigQuery for research. |
| Teacher resets session | Next join with same code gets a fresh session. Previous log archived. |
| Student joins a different activity with the same group code | Activity-scoped state is separate. Chat history is shared (one log per group). |

---

## Implementation notes

- **Session store:** Firestore document at `sessions/{group_id}`, containing `{ activity_id, workbench_state, last_active_at }`. Lightweight — not the chat log (that stays in BigQuery).
- **Chat restore:** Load the last N messages (e.g. last 50) from BigQuery on join. Inject as context with a system note: `[Resuming session from {timestamp}]`. Don't load the entire history into the model context — summarise older turns if the session is long.
- **Resume banner:** Show in the chat surface on restore: *"Continuing from [date] — [N] messages in this session."* Dismissible.

---

## Checklist

- [ ] `sessions/{group_id}` Firestore document created on first join
- [ ] Chat history loaded on rejoin (last 50 messages, older turns summarised)
- [ ] Workbench state stored after each `state-change` postMessage event
- [ ] Workbench state injected via `aipla:restore` on iframe mount
- [ ] Resume banner shown in chat surface
- [ ] Teacher [Reset session] button in class detail screen
- [ ] Session expiry (30 days) handled: code fails gracefully at join with clear message
- [ ] Two-device simultaneous join tested: no duplicate messages, workbench last-write
