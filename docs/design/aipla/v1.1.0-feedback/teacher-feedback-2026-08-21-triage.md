# Teacher feedback, 21 August 2026 — repo-side disposition map

**Status:** Triaged 2026-08-27. Source record: [notes-2026-08-21-teacher-feedback.md](../../../notes-2026-08-21-teacher-feedback.md) (28 items, verbatim quotes, Danish originals).
**Nature:** The **human** half of the 2026-08-21 pilot session. Its sibling
[pilot-session-2026-08-21-followups.md](pilot-session-2026-08-21-followups.md) is the **log** half —
four defects found in prod telemetry. Read together: the logs say what broke, this says what it cost.
**Last updated:** 2026-08-27

## Summary

Of 28 items: **4 are already fixed** (by 1.1.79 and `1db461f`, both landed after the session but before
this triage), **13 are new build items** in three coherent clusters, **6 are decisions for M**,
and **5 are content, process or pedagogy** rather than engineering.

**The headline is item 1**, and it is not in the logs at all. A teacher built a whole lesson on
"students work previous Physics A exam questions with the tutor", uploaded the papers as activity
materials, and *the tutor did not use them* — it asked students to paste the task in, and when
pushed, discussed a **different paper's Question 5**. Nothing 500'd. Nothing appeared in any error
budget. The activity simply did not do the thing it was built to do, and the failure mode was the
tutor being confidently wrong about which exam question it was looking at.

**The second theme is that the graph is not yet a graph.** Four separate items (4, 5, 6, 7) are
about the same 186-line hand-rolled SVG in
[`WorkbenchChart.tsx`](../../../../frontend/src/components/workspace/WorkbenchChart.tsx). It draws
two axis lines and two axis labels and **not one tick, gridline or number**. In a physics course
whose whole point is reading quantities off a plot, that is the most-repeated complaint in the set
and the cheapest to fix.

**The third is that the teachers are now asking for authoring ergonomics, not features** (items 9,
11, 12, 13, 14). Reorder the elements. Two tables, not one. Drag a column. Make the co-pilot panel
big enough to read. This is what adoption looks like: they have stopped asking whether they can
build activities and started complaining about how it feels to build them.

### What the session already cost us, and what it did not

Four items (2, 10, 15, and the trust half of 25) are **downstream of the four silent defects**
already fixed in 1.1.79. Autosave, for instance, has had a 2-second debounced save since 1.1.73 —
on the day it was 403ing, so a teacher watched students lose work and reasonably concluded the
feature was missing. **These items must not be counted as new demand**, and equally must not be
closed silently: the teacher's belief is still "it does not save".

## Disposition map

