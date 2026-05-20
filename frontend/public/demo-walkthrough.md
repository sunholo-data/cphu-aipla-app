# AIPLA v0.1 — Jutland demo walkthrough (2026-05-27)

A one-page script JB + Aswin can read off during the teacher visit. The
deployed URL is recorded outside this repo (in the scoping site's
private `notes/` dir).

## Before opening the laptop

- **Group code**: written on a separate sticky / piece of paper. Looks
  like `XXXX-YYYY`. Don't type it where teachers can photograph the
  screen.
- **Backup plan**: if the deployed URL is unreachable on Jutland WiFi,
  run `LOCAL_MODE=1 make dev` on JB's laptop and demo from
  `http://localhost:3456` instead. Same UI, same skill, no internet
  dependency.

## The demo (5–8 minutes)

### 1. Open the URL — "Welcome to AIPLA" (30s)

Open the deployed URL. The screen shows the AIPLA wordmark, the tagline
*"AI in Physics Learning and Assessment"*, and a Sign In button.

**What to say:**

> This is the working version of the AIPLA tool. By the time you have it
> in your classrooms in the autumn there will be a teacher-config UI as
> well — what you're seeing today is the student side.

### 2. Click into the group-join page (30s)

Either navigate to `/group` directly or scroll until the "Tilslut din
gruppe" prompt is visible.

**Show the teachers**:

- Danish-first copy, English alongside.
- One input, one button — no sign-up, no email, no privacy concern.

**What to say:**

> One phone per group of three. Group code in, in the morning. Nothing
> the system can tie back to a specific student.

### 3. Type in the demo group code (30s)

Use the pre-arranged code on the sticky. After a successful join the
page redirects to `/` and the chat surface is ready.

### 4. Ask the first scaffolding question (2 min)

In Danish (or English — the tutor will match):

> *"Hjælp med opgave 1"*  ("Help with problem 1")

The tutor (`problem-set-hints` skill running on `gemini-3.5-flash`)
should respond with **a decomposition of the problem + a question
back** — not a solution. Expected shape:

- Acknowledges what the student is working on (opgave 1, projectile
  motion)
- Asks what they've already tried
- Or offers to break the problem into 3–5 sub-steps and asks which
  one they're stuck on

### 5. Demonstrate the "no solutions" rule (2 min)

Type a demand for the answer:

> *"Bare giv mig svaret"*  ("Just give me the answer")

The tutor should **decline politely and redirect** — pointing the
student at the next sub-step they should work on. Some humour is OK
here, but the tutor must not yield.

**What to say to the teachers:**

> The rule is encoded in the system prompt — the tutor literally can't
> give you a final number. It will scaffold; it won't substitute. That's
> the whole point of the design and it's what the project research
> question is testing.

### 6. Demonstrate the conceptual hint (1–2 min)

Ask a concept question that targets the difficulty AR's prior trials
documented (independence of horizontal and vertical motion):

> *"Hvorfor kan jeg ikke bare bruge én formel?"*  ("Why can't I just
> use one formula?")

The tutor should surface the conceptual point that the horizontal
motion is uniform and the vertical motion is uniformly accelerated —
ideally without naming the equations themselves, asking the student
to think about what's *constant* and what's *changing*.

### 7. Wrap (1 min)

**What to say:**

> What this *isn't*: a content-creation tool, a marking tool, or a
> replacement for you. What it *is*: scaffolding-on-demand, infinitely
> patient, with no data leaving the EU and nothing tracked back to any
> specific student.
>
> For autumn we'll have a teacher side too — you'll choose a topic, the
> problem-set, the difficulty you want emphasised. We're showing the
> student side first because that's what we built first.

## If something goes wrong

| What | Why | Recover |
|---|---|---|
| Page won't load | Jutland school WiFi blocks `*.run.app` or has DNS issues | Switch to `LOCAL_MODE=1 make dev` on JB's laptop, use `localhost:3456` |
| Tutor takes >5s for first response | Gemini 3.5 Flash thinking-mode + cold-start on Cloud Run | Wait it out once; the next response will be fast. Don't refresh. |
| Tutor gives a numerical answer despite scaffolding prompt | Model regression — should be caught by the M4 smoke earlier; if it slips through, note the exact question and we patch the system prompt afterwards | Move on to the next sample question; flag it for AR's review later |
| Group code says "expired" | The group's session cap or TTL hit | Use the second sticky code (carry two; one is the backup) |
| Browser shows a permission error | The user's UCPH or work-managed Chrome is doing something exotic | Open in incognito; or use a personal phone |

## After the demo

Capture (mentally or on paper):

- Which teachers were curious vs sceptical, and about what
- Any concrete classroom situation a teacher named ("I'd want to use
  this for X" or "this would never work for Y")
- Any UX complaint that landed in the first 30 seconds (those are the
  ones to prioritise for v1)

Share notes with M after the visit — they feed into the buffer-week
prompt iteration before the teacher pilot in August.
