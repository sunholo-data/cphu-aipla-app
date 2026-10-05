---
title: "Create your first activity"
description: "Build a guided activity: teaching goal, workspace, and live preview."
tag: "T2"
audience: "teacher"
order: "2"
lang: "en"
status: "Current"
owner: "AIPLA project team"
reviewed: "2026-10-05"
reviewBy: "2027-01-05"
---
::: callout-note
## Before you start

An activity always belongs to a **class**. If you have not created a class
yet, follow guide *T1 — Set up a class and share it* first, then come back
here. This guide takes about five minutes.

Short on time? The **Getting started** card on *Classes* offers **Adopt from
the library** — a colleague's shared activity copied into your class in one
click, no builder needed. Come back here when you want to make your own.
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

The builder has an AI **co-pilot** (**Ask AIPLA** → *Medbygger*). Tell it what you want to
teach and it drafts a teaching goal and workspace elements you can edit and
apply — see *T4 — Author with the AI co-pilot*. Every step below can also be
done by the co-pilot, not only by hand.
:::

## Step 1 — Open the activity builder

From your teacher area, open **Classes**, choose the class this activity is
for, and select **New activity**. (You can also reach the builder from the
class page's **New activity** button, which pre-selects that class for you.)

![The activity builder opens with a template picker at the top and a live preview on the right.](/guides/assets/t2-01-new-activity.png)

## Step 2 — Choose a starting point

At the top of the builder is **Start from a template**. Click a template close
to what you want — it fills in a sensible starting configuration, and the
preview beside the builder shows what students will see — or choose **Start
from scratch**. You can change everything afterwards, so the choice is not
binding.

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
for themselves.) The tutor itself comes from the class (guide *T1*); the Setup
section shows which one will teach.

![The teaching goal is the instruction the tutor follows. Keep it specific.](/guides/assets/t2-03-goal.png)

## Step 4 — Add a workspace (optional)

In the **Workspace** section, add the elements your students will use — a
simulation, a checklist, a table to fill in, a chart, a calculator, or notes —
or leave it empty for a chat-only conceptual dialogue. The **live
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

When you are happy with the preview, select **Create activity**. You will see
a confirmation that the activity is live for your class.

![The activity is now live; students who join the class group code can open it.](/guides/assets/t2-05-success.png)

From the confirmation you can:

- **Configure activity** — reopen it to add curriculum documents or refine the
  goal (see *T3 — Add and organise curriculum materials*). Once it is saved,
  **Try as student** there opens the real student view in a new tab, tutor
  included, with no join code.
- **Create another** — start a fresh activity for the same class.
- **Back to classes** — return to your class list.

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