| # | Item (short) | Type | Disposition |
|---|---|---|---|
| 1 | Tutor ignores uploaded assignment files; cites a different Question 5 | **Defect (design-level)** | **D1 ANSWERED 2026-08-27 → [1.1.87 activity-task-materials-in-context.md](activity-task-materials-in-context.md).** `MaterialRef.kind` decides: `image` gets the ADK artifact path (the tutor HAS it), `curriculum` gets a retrieval tool it may choose to call. A PDF is `curriculum`. The fix is the missing third loader/injector twin. |
| 2 | Screenshot in chat gets an off-topic reply | Defect | **NEEDS REPRO.** Chat image attach is wired (1.1.7, `ImageComposer` + `useImageAttachments`). Most likely the students were in the documents panel, which rejects images (item 15), or hit the 23 upload 500s. Reproduce before designing. |
| 3 | Long response latency | Known | **PARTIALLY ADDRESSED.** [thinking-budget-configuration](thinking-budget-configuration.md): env layer shipped 2026-06-24; per-skill / per-turn / persona layers still Planned. Schedule the per-skill layer. |
| 4 | No numbers or divisions on axes | **New build** | **CHART CLUSTER** → [workbench-chart-readability.md](workbench-chart-readability.md). Confirmed: zero tick marks in the component. |
| 5 | Graph start point off-screen; wants zoom-to-fit | **New build** | **CHART CLUSTER.** Partly the chart's fixed 300×200 viewBox, partly panel layout — overlaps item 12. |
| 6 | Regression (linear/exp/power/logistic) + peak readout | **Deferred — D2 DECIDED 2026-08-27** | Ticks first, regression decided on its own evidence. 1.1.84 M3 is written but explicitly gated; items 4/5/7 do not wait behind it. |
| 7 | No axis division in the point plot when entering data | **Duplicate of 4** | Same component, same fix. Confirms the complaint arrived from two independent teachers. |
| 8 | One upload field for all types; paste from clipboard | **New build** | **UPLOAD CLUSTER** → [student-upload-consolidation.md](student-upload-consolidation.md). Confirmed three separate upload surfaces and no paste handler anywhere in the frontend. |
| 9 | Co-builder panel too small to read the conversation | **New build** | **BUILDER CLUSTER** → [activity-builder-ergonomics.md](activity-builder-ergonomics.md). Confirmed `max-h-[70vh] w-[min(384px,…)]`, not resizable. |
| 10 | Autosave so work survives navigating away | **ALREADY SHIPPED** | `WRITING_SAVE_DEBOUNCE_MS = 2000` since 1.1.73. It was **403ing on the day** (defect B) — fixed in 1.1.79. Tell the teacher; do not build. |
| 11 | Equation editor in the note field | **New build** | **BUILDER CLUSTER.** KaTeX *rendering* already works everywhere (`ChatMarkdown` → `remarkMath`/`rehypeKatex`); the gap is **input**. |
| 12 | Choose the order of workspace elements | **New build** | **BUILDER CLUSTER.** |
| 13 | Several instances of one element (two tables) | **ALREADY DESIGNED — un-defer** | [multi-table-activities.md](multi-table-activities.md) (1.1.71), designed 2026-08-10, deferred during pilot week for id-migration risk. **Third independent request** (Aswin 10 Aug · 25 Aug notes · this teacher). Shares a root cause with item 26. |
| 14 | Drag table columns to reorder variables | **New build** | **BUILDER CLUSTER.** |
| 15 | Upload fails: picker hides screenshots, then errors | **HALF FIXED** | The error is defect A (1.1.79, promoted). The **picker half is open**: `StudentDocumentWorkbench`'s accept list has no image types, so "Custom Files" genuinely hides screenshots. One-line fix, carried by the upload cluster. |
| 16 | No activities for the rest of the Physics C syllabus | **Content** | **NOT ENGINEERING** — the builder and the authoring co-pilot exist. → JB / AR / Aswin. **DECISION D6:** who authors them and by when. |
| 17 | Asterisk as a multiplication sign | **Ship directly** | Skill-instruction change. The tutors carry decimal-comma and "SI units explicit" rules but **nothing on `*`**, and KaTeX already renders LaTeX in chat. Same shape as 1db461f. |
| 18 | Missing units and symbols on values and formulas | **HALF SHIPPED** | 1db461f (2026-08-26) fixed the **authoring** half — every table and plot label carries its unit. The **tutor-prose** half ("position = 0,2*tid") is open and is the same fix as item 17. |
| 19 | Bot spots shared struggles and nudges collaboration | **Decision / research** | **DECISION D4.** JB's aspiration. No design doc covers cross-student pattern detection. Genuinely new capability, plausibly Year-2. |
| 20 | Class-level progress dashboard, possibly anonymous | **Partly exists** | `LiveClassView` on the class page + `/teacher/insights` cross-class comparison already ship. Gaps: per-student progress **over time**, and the "internal competition" framing. Discoverability first — the teacher did not know it existed. |
| 21 | Group/class reports vs students feeling surveilled | **Decision** | **DECISION D5** (M + JB). Reports exist; the granularity policy does not. Students named it as too much monitoring. |
| 22 | Post-lesson teacher survey | **Process** | Not engineering unless we host it. → JB. |
| 23 | Lightweight UI, usage cap, keep personal data out | **Information** | Already the posture. The per-teacher spend cap now genuinely binds (584035a, 2026-08-18). No action. |
| 24 | Individual mode where groupmates cannot see each other | **Open — scoped separately** | Pulls against 1.1.88, which makes the group's table genuinely shared. Likely answer: sharing is a property of the **activity**, not the platform. Open question 1 of 1.1.88. |
| 25 | Many small glitches; teacher feels they must check everything | **Addressed; re-measure** | The four 21-Aug defects were *all* silent failures — precisely what produces this feeling. 1.1.79 shipped fixes **and** gates. Re-ask after the next session rather than building anything. |
| 26 | Groupmates overwrite each other's table data; AI sees only the latest | **Defect — D3 DECIDED 2026-08-27** | → **[1.1.88 group-shared-table.md](group-shared-table.md).** Sharper than "revisit July": `WorkbenchTable` is the **last fillable element still on `sessionStorage`** — checklist, concept and writing all moved to per-group stores, and `writing_progress.py` names the table as the one left. Shares the `table.state` single slot with item 13. |
| 27 | Group codes inflexible; wants individual codes combinable into pairs/groups | **Scoped separately — D3 2026-08-27** | A genuine ADR-001 revision, to scope properly rather than patch. Not folded into 1.1.88, which deliberately keeps table state group-keyed and adds no per-student attribution. |
| 28 | How much authority should the bot have; explain *why* a task matters | **Pedagogy** | → JB / scoping. Partly reachable through [authoring-teaching-framework](authoring-teaching-framework.md) and personas, but the question is pedagogical, not technical. |

