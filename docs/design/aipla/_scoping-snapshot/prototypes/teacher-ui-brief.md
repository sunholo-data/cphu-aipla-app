# Design brief: Teacher UI

**Status:** Needed for Wed 3 June check-in  
**Scope:** Teacher-facing surfaces only — student-facing UI unchanged  
**Target repo:** `sunholo-data/cphu-aipla-app`  
**Depends on:** ADR-001 (group auth), ADR-005 (chat log storage), activity config model

---

## What teachers need to do

From the 2026-05-25 meeting:

1. Enter a teaching goal / prompt for each activity they configure
2. See what happened in a session (per-group activity report)
3. Chat with the session data to get analysis ("chat to the data")
4. Manage classes, groups, and which activities each group can access

---

## Screen map

```
Teacher Dashboard
├── /teacher/classes          — class list, create class
├── /teacher/classes/:id      — class detail: groups + assigned activities
├── /teacher/activities       — activity library: browse, configure, preview
├── /teacher/activities/:id   — activity configuration (teaching prompt, skill settings)
├── /teacher/reports          — session reports across all classes
├── /teacher/reports/:groupId — single-group session report
└── /teacher/analytics        — analytics chat ("chat to the data")
```

---

## Screen 1: Dashboard

```
┌─────────────────────────────────────────────────────┐
│  AIPLA  [7B Physics A ▾]              [AR] [logout]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  My classes                          [+ New class]  │
│  ┌──────────────────┐  ┌──────────────────┐        │
│  │ 7B Physics A     │  │ 8A Physics A     │        │
│  │ 4 groups active  │  │ 2 groups active  │        │
│  │ [Manage] [Report]│  │ [Manage] [Report]│        │
│  └──────────────────┘  └──────────────────┘        │
│                                                     │
│  Recent activity                                    │
│  bold-kazoo-87   Boldkast   14 min ago  [view]     │
│  ruby-petal-72   Boldkast   1 hr ago    [view]     │
│  fluffy-goose-56 LED Planck yesterday   [view]     │
│                                                     │
│  [Chat with all session data →]                     │
└─────────────────────────────────────────────────────┘
```

---

## Screen 2: Class detail

```
┌─────────────────────────────────────────────────────┐
│  ← Dashboard   /  7B Physics A                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Groups                              [+ New group]  │
│  ┌────────────────────────────────────────────────┐ │
│  │ bold-kazoo-87   active now   [Copy code] [↗]  │ │
│  │ ruby-petal-72   idle         [Copy code] [↗]  │ │
│  │ fluffy-goose-56 completed    [Copy code] [↗]  │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  Activities available to this class  [+ Add]        │
│  ✓ Boldkast — projectile motion      [Configure]    │
│  ✓ LED Planck — Planck's constant    [Configure]    │
│  ○ Pendul — harmonic motion          [Add]          │
│                                                     │
│  [View class report]  [Chat with class data →]      │
└─────────────────────────────────────────────────────┘
```

**Code generation:** The [+ New group] button generates a friendly code automatically (`bold-kazoo-87` style). Teacher copies it and hands it to students verbally or on the board. No email, no account creation for students.

---

## Screen 3: Activity configuration

Four-tab layout. **Teaching goal is live as of 2026-05-26**; Parameters, Code, History are wireframes (v1.1/v2 targets).

```
┌─────────────────────────────────────────────────────┐
│  ← 7B Physics A  /  Configure: Boldkast            │
│  [Teaching goal] [Parameters v1.1] [Code v2] [History v2] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  TAB: Teaching goal                          [Live] │
│  ┌─────────────────────────────────────────────┐   │
│  │ What do you want students to discover in    │   │
│  │ this session?                               │   │
│  │                                             │   │
│  │ I want students to find that horizontal     │   │
│  │ and vertical motion are independent, and    │   │
│  │ that 45° gives the longest range.           │   │
│  │                                             │   │
│  └─────────────────────────────────────────────┘   │
│  The tutor will use this to prioritise its         │
│  questions without revealing the concepts.         │
│                           [Save]  ← real backend   │
│                                                     │
│  [Preview as student]                               │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  TAB: Parameters                      [v1.1 target] │
│                                                     │
│  Bounded knobs — sliders and toggles for the        │
│  skill's configurable settings (temperature,        │
│  hint frequency, allowed topics, etc.)              │
│  No raw prompt editing needed.                      │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  TAB: Code                              [v2 target] │
│                                                     │
│  AI-assisted direct editing of the skill's system   │
│  prompt / source. Validator badges flag issues      │
│  (e.g. "this wording may give answers directly").   │
│  For advanced teachers who want full control.       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  TAB: History                           [v2 target] │
│                                                     │
│  Version log: each Save creates a version.          │
│  [Rollback] to any prior version.                   │
│  Shows diff between versions.                       │
└─────────────────────────────────────────────────────┘
```

**Teaching goal → system prompt (confirmed working 2026-05-26):**

