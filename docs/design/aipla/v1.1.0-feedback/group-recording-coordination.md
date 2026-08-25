# Group recording coordination — one lesson, one recording

**Status**: Planned
**Priority**: P1
**Estimated**: ~1d
**Scope**: Backend (a group-level lock) + a small student-UI state
**Dependencies**: None. The single-device half shipped 2026-08-25.
**Created**: 2026-08-25
**Last Updated**: 2026-08-25

## Problem Statement

From M's 17 August notes:

> *"if all students in a groupId- press record on audio - debounce"*

There are two halves to this and only one is fixed.

**Fixed (2026-08-25).** One student hammering **Record** on one device built a
new `SegmentedRecorder` per press and overwrote `segRef`, orphaning the previous
one — already started, no longer referenced, so nothing could stop it. It kept
capturing and uploading for the rest of the lesson. Four presses, four
concurrent recorders. Guarded, with a regression test.

**Not fixed, and it is the half M actually described.** Three students in one
group each pressing Record on their own device produce **three parallel
recordings of the same lesson**. `upload_recording` accepts segments from any
device in the group and stores them under `(class_id, group_id, rec_id)`, then
queues each for background transcription. There is no "someone in this group is
already recording" lock anywhere.

## Why it matters more than duplication

- **Cost, twice over.** Every segment is stored in `research_audio` *and*
  transcribed by Gemini. Three devices is 3× both, for one lesson. The
  per-teacher spend cap exists precisely to stop surprises like this.
- **The transcript is worse, not just bigger.** Three overlapping captures of
  the same room, at different distances from whoever is speaking, interleaved by
  arrival time. That is a harder transcript to read than any one of them alone.
- **Research data integrity.** This is retained study data
  ([1.1.80](group-erasure-cascade.md)). "How many recordings does this group
  have" currently has no principled answer.
- **Nobody can see it happening.** A student pressing Record has no idea a
  groupmate already did. The failure is invisible at the moment it is created
  and only discoverable in the transcript afterwards.

## Design sketch

**The lock.** A group-scoped "recording in progress" record — plausibly a field
on the existing `group_sessions` doc rather than a new collection — holding the
device that owns it and a heartbeat. `upload_recording` accepts segments only
from the owning device; a second device starting is told the group is already
recording.

**Two candidate policies, and the choice is a product one:**

- **(a) First device wins.** Others see "Jeres gruppe optager allerede" and the
  button reflects it. Simple, and the common case is one phone on the desk.
- **(b) Explicit takeover.** A second device may claim the recording, ending the
  first. Useful if the owning phone runs out of battery mid-lesson — which, in a
  Danish classroom with student phones, is not hypothetical.

Recommendation is **(a) plus a takeover affordance**, because the failure mode
of (a) alone — the owning device dies and the group cannot record at all — is
worse than the failure it prevents.

**Staleness.** A device that closes its tab mid-recording must not hold the lock
forever. The heartbeat should expire; the existing group-pulse endpoint already
runs on a timer and is the natural carrier.

**Visibility.** Whatever the policy, every device in the group should show the
same recording state. The group already has a live-state channel (signals,
turn-revision bumps for trust cards) — this rides that rather than inventing one.

## Open Questions

1. **Does a teacher ever want per-device recordings deliberately?** Group work
   spread across a lab bench might genuinely want two capture points. If so the
   lock becomes a default rather than a rule, and the transcript needs a device
   dimension.
2. **What happens to recordings already made this way?** Prod has real
   recordings from the pilot; some may already be duplicated. Worth counting
   before deciding whether to reconcile.
3. **Does the lock belong to the device or the student?** Anonymous-group
   students share one synthetic uid, so "device" is the only distinguishable
   unit — the same reason the pulse endpoint already carries a `device` param.

## Related Documents

- [group-erasure-cascade.md](group-erasure-cascade.md) — recordings' erasure path, and the open question about whether any UI exposes it
- [cost-dashboard.md](cost-dashboard.md) — where duplicate transcription cost would surface
- `docs/notes-2026-08-17.md` — the source ask