## The three build clusters

Each has its own design doc. None of the three needs a decision from M to start.

1. **[workbench-chart-readability.md](workbench-chart-readability.md)** — items 4, 5, 6, 7.
   Ticks, numbers, gridlines, sensible domains, and (behind D2) regression + readout.
2. **[student-upload-consolidation.md](student-upload-consolidation.md)** — items 8, 15, and the
   likely resolution of 2. One field, all types, clipboard paste.
3. **[activity-builder-ergonomics.md](activity-builder-ergonomics.md)** — items 9, 11, 12, 13, 14.
   Five independent teacher-authoring asks, all small, all on surfaces that already exist. Item 13
   is not redesigned there: it un-defers [1.1.71](multi-table-activities.md).

### One root cause under two items

`mcp_app_context.table.state` is a **single slot**, stated plainly in
[`element_state.py:194`](../../../../backend/adk/element_state.py#L194): *"Only ONE table's snapshot
can be live at a time."* Item 13 collides two **tables** in that slot; item 26 collides two
**students**. They will be fixed by the same key change, so 1.1.71's stable-id migration should not
be scoped before D3 is decided — migrating that key twice is the avoidable outcome.

## Decisions — D1, D2, D3 taken 2026-08-27

**D1 — item 1: how does the task reach the tutor? ANSWERED.** M asked whether the ADK artifact
mechanism could be used. **It can, and it already is** — for images. `MaterialRef.kind` is
`Literal["curriculum", "image"]`, and the two kinds reach the tutor by different mechanisms: an
image goes to a durable artifact slot, is copied into the student's session by
`make_activity_image_loader`, and is inlined every turn by `make_activity_image_injector` — the
tutor cannot miss it. A `curriculum` material gets `build_curriculum_retrieval_tool`, a
`VertexAiRagRetrieval` the model may choose to call, returning similarity-ranked chunks. **A PDF
of an exam paper is `curriculum`**, which explains both halves of the report: the tutor did not
look (retrieval is a tool it must elect to use), and when it did, similarity search across several
papers had no reason to prefer *this* paper's Question 5.

`adk/callbacks/activity_images.py` calls itself *"twins of the document pipeline"*, so the pattern
already runs on two paths — a student's attached document (text) and a teacher's activity image
(image Part). **A teacher's activity document is the missing third twin.**
→ [1.1.87 activity-task-materials-in-context.md](activity-task-materials-in-context.md).

**D2 — item 6: chart scope. DECIDED: ticks now, regression separately.** Items 4, 5 and 7 ship as
[1.1.84](workbench-chart-readability.md) M1/M2 without waiting; M3 (regression) is written but
gated, to be decided on its own evidence — including whether any Physics C activity needs the
logistic fit that was asked for by name.

**D3 — items 24, 26, 27: the group model. DECIDED: the table becomes genuinely shared; item 27 is
scoped separately.** Investigating this turned up something sharper than the framing the decision
was taken on. `WorkbenchTable` persists cells to **`window.sessionStorage`** — per browser tab —
and is the **last fillable element still doing so**. `checklist_progress`, `concept_progress` and
`writing_progress` are all per-group Firestore stores sharing one stated idiom, and
`writing_progress.py` names the table as the exception, quoting the cost already paid once:
*"three group members had three private checklists and none of them survived a closed tab."*

So item 26 is not a contested design decision — it is a documented defect already fixed three
times elsewhere and left un-fixed on the one element physics data lives in. The 2026-07-01
"workbench is per-device scratch" reasoning holds for sims and not for a shared data table, and it
has in any case already been overtaken by the three migrations that followed it.
→ [1.1.88 group-shared-table.md](group-shared-table.md).

Item 27 (individual codes composable into pairs and groups) stays a genuine ADR-001 revision, to be
scoped properly. Item 24 (isolated mode) pulls against 1.1.88 and is open question 1 there — the
likely resolution is that sharing is a property of the activity, not of the platform.

### Still open, and yours or JB's rather than blocking

**D4 — item 19: is cross-student struggle detection v1 or Year-2?** JB's aspiration; nothing in the
repo covers it. Needs per-student signal quality we do not have, and lands on D5's privacy surface.

**D5 — item 21: reporting granularity, with JB.** Reports at group and class level exist; students
told JB it felt like too much surveillance. Wants a stated policy — what a teacher sees, what a
researcher sees, what a student is told — not a feature.

**D6 — item 16: who writes the missing Physics C activities?** Astronomy, waves, atoms and light.
Pure content; the tooling is there. Needs an owner and a date, and it is the item most likely to
determine whether the next session goes well.

## Net effect

- **12 new build items** in 3 clusters, all on existing surfaces, none blocked on a decision — plus **one existing deferred doc to un-defer** (1.1.71, item 13).
- **2 immediate one-line-ish fixes** — the multiplication sign (17/18) and the upload accept list (15).
- **3 decisions taken** (D1, D2, D3 — 2026-08-27), producing [1.1.87](activity-task-materials-in-context.md) and [1.1.88](group-shared-table.md); **3 remain** (D4, D5, D6) and are JB-facing.
- **4 items already fixed** and needing a message back to the teachers, not a build.
- **5 items** that are content, process or pedagogy, owned by JB.

## Related documents

- [notes-2026-08-21-teacher-feedback.md](../../../notes-2026-08-21-teacher-feedback.md) — the verbatim record this triages
- [pilot-session-2026-08-21-followups.md](pilot-session-2026-08-21-followups.md) — the log-derived defects from the same session
- [group-shared-session-sync.md](group-shared-session-sync.md) — the July decision item 26 disputes
- [thinking-budget-configuration.md](thinking-budget-configuration.md) — item 3's remaining layers
- [activity-elements-palette.md](activity-elements-palette.md) — the recipe every builder-cluster element follows
- [activity-task-materials-in-context.md](activity-task-materials-in-context.md) — 1.1.87, from decision D1
- [group-shared-table.md](group-shared-table.md) — 1.1.88, from decision D3
