---
title: "Create your first activity"
description: "Build a guided activity: teaching goal, workspace, and live preview."
tag: "T2"
audience: "teacher"
order: "2"
lang: "en"
status: "Current"
owner: "AIPLA project team"
reviewed: "2026-11-11"
reviewBy: "2027-01-05"
---
::: callout-note
## Before you start

An activity always belongs to a **class**. If you have not created a class
yet, follow guide *T1 — Set up a class and share it* first, then come back
here. This guide takes about five minutes.

Short on time? The **Getting started** card on *Classes* offers **Adopt from
the library**. It opens **Shared by colleagues** on *Activities*, where **Copy
to my activities** copies a colleague's activity into your library as a draft;
**Assign** then puts it in your class — no builder needed. Come back here when
you want to make your own.
:::

## What an activity is

An **activity** is a single guided task your students open in the tutor. You
set the teaching goal and, optionally, a workspace — a simulation, a table, a
chart, a calculator, or guiding notes. Students join with the class group code
and work through the activity in conversation with the AI physics tutor, which
follows the goal you set.

You do not need to write any code, and you do not need a developer. Everything
on this page is done in your browser.

::: callout-tip
## Prefer to describe it in words?

The builder has an AI **co-pilot** (**Help** → **Co-builder**). Tell it what you want to
teach and it drafts a teaching goal and workspace elements you can edit and
apply — see *T4 — Author with the AI co-pilot*. Every step below can also be
done by the co-pilot, not only by hand.
:::

## Step 1 — Open the activity builder

From your teacher area, open **Activities** and select **New activity**. (You
can also start from a class: on the class page's **Setup** tab, open **Add
activity** and choose **Create a new activity…**, which pre-selects that class
for you.)

![The activity builder opens with a template picker at the top and a live preview on the right.](/guides/assets/t2-01-new-activity.png)

## Step 2 — Choose a starting point

At the top of the builder you choose how to start: **Start from a template**
or **Start from scratch**. A template opens a strip of ready-made activities;
click one close to what you want — it fills in a sensible starting
configuration, and the preview beside the builder shows what students will see.
The choice then shrinks to one line (*Template: …*) with **Change** if you want
another. You can change everything afterwards, so the choice is not binding.

## Step 3 — Set the teaching goal

The builder has four sections: **Setup**, **Lesson**, **Workspace** and
**Materials**. Under **Setup**, give the activity an **Activity name**. Under
**Lesson**, write the **Lesson prompt (the teaching goal)**. The goal is the most
important field: it is the instruction the tutor follows when it talks to your
students. Write it as you would brief a teaching assistant — for example,
*"Help the student reason about energy conservation on a frictionless ramp;
do not give the final answer, ask guiding questions."*

Under **Setup**, also set **Students' language** — the language students see
the activity in and the tutor replies in. (A student can still switch DA | EN
for themselves.) The tutor itself comes from the class (guide *T1*); the
**Tutor** row in the summary at the top of the builder shows which one will
teach, with **Change in the class** to change it there.

![The teaching goal is the instruction the tutor follows. Keep it specific.](/guides/assets/t2-03-goal.png)

The same summary has a **Students see first** row. Its **Change** opens **What
students see first**, where you write the student introduction, choose to
introduce the activity in class yourself, and set starter questions. Leave
these fields empty for the activity-specific defaults. The panel preview
updates as you edit. See [T5 — Introduce the tutor](t5-introduce-the-tutor).
(The **Student view** row beside it sets how the students' screen is arranged.)

## Step 4 — Add a workspace (optional)

The **Workspace** section starts empty and shows only what you add. Select
**Add to the workspace** and pick from the grid of element types — a
simulation, a checklist, a table to fill in, a chart, a calculator, notes and
more. Choosing **Simulation** opens a picker of the available simulations.
Each element you add appears as a card with **Edit**; its **⋯** menu removes it.
Or leave the workspace empty for a chat-only conceptual dialogue. The **live
preview** on the right updates as you add each element, so you see exactly
what the student will see.

::: callout-tip
Anything the student does in the workspace — values they enter, a simulation
they run — is shared with the tutor, so it can respond to their actual work.
:::

::: callout-note
## Building your own simulation?

Start from the standard authoring prompt rather than a blank chat. Copy it from
<https://aipla.ku.dk/project/build-a-simulation>, or give your AI chat the plain
file <https://aipla.ku.dk/sim-authoring-prompt.txt>. A simulation built from it
tells the tutor when a student takes a measurement or finishes a mission, so
the tutor responds without you prompting it, and its control panels fold away
so they do not cover the simulation on a laptop or phone. A simulation built
without it can work well and still miss both.
:::

![The live preview shows the student's view as you build.](/guides/assets/t2-04-elements.png)

## Step 5 — Create the activity

When you are happy with the preview, select **Create activity**. A short
message confirms that the activity is created and live for your class — it
also offers **Create another**, to start a fresh activity for the same class —
and the activity opens in the editor.

![The activity is now live; students who join the class group code can open it.](/guides/assets/t2-05-success.png)

In the editor you can add curriculum documents or refine the goal (see *T3 —
Add and organise curriculum materials*) and **Save**. A line under the title
says when the activity was created and last edited. **Try as student** at the
top opens the real student view in a new tab, tutor included, with no join
code.

## What students see

Students open the activity from the class group code (no login, no personal
account — see *S1 — Join and use your tutor*). They get the tutor and, if you
added one, the workspace. The tutor follows the goal you set and can see the
work the student does in the workspace.

## Next steps

- Add curriculum documents so the tutor can ground its answers in your
  materials — *T3*.
- Let the AI authoring co-pilot draft an activity from a plain-language
  description — *T4 — Author with the AI co-pilot*.
