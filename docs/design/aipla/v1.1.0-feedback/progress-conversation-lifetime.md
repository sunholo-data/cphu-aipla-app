# Progress outlives the conversation that earned it

**Status:** Design (OPEN) — **P0.** Written 2026-08-10 from Aswin's 2026-08-10 report. A consequence of a deliberate decision in [1.1.62 M3](workbench-element-awareness.md).
**Priority:** **P0** — it makes the tutor look broken at exactly the moment a student returns, and the teacher pilot starts 2026-08-14. Cheap to mitigate; the wrong mitigation (make progress ephemeral) would undo a correct decision.
**Estimated:** ~1–1.5d (M1 tutor knows progress is inherited ~0.5d · M2 student-visible continuity ~0.5d · M3 rejoin telemetry ~0.25d)
**Scope:** Backend — wire the already-written-and-never-wired `checklist_state_summary` into the agent, with provenance ("earned in an earlier session"); a prompt contract for what to do on inherited progress. Frontend — a short "picking up where you left off" line. No store change.
**Dependencies:** [1.1.62 workbench-element-awareness](workbench-element-awareness.md) (**SHIPPED** M3 — the per-group store whose lifetime this is about); [1.1.53 group-shared-session-sync](group-shared-session-sync.md) (**SHIPPED** — the group/session model); [tutor-sees-element-state](tutor-sees-element-state.md) (1.1.69 — the sibling)
**Source:** Aswin, 2026-08-10 — *"I was chatting with Jonas which I think it was more than 10 chats. I stopped for a while and then previous chats were removed. I then started again with the same code, but then Jonas only asked me one question and I answered it correctly. He then said already marked the learning goals, then it goes on like that."*
**Created:** 2026-08-10 (M)
**Last Updated:** 2026-08-10 (M) — Open Question 1 answered; M0 (reset) split out and shipped, M1 re-justified

## Problem Statement

**The ticks survive a session; the conversation does not. Nothing tells the tutor which it is looking at.**

Reconstructed from the dev logs (`sweet-bison-13` and `happy-sheep-28`, activity
`act-1ac66271da35ee85`, 2026-08-07):

1. A long, productive conversation. Jonas marks steps as they are demonstrated,
   with real evidence — *"Correctly identified that the total length contains 3/2
   wavelengths (3 half-wavelength loops)"*, *"Explained how linear mass density
   is determined from mass and length (μ = m/L)"*.
2. The session's chat history goes away (development churn, in this instance).
3. The student rejoins **with the same group code**.
4. New session, empty conversation — but `checklist_progress/{group}:{activity}`
   is untouched, because it is keyed by group and activity, **never by session**.
5. The tutor calls `list_checklist()`, sees four of five steps already done, and
   behaves accordingly: one question, then *"already marked the learning goals"*.

**Nothing here malfunctioned.** The marks were earned. The store surviving is
the shipped, tested behaviour (`test_state_survives_a_new_session`) and it is
*correct* — a group works across separate devices, and progress that died with a
tab would be the worse bug.

What is missing is that the tutor **cannot tell inherited progress from progress
it just watched happen**. Both read identically through `list_checklist()`. So it
treats four ticks it never witnessed as four ticks it did, and skips the work.

From the student's seat: Jonas forgot everything, then claimed to remember.

### The shape of the mistake

1.1.62 M3 reasoned carefully about *where* progress lives (per group, not per
browser — the right call) and not at all about *how long it lives relative to the
conversation*. Two lifetimes were introduced that can diverge, and the tutor was
given no way to notice the divergence.

> **A dead function, worth recording.** `checklist_state_summary()` was written,
> exported, unit-tested — and **never wired into the agent**. Its sibling
> `checkpoint_state_summary()` (CONCEPT-1) is dead in exactly the same way. So
> the tutor only ever learns about progress by *asking* (`list_checklist`), never
> as ambient context. Shipped in the same sprint that criticised
> `ActivityConfig.language` for being written-and-never-read; the lesson did not
> generalise. M1 below is largely "wire the thing that already exists, and give
> it the provenance it was missing."

## Goals

**Primary:** A tutor resuming a group's activity knows which progress it
inherited, says so, and does not treat an inherited tick as a demonstration it
witnessed.

**Success metrics:**

- On a fresh session with existing ticks, the tutor's first turn **acknowledges
  the earlier work** rather than silently skipping it.
- The tutor distinguishes "you showed me this" from "this was marked earlier".
- A student can ask what was already marked, and why, and get the recorded
  evidence back.
- Progress still survives rejoin — the store does not change.

**Non-goals:**

- Making progress session-scoped. That would trade a cosmetic bug for a real one.
- Restoring lost chat history (a separate concern — see Open Questions).
- Re-verifying inherited marks by re-asking everything. That punishes the student
  for our bookkeeping.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | One extra state read at agent build, already performed by `list_checklist`. |
| 2 | EARNED TRUST | **+1** | The student learns what the tutor thinks it knows about them, and where that came from. Silent inheritance is the trust failure — it reads as the AI making things up. |
| 3 | SKILLS, NOT FEATURES | +1 | Ambient context on the skill's own instructions; no new surface. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Deterministic composition; no extra model call. |
| 5 | GRACEFUL DEGRADATION | +1 | No prior progress → empty string → composes exactly as today. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Wires a function that already exists rather than adding a mechanism. |
| 7 | API FIRST | 0 | No new endpoint. |
| 8 | OBSERVABLE BY DEFAULT | +1 | M3 logs rejoin-with-inherited-progress, which is currently invisible — nobody could have found this without reading Firestore by hand. |
| 9 | SECURE BY CONSTRUCTION | 0 | Same group scoping. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Server composes; the client renders one line. |
| 11 | USABLE BY DESIGN | +1 | Continuity is the whole point of a group code that outlives a session. |
| | **Net Score** | **+8** | Threshold: >= +4 |

