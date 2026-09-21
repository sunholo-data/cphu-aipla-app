---
title: "Researcher onboarding"
description: "Cross-teacher observation and the rubric experimentation workspace."
tag: "R1"
audience: "researcher"
order: "1"
lang: "en"
status: "Current"
owner: "AIPLA project team"
reviewed: "2026-09-21"
reviewBy: "2026-12-21"
---
::: callout-note
## For researchers

A researcher account layers **cross-teacher** views, the ability to **edit on a
teacher's behalf**, and a **rubric experimentation** workspace on top of the
normal teacher surfaces. Researcher access is a role an administrator grants to
your account (see *Getting access* below).
:::

## What a researcher can do

Three capabilities beyond a normal teacher account:

1. **Observe across the whole cohort** — every teacher's classes, activities,
   engagement and cost.
2. **Help a teacher directly** — open any teacher's class or activity and change
   it: rename the class, add or create an activity in it, mint a join code,
   share or unshare an activity. An activity you create inside a teacher's
   class belongs to *them* — it appears in their own library and they can edit
   it without you. You cannot delete a teacher's class.
3. **Experiment with rubrics** — author and version the judge prompts (lenses)
   used to score student sessions, and run a judge over a captured session.

When you edit something you do not own, the page tells you whose it is, and the
teacher's page afterwards says **who last edited it** and when. Every such edit
is also recorded for audit.

## Getting access

The researcher role is a claim an administrator sets on your account (via
`aiplatform users grant-researcher <uid>`). Once granted, sign out and back in
so your session picks up the new role. You will then see a **Research** item in
the sidebar and extra controls described below. Without the role, these surfaces
show a "Researcher access required" message.

## Cross-teacher observation

- **Research (activity scan)** — the **Research** sidebar item opens a scan of
  *every* teacher's activities, in every state (Draft / Private / Shared), with
  the owner shown. Use it to see what is being built across the cohort. Open one
  to see exactly what the teacher configured; from there, **Open in editor**
  changes it on their behalf.
- **Research view (classes)** — on **Classes**, a **My classes / Research view**
  toggle switches the list to every teacher's classes; **Manage** opens any of
  them with the same controls the teacher has.
- **Insights across all teachers** — on **Insights**, a **My classes / All
  teachers** scope toggle widens the engagement comparison to the whole cohort.
- **Cost** — a researcher-only **Cost** tab under Insights breaks cross-class
  spend down by cohort, model, voice (speech-to-text / text-to-speech) and
  class, over a period you choose.

![The cross-teacher research surfaces — every teacher and class, with the owner shown.](/guides/assets/r1-01-research.png)

## Rubric experimentation

Under **Settings**, the **Research · judge lenses** panel is where you shape and
test how student sessions are scored:

- **Judge lenses** — for each lens you can enable/disable it, choose the **judge
  model**, inspect the **default prompt**, and write a **judge prompt override**.
  Saving an override **bumps its version**, so you can iterate on the wording and
  keep the history. **Reset to default** reverts it.
- **Experiment — score a captured session** — paste a session id, pick a lens,
  and **Run judge** to see the score profile that lens produces on real data (or
  an "Abstained" result when the lens declines to score).

![The rubric experimentation panel: versioned judge prompts and a judge you can run on a captured session.](/guides/assets/r1-02-lenses.png)

This is the workflow for developing the capability-floor rubrics: change a lens
prompt, run it against known sessions, compare the profiles, and promote a
version when it behaves.

## Next steps

- The teacher-facing surfaces work as documented in *T1–T4*; the researcher
  views sit alongside them.
