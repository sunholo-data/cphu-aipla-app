---
title: "Propose a simulation"
description: "Say precisely what a simulation should let a student do, so it can be built."
tag: "R2"
audience: "researcher"
order: "2"
lang: "en"
status: "Current"
owner: "AIPLA project team"
reviewed: "2026-09-14"
reviewBy: "2026-12-13"
---
::: callout-note
## For physics staff

This is for the person who knows the physics, not the person who writes the
code. You do not need to be able to build a simulation to get one into AIPLA —
you need to be able to say precisely what it should let a student *do*. Drafting
it in an AI chat is encouraged, and there is a prompt below that makes the draft
land in the right shape.
:::

## What a simulation is here

A simulation in AIPLA is a small interactive bench that opens beside the tutor
in the student's workspace. The student changes something, watches what happens,
and records readings. The tutor sees those readings and can ask about them.

Seven are live today:

| Simulation | The student's job |
|---|---|
| Boldkast | Launch a projectile, find the angle for maximum range |
| LED Planck | Measure LED threshold voltages, fit Planck's constant |
| KineBot | Read motion graphs |
| Elkedel | Heat water, measure energy in and temperature out, find the efficiency |
| Faseovergange | Heat ice to steam, read the plateaus off the heating curve |
| Bølgefart | Set *f* and *λ*, work out the wave speed |
| Interferens | Add two waves, find constructive, destructive and beats |

Note the shape they share. **The simulation never shows the answer.** The kettle
reports energy and temperature and never the efficiency; the wave bench reports
*f*, *λ* and *T* and never the speed. That withholding is the exercise, and it
is the single most useful thing you can specify when you propose one.

## The one question worth getting right

> **What does the student measure, and what do they work out from it?**

If you can answer that in one sentence, the rest follows. If the answer is "they
watch it", it is a diagram rather than a simulation, and a picture in the
activity will serve better.

Two things follow from your answer:

- **The readings the bench must show.** These are instrument faces — a
  thermometer, a stopwatch, a frequency readout. Showing them is fine.
- **The value that must stay hidden.** The thing being calculated. It never
  appears on screen, and it goes into a private note for the tutor instead so
  the tutor can mark an answer without handing it over.

## What belongs in the simulation, and what does not

The bench holds the live experiment: the thing being simulated, the controls
that act on it, the instruments reading it, and a small table of the readings
the student has captured.

Everything else is better placed elsewhere, and placing it elsewhere makes it
*more* useful, not less:

| If your draft has | Where it actually goes |
|---|---|
| A numbered task list, "your turn" steps | the tutor, which can adapt them to the student |
| Constants, a formula sheet | the tutor, on request |
| A long problem statement | the activity's goal, which the teacher writes |
| A quiz, a multiple-choice check | an activity element |
| Its own chat box or "ask AI" button | deleted — AIPLA supplies the tutor |
| Its own title bar and logo | deleted — the app draws that |

The bench is about 700 px wide on a laptop and 390 px on a phone, so this is not
tidiness. Anything that is not the experiment is crowding the experiment out.

## How to draft one

**Use an AI chat, and paste the authoring prompt.** It is published at
<https://aipla.ku.dk/project/build-a-simulation> (copy button), and as a plain
file your chat can fetch by URL: <https://aipla.ku.dk/sim-authoring-prompt.txt>.
It tells the AI the size limit, the
"no external resources" rule, the light-on-white visual standard and the event
vocabulary, so what comes back can be dropped in with little rework rather than
rebuilt.

Then describe your experiment. A good brief says:

1. **The physics.** The relationship the student should come away with.
2. **What they control**, with ranges and units.
3. **What the instruments read.**
4. **What must stay hidden**, explicitly.
5. **What "done" looks like** — the capture or commit action.

Open the result in a browser and try it. You are the physics reviewer; nobody
downstream can catch a wrong model, and the automated checks certainly cannot.

## What happens to your draft

Hand over the HTML file. It then goes through a documented path
(`mcp-app-artefact`) that does the following, none of which is your problem:

- splits anything that turned out to be two experiments into two benches;
- strips the task list into the tutor's private brief;
- rewrites the text so Danish and English come from one place;
- wires the capture button so the tutor actually receives the readings and the
  student sees a "shared with the AI" card;
- runs the security, size, layout and phone-width gates;
- drives it in a real browser and captures the events;
- writes the tutor's private note, including your reference values.

Then it is in the library and any teacher can attach it to an activity.

## Two things we will ask you

**Sign off the physics.** ADR-013 asks a physics reviewer to approve a
pedagogically loaded simulation before it ships, and nothing automated checks
this. When a draft comes back to you, the question is whether the model is right
and whether the Danish reads like physics teaching.

This is not a formality. The wave draft in September 2026 gave two waves in the
same medium a shared frequency and independent wavelengths, which makes them
travel at different speeds — impossible in one medium, and the "beats" it
produced were a drawing artefact rather than physics. It was caught during the
port, not by any gate. A physicist reading it would have caught it sooner.

**Tell us the reference values.** The constants a tutor needs in order to mark an
answer — the real efficiency, the latent heats, the medium's speed. They go in
the tutor's private brief, which the student's browser never receives, under an
instruction never to state them outright.

## What a simulation cannot do

Worth knowing before you design around it:

- **It does not remember.** A student returning tomorrow gets their chat history
  but the bench reopens at its defaults. Readings that must persist belong in an
  activity table, not in the bench.
- **It cannot reach the internet.** No live data, no external images, no
  lookups. Everything ships inside the one file.
- **It does not know who the student is**, and it does not receive the activity's
  language yet — it takes its own default (Danish) until that is wired.
- **A constant inside it is readable by a determined student** who opens the page
  source. The guarantee is "not handed to you", not "cryptographically hidden".
  Anything that must genuinely be secret needs a different approach — say so and
  it will be built differently.

## Who to ask

| For | Ask |
|---|---|
| Handing over a draft | M or AD |
| Whether an idea suits a simulation or an activity element | M or AD |
| Physics review of someone else's draft | you, AR or JB |
