# 23 June feedback — repo-side disposition map

**Status:** Triaged — raw capture preserved verbatim below
**Last updated:** 2026-06-28
**Nature:** Mostly **Strand C scoping** (research instrumentation, student models, ethics) with a few execution items. The Strand C material belongs in the scoping site's Strand C eventually; this map records each item's destination so nothing is silently dropped.

> **Why this file exists.** 23 June was a research/scoping-heavy session — the bulk is about *how the research is instrumented* (video/audio capture, qualitative auto-coding, student knowledge models, ethics), which is Strand C, not Strand A execution. A handful of items are execution-relevant. This map sorts them; the verbatim notes follow.

## Disposition map

| 23-June item | Type | Disposition |
|---|---|---|
| Teachers give feedback to a student in real class; share `sunholo.co/aipla` to send over | On roadmap / distribution | Session-report **share-back-to-student** idea (raised 16 June); the URL-sharing is distribution → JB. No new app task. |
| CoLA | Research ref | Strand C scoping; capture for JB/AR (unclear ref). |
| Phone-on-head recording; raw video streams; 2-layer analysis (activity breakdown → learning framework) | **Strand C research instrumentation** | SCOPING — research data-capture method, researcher-only, not v1 execution. → scoping-site Strand C. |
| QDrant RAG; "questions matched with what the student is looking at" | Mixed (mostly shipped) | Context-awareness = workbench **trust-cards SHIPPED**. (QDrant is a raw idea; the actual store is **Vertex AI RAG Engine** — [ADR-017](../_scoping-snapshot/architecture.qmd).) |
| YAML — config-as-code for generating the evidence | Research / eval | Strand C + eval-config idea. → scoping. |
| Teachers sliders to adjust difficulty across large groups | **New build idea** | **BACKLOG** — live per-group difficulty tuning (added to roadmap 2026-06-28). Distinct from the dead per-activity knob removed in the 15-June UX pass, and from the working per-activity difficulty in the builder. |
| Researchers: AI creating "codes" / semantic categorisations of activity ("engaged", "social interaction") | **Strand C research** | SCOPING — qualitative-coding automation. Researcher analytics ships; auto-coding does not. → scoping-site Strand C. |
| Video surveillance ethics; researcher-only; realtime vs batch; CPH video processing | **Strand C research + ethics** | SCOPING — research posture / ethics; researcher-only capture. → scoping-site Strand C + private `notes/`. |
| Video 1st vs 3rd person; audio localisation for student ID; body language; gestures; timestamps; individual vs group | **Strand C research** | SCOPING — video-analysis methodology. → scoping-site Strand C. |
| Off-task detection via audio/video; dedicated physics classes/rooms; Meeting Owl; raw video dataset; "multimodal group-study analysis is hard" | **Strand C research + hardware/IT** | SCOPING + an IT-resource ask (rooms, Meeting Owl, GPU). Pairs with the 17-June RUBUS/IT-resource action. |
| The AI reads all student groups at once to coordinate groups / teacher; match students | On roadmap (R1-gated) | Live teacher dashboard — [teacher-analytics-framework.md](teacher-analytics-framework.md) (1.1.31), R1-gated. |
| Standard map of knowledge; AI generates the learning map from a conversation; AI generates a model | **Strand C — C3 student models** | SCOPING — the core C3 student-model item (reference model + extraction). → scoping-site `strands.qmd` C3. |
| "upload a PNG broken" | Status / bug check | **No open bug in shipped surfaces** — general student image upload accepts PNG (`ImageComposer` `image/png`, verified 2026-06-28). In context this sits beside "AI generate the learning map" → it's the **unbuilt C3 concept-map upload**, not the shipped chat upload. |

## Net effect

- **+1 execution backlog item** — live per-group difficulty tuning (unspecced).
- **0 new Strand A build** that wasn't already on the roadmap (share-back, live dashboard, trust-cards all already tracked/shipped).
- **A large Strand C scoping cluster** (research instrumentation, qualitative auto-coding, student knowledge models, ethics) that belongs in the **scoping site's Strand C** — flagged here, not yet folded in. The biggest "to-process" chunk.
- **No open bug** — PNG upload verified working.

---

## Raw capture (verbatim, 23 June 2026)

Teachers use in real class give feedback to student

Odsils

www.sunholo.co/aipla to send over


CoLA

phone on head recorded

video streams - raw
1st layer - activyt, breakdown etc.
2nd layer - put into learning framework

QDrant RAG
questions to bot ma
tched with waht the student is looking at

yaml - programming for generating the evidence configures

teachers sliders to adjust difficulty across large gorups

---

researchers


AI creating labels "codes"
senatic cateogirsations of activity "engaged", "social interaction", 
video survaliience of prison courtyards 
ethical 
video capture
all above should be researcher only
teacher/student - audio/text only? needs to be more realtime
but researchers just can deal with it batch
video processing availabel in CPHoUni

video 1st person vs 3rd part (e.g. one camera in the room )
issue with localise audio for student identification
different data, line of sight, body language etc.
timestamps can help
video analysis of addressing individual vs the group
hand gestures?

audio/video for seeing when tudens go off task
dedicated physcis classes

meeting owl for gathering data?

dedicated rooms
video raw data set 
multimodal analysis of educaton group studies is hard

---


the AI reads all of the student groups at a time, so an AI can coordinate the groups or teacher
match students 

standard map of knowledge

- upload a PNG broken
AI to egenrate the learning map of what the student shoudl have learnt at the end of a conversation?
AI to generate model
