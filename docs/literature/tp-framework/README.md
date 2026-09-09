# TP Framework — primary literature

Reference material for the discipline-layer workstream (teaching-practice
cycle methods). Downloaded 2026-09 from the shared "TP Framework" Google
Drive folder:
https://drive.google.com/drive/folders/1s-dALtgQtGTOMzP6Hl4pvbNbIlwcDTF3

Folder names mirror the Drive source (including its typos — "Dialouge",
"Clam") so files stay 1:1 traceable with the Drive.

| Folder | Framework | File |
|---|---|---|
| `5E Model/` | 5E learning cycle | Tanner 2017, *Order Matters* (J Coll Sci Teach) |
| `Accountable Talk/` | Accountable Talk | Institute for Learning AT Sourcebook |
| `Authentic Dialouge/` | Authentic Dialogue | Dysthe 1996, *The Multivoiced Classroom* |
| `Clam Evidence Reasoning (CER)/` | Claim–Evidence–Reasoning | *Inquiry and Scientific Explanation* chapter |
| `ESRU/` | ESRU (Elicit–Student response–**Recognise**–Use) | Ruiz-Primo & Furtak, **JRST 44(1) 57–84 (2007)** ([see below](#esru--read-from-the-pdf-2026-09-09)) |
| `Predict Observe Explain/` | POE (≈ ECR) | ERIC ED420715 |
| `Toulmin's Argument/` | Toulmin Argumentation Model | Erduran, Simon & Osborne 2004, *TAPping into argumentation* (Science Education) |

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

⚠️ **Only ESRU has been read.** The other six PDFs are present and parsed but
their citations remain as transcribed from the Drive folder names.