```
[BASE SOCRATIC PROMPT]
...
TEACHER'S FOCUS FOR THIS SESSION:
{teacher_focus}

Use this to shape which concepts you guide toward first. Never state
these concepts directly — only ask questions that lead the student there.
```

Teachers write teaching intentions, not system prompts. The skill template handles the Socratic scaffolding. The `{teacher_focus}` slot injection was end-to-end verified: set goal on config screen → join `/group` with `local-demo` → first agent turn reflects it.

**Tab progression rationale:** Teaching goal is the entry-level teacher affordance. Parameters adds bounded control without raw prompt editing. Code is the power-user path for teachers who want full prompt access, with AI assistance and a validator to catch common mistakes (giving answers directly, breaking Socratic constraints). History makes iteration safe — teachers can experiment knowing they can roll back.

---

## Screen 4: Single-group session report

From the meeting: *"reports on what happened to the student, and opt-in to send to the teacher."*

```
┌─────────────────────────────────────────────────────┐
│  ← 7B Physics A  /  bold-kazoo-87  /  Report       │
│  Activity: Boldkast   Session: 2026-05-25 14:12     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Session summary                                    │
│  Duration: 22 min   Messages: 34   Sim runs: 8     │
│                                                     │
│  What the group did                                 │
│  ● Launched sim 8 times (angles 20°–75°)            │
│  ● Discovered max range at ~45° (turn 14)           │
│  ● Asked 3 off-topic questions (redirected)         │
│  ● Completed self-assessment: steps 1, 2, 4 ✓      │
│    step 3 (explain vx independence) ✗               │
│                                                     │
│  Conversation log                    [Download CSV] │
│  ┌────────────────────────────────────────────────┐ │
│  │ [14:12] Student: hvad sker der hvis vi...      │ │
│  │ [14:13] Tutor: Godt spørgsmål — hvad tror...  │ │
│  │ ...                                            │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  Share with student group?   [Send summary →]       │
│  (students opt in at session end to receive this)   │
└─────────────────────────────────────────────────────┘
```

**Opt-in share:** At the end of a session the student-facing UI shows: *"Want a summary of what you explored sent to your teacher?"* Yes/No. If yes, the teacher sees a flag on the report indicating student consent; the summary is also shareable back to the group's session screen.

---

## Screen 5: Analytics chat

From the meeting: *"the teacher can chat to the data to get analysis."*

```
┌─────────────────────────────────────────────────────┐
│  ← Dashboard  /  Analytics chat                     │
│  Data scope: [7B Physics A ▾] [All time ▾]          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  What did students struggle with most this week?    │
│  ──────────────────────────────────────────────     │
│  Across 6 sessions (Boldkast), the most common      │
│  sticking point was the independence of vx and vy   │
│  (4 of 6 groups did not complete checklist step 3). │
│  Two groups asked multiple off-topic questions in   │
│  the first 5 minutes, suggesting the activity      │
│  introduction may need more scaffolding.            │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ Ask a question about your session data...   │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Suggested questions:                               │
│  · Which group made the most progress?              │
│  · What concepts came up most often?                │
│  · How long did groups spend on the simulator?      │
└─────────────────────────────────────────────────────┘
```

**Backend:** Analytics chat is a teacher-facing skill that has read access to the session log store (BigQuery via ADR-005). The skill's system prompt is analytics-focused, not Socratic — it answers factual questions about session data, summarises patterns, and flags groups that may need follow-up. No student PII is surfaced; logs are keyed on group ID only.

---

## Implementation notes for the app agent

### Auth gate
All `/teacher/*` routes require UCPH SSO. Return 401 for unauthenticated requests; redirect to SSO login flow. Students never hit these routes (their entry point is `/group`).

### Activity config storage
Store per-activity, per-teacher configuration as a JSON document:

```json
{
  "activity_id": "boldkast-v1",
  "teacher_id": "ucph-sso:ar@ku.dk",
  "class_id": "7b-physics-a-2026",
  "teaching_goal": "I want students to find that horizontal and vertical...",
  "language": "da",
  "difficulty": "standard",
  "workbench": "boldkast-simulator-v1",
  "updated_at": "2026-05-25T14:00:00Z"
}
```

### Session summary generation
On session end (group disconnects or 30-min idle), trigger a background job:
1. Pull the group's chat log from BigQuery
2. Call the analytics skill with a fixed summary prompt
3. Store the summary alongside the log
4. If student opted in, flag the record and make it available to the teacher report screen

### Tech stack for teacher UI
Use the same React/Next.js frontend as the student-facing app. Teacher routes are a separate set of pages behind the SSO middleware. No new framework needed.

---

## Wed 3 June check-in scope

Minimum to show:
- [ ] Teacher login (UCPH SSO or stub)
- [ ] Class list + class detail (groups + assigned activities)
- [ ] Activity configuration screen with teaching goal input
- [ ] At least one session report (can be seeded with v0.1 Boldkast data)

Stretch:
- [ ] Analytics chat stub (can be a simple echoing bot initially)
- [ ] Opt-in share flow on student side
