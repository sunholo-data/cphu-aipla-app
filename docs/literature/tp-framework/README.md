# TP Framework — primary literature

Reference material for the discipline-layer workstream (teaching-practice
cycle methods). Downloaded 2026-09 from the shared "TP Framework" Google
Drive folder:
https://drive.google.com/drive/folders/1s-dALtgQtGTOMzP6Hl4pvbNbIlwcDTF3

Folder names mirror the Drive source (including its typos — "Dialouge",
"Clam") so files stay 1:1 traceable with the Drive.

⚠️ **Citations below were re-read from the PDFs on 2026-09-10 and several were
wrong.** The originals were transcribed from Drive folder and file names, which
carry publisher filename artefacts. What changed is noted per row.

| Folder | Framework | Citation (verified from the PDF) |
|---|---|---|
| `5E Model/` | 5E learning cycle | Tanner, K. D. (**2010**). *Order Matters: Using the 5E Model to Align Teaching with How People Learn.* **CBE—Life Sciences Education**, 9(3), 159–164. ⚠️ was "2017 (J Coll Sci Teach)" — **both year and journal wrong** |
| `Accountable Talk/` | Accountable Talk | Michaels, S., O'Connor, M. C., Hall, M. W., with Resnick, L. B. *Accountable Talk® Sourcebook: For Classroom Conversation That Works.* Institute for Learning, University of Pittsburgh. ⚠️ authors were missing |
| `Authentic Dialouge/` | Authentic Dialogue | Dysthe, O. (1996). *The Multivoiced Classroom: Interactions of Writing and Classroom Discourse.* **Written Communication, 13(3), 385–425.** ⚠️ journal, volume and pages were missing |
| `Clam Evidence Reasoning (CER)/` | Claim–Evidence–Reasoning | McNeill, K. L. & Krajcik, J. (2008). *Inquiry and scientific explanations: Helping students use evidence and reasoning.* In Luft, Bell & Gess-Newsome (Eds.), *Science as Inquiry in the Secondary Setting*, NSTA Press. ⚠️ authors and containing book were missing |
| `ESRU/` | ESRU (Elicit–Student response–**Recognise**–Use) | Ruiz-Primo & Furtak, **JRST 44(1) 57–84 (2007)** ([see below](#esru--read-from-the-pdf-2026-09-09)) |
| `Predict Observe Explain/` | POE (≈ ECR) | Liew, C.-W. & Treagust, D. F. (1998). *The Effectiveness of Predict-Observe-Explain Tasks…* AERA, San Diego. ERIC ED420715. ⚠️ was the accession number alone |
| `Toulmin's Argument/` | Toulmin Argumentation Model | Erduran, S., Simon, S. & Osborne, J. (2004). *TAPping into argumentation…* **Science Education, 88(6), 915–933.** ⚠️ volume and pages were missing |

Working set for the cycle method: 5E, Accountable Talk, Authentic Dialogue,
CER, ESRU, POE, Toulmin. SDT and embodied cognition were deferred to the
conceptual framework (research/theoretical perspective), not the TP cycle.

> Note: these are copyrighted journal PDFs kept here as private working
> references — do not publish them into `frontend/content/` or any public
> surface.

The PDFs and `parsed/` are gitignored, so **this README is the only tracked
file here** — a fresh clone has the citations and none of the texts. `parsed/`
holds Markdown extractions alongside each PDF; read those rather than the PDFs.

## ESRU — read from the PDF, 2026-09-09

Grounding for `backend/frameworks/esru.yaml` (1.1.91). Two things the original
row got wrong, and one thing the framework we built was missing.

**1. Four moves, not three.** The abstract states the cycle verbatim: *"the
teacher **E**licits a question; the **S**tudent responds; the teacher
**R**ecognizes the student's response; and then **U**ses the information
collected to support student learning."* Recognise is its own move, with its own
coded strategies in Table 2.

**2. The year is a publication-date artefact, not a wrong paper.** The row read
*"Ruiz-Primo 2006 … (J Res Sci Teach)"*, which matches the Wiley filename in
`ESRU/`. The paper's own front matter resolves it:

> JOURNAL OF RESEARCH IN SCIENCE TEACHING **VOL. 44, NO. 1, PP. 57–84 (2007)**
> … Published online **8 December 2006** … © 2006 Wiley Periodicals, Inc.
> J Res Sci Teach 44: 57–84, **2007**

So it is **one paper with two defensible years** — online 2006, issue 2007 — and
Wiley named the file with the online one. Cite it as **2007, JRST 44(1),
57–84, doi:10.1002/tea.20163**.

*(An earlier note here claimed the row fused this paper with Ruiz-Primo & Furtak
2006 in* Educational Assessment *11(3–4). That companion paper is real, but it is
**not in this corpus** and was never what the row meant. The citation correction
stands; that explanation of it was wrong.)*

**3. ESRU is two-dimensional — now modelled.** The
model crosses the four moves with the domains of scientific inquiry — *epistemic
frameworks* and *conceptual structures* (a third, *social processes*, the authors
treat as inherent to any assessment conversation and do not code separately).
Critically, the paper scopes the split:

> *"the dimensions of scientific inquiry are used only to distinguish the
> strategies used in the **eliciting** phase … whereas recognizing and using
> strategies … can be used as a reaction to any type of initial question"*

So **Elicit** splits epistemic ("what is your evidence?", predictions,
interpreting data, evaluating evidence quality) versus conceptual ("define
density", compare concepts); **Recognise** and **Use** do not.

`esru.yaml` now carries both axes: behaviours have an optional `dimension`, set
only under eliciting, and the counts match Table 2 exactly — **11 epistemic, 4
conceptual**. All 35 behaviours come from the **Appendix** ("a complete list of
the strategies used to code teachers' questions and actions") rather than from
the summary table, so the tutor prompt is the paper's own coding scheme.

The Appendix also codes **counter-indicative** strategies, which turned out to be
the most valuable thing in it: evaluative responses (*"Yes! Good!"*), yes/no and
fill-in-the-blank questions, "repaired" questions that leave no room to answer,
and interrupting. These are what separate ESRU from IRE/F **and** they are an
LLM tutor's defaults, so each construct carries an `avoid` list.

**4. The finding that makes Use worth scoring.** Table 4: Rob logged **77 ESR and
1 ESRU** in the epistemic dimension — he elicited and recognised constantly and
almost never closed the cycle. Danielle logged **85 epistemic ESRU** and her
students scored highest. Incomplete cycles are the norm and Use is the step that
carries the learning gain.

**5. IRE/F is the named contrast.** ESRU is defined against
Initiation–Response–Evaluation/Feedback, characterised by *"inauthentic
questions"* whose answer the teacher already knows, producing *"procedural rather
than authentic engagement"* (Nystrand & Gamoran). That is the failure mode a
tutor falls into by default.

## All seven have now been read — 2026-09-10

The note that stood here (*"Only ESRU has been read"*) is discharged. Every
framework in the working set now carries constructs and observable behaviours
drafted from its own source, and `backend/frameworks/*.yaml` has **no
placeholders left**. Each YAML opens with a grounding comment naming which part
of its paper the behaviours came from.

| Framework | Constructs are | Read from |
|---|---|---|
| `esru` | the four moves of the cycle | Appendix coding scheme + Table 2; finding from Table 4 |
| `authentic-dialogue` | Dysthe's dialogic constructs | Dysthe (1996) |
| `cer` | the chapter's **five named instructional strategies** | strategy prose + printed classroom transcripts; scoring from its Appendix B rubric |
| `5e` | the **five phases**, in Bybee's order | Tanner's block quotes of Bybee et al. (2006) + her "Potential 5E Strategy" sections |
| `poe` | **predict / observe / explain** | the POE task items the paper prints verbatim + the instructional-strategy sections |
| `toulmin` | the **six TAP components** | Toulmin's definitions as Erduran et al. quote them; scoring from their Table 1 |
| `accountable-talk` | the **three accountabilities** | the sourcebook's named moves with its own exemplar phrasings |

**Status is `ready_for_review`, not `ready`, on all seven.** Constructs are
drafted and traceable; AR/JB own the sign-off. Nothing here was marked as
signed off by a model.

### Three fit notes that are pedagogical judgements, not code

1. **Accountable Talk assumes a group.** Accountability to the learning
   community is built from moves that presuppose other students in the room
   ("Who can repeat what he said?"). A 1:1 tutor has no community. The YAML
   points those moves at the student's own earlier turns and at real classmates
   in group activities, and refuses to have the tutor invent classmates — but
   **whether that construct is measurable at all in 1:1, or whether the
   framework should only ever be assigned to group activities, is for AR/JB.**
2. **5E is a session arc, not a turn-level cycle.** Its unit is a lesson and its
   whole claim is about ordering, so a tutor holding it tracks where in an arc
   the conversation is. ESRU, by contrast, resolves within a single exchange.
   The catalogue should not treat the two as the same shape.
3. **Wait time does not survive the medium.** In a classroom it is silence; in a
   chat the student answers when they answer. It is carried as tutor restraint
   — do not answer your own question, do not front-load the reasoning — rather
   than as a timing instruction.

### Secondary citations

Several YAMLs record sources they did not read directly — Bybee et al. (2006),
Atkin & Karplus (1962), NRC (1999), White & Gunstone (1992), Toulmin (1958),
Rowe (1986), Resnick & Nelson-Le Gall (1997). Each is marked in its `note` as
read from the primary's citation and reference list and **not held in this
corpus**, following the precedent `esru.yaml` set with Duschl (2003). They are
recorded because they are where a construct actually originates. ⚠️ They carry
`vouchedBy: M` on that basis — if that is too strong a claim for a source read
only at one remove, the convention needs changing in `esru.yaml` too, since it
is the same one.