## Design

### M1 — The tutor knows what it inherited

Wire `checklist_state_summary()` into the agent beside the manifest, and give it
the provenance it currently lacks — *when* and *by whom*:

```
This group has progress from an EARLIER session, which you did not witness:
- "Mål faldtiden tre gange" — marked 2026-08-07 (by you, earlier): målte tre gange, 0,45 s
- "Beregn gennemsnittet" — marked by the student

You did not see this work. Do not re-test it and do not treat it as something
you just observed. Acknowledge it briefly, then continue from the first step
that is NOT done. If the student seems unsure about something already marked,
revisit it — a mark is not a verdict.
```

Three things that block the reported behaviour: the tutor knows the work
happened **elsewhere**; it is told to **continue from the first outstanding
step** rather than wrap up; and it is given permission to **revisit**, so an
inherited mark cannot railroad a student who has actually forgotten.

`checkpoint_state_summary()` gets the same treatment — same bug, same fix, and
leaving one wired and one dead is how this recurs.

### M2 — The student sees the continuity too

A short line when a session starts with existing progress:

> *Vi fortsætter, hvor I slap. 4 af 5 trin er markeret — tryk på et trin for at ændre det.*

The tutor's acknowledgement is necessary but not sufficient: the *chat* is empty,
which is the thing that looked broken. Naming it in the UI — where the ticks are
visibly already there — is what makes the empty chat legible rather than alarming.

### M3 — Make the rejoin visible

Log rejoin-with-inherited-progress (group, activity, ticks inherited, age of the
newest). This case was only found because a teacher described it in prose and
someone read Firestore by hand; that is not a diagnostic path.

## Implementation Plan

- **M1** wire both summaries with provenance + prompt contract (~0.5d)
- **M2** student-facing continuity line (~0.5d)
- **M3** rejoin telemetry (~0.25d)

## Testing Strategy

- **Backend:** summary empty with no progress (composes as today); with progress
  it names the items, marks them as inherited, and instructs continuation from
  the first outstanding step. **Both** summaries are wired — a test that fails if
  either is defined-but-unused, so this class of dead code cannot recur silently.
- **The regression test:** ticks recorded under session A; build the agent for
  session B, same group; assert the instruction contains the inherited-progress
  block. That is Aswin's exact case.
- **Eval:** fresh session, 4 of 5 steps pre-marked → the tutor acknowledges and
  works on step 5, rather than declaring the activity complete.
- **Frontend:** the continuity line renders only when progress exists.

## Success Criteria

- [ ] A tutor on a fresh session with inherited ticks acknowledges them explicitly
- [ ] It continues from the first outstanding step, not the end
- [ ] It does not claim to have witnessed inherited work
- [ ] The student sees why the chat is empty but the ticks are not
- [ ] Progress still survives rejoin (no store change)
- [ ] A defined-but-unwired state summary fails a test

## Open Questions

1. ~~**Why did the history disappear at all?**~~ **ANSWERED 2026-08-10, before
   building the mitigations — and it changed the plan.**

   Everything suspected was fine: `AGENT_ENGINE_ID` is set in dev *and* prod, so
   sessions genuinely persist in Vertex Agent Engine; the group→session pointer
   is **first-wins with a 30-day TTL**, so an ordinary rejoin resumes. Nothing
   was expiring.

   The cause was that **`reset_teaching_data` clears nine collections and
   neither progress store was among them**. A dev reset wiped the conversation
   and the group pointer and left the ticks orphaned. Fixed in PILOT-1 M0, with
   a guard test asserting membership for both stores.

   **Which environments can reach this state?**

   | Route | Reachable in prod? | Status |
   |---|---|---|
   | `reset_teaching_data` script | **No** — hard `_DEV_PROJECTS` allowlist refuses any other project | dev only; fixed anyway |
   | Teacher **[Reset session]** | **Yes** — a normal classroom action on a button | fixed in M0: reset now clears progress |
   | Group-code **TTL expiry** | **Yes** — `_archive_expired_session` archives the session and does **not** touch progress | **still open — this is what M1 below is for** |

   So Aswin's exact trigger is impossible outside dev, but the *state* was
   reachable in prod two ways. One is fixed; the expiry route is not, and
   **deliberately should not be fixed by clearing**. A teacher pressing Reset
   states an intent ("start over"); a code expiring is administrative and nobody
   asked for anything — wiping a class's earned assessment evidence because a
   TTL lapsed would be worse than the bug it prevents, with no undo.

   **That is why M1 stays in scope.** It is now the *only* fix for the one
   prod-reachable route left, rather than a nicety on top of M0.
2. **Should inherited marks decay?** A tick from three weeks ago is weaker
   evidence than one from this morning. Age is in the store already. Probably a
   tone hint ("marked a while ago — worth a quick check") rather than expiry.
3. **Does the same apply to concept-map checkpoints?** Yes — identical store
   shape, identical dead summary. Covered by M1.

## Related Documents

- [workbench-element-awareness.md](workbench-element-awareness.md) — 1.1.62 M3, which introduced the per-group store
- [tutor-sees-element-state.md](tutor-sees-element-state.md) — 1.1.69, the sibling regression
- [living-concept-map.md](living-concept-map.md) — the checkpoint store with the same dead summary
- [group-shared-session-sync.md](group-shared-session-sync.md) — 1.1.53, group/session model
- [docs/notes-2026-08-03.md](../../../notes-2026-08-03.md) — Aswin's feedback
