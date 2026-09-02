# 09-01 Weekly Meeting: AI Education Platform, Data Compliance, and Teacher Feedback
> Date: 2026-09-01 13:06:53
> Location: [Insert Location]
> Participants: [Jesper] [Mark] [Aswin] [Speaker 4]
## Meeting Notes
### **Platform Purpose, Positioning, and Documentation**
- The platform is positioned as a teacher-authored and source-grounded tool to address educators' concerns about GenAI, including shallow help, data protection, and lack of teacher control. The design centers on teacher authorship, transparency, and visible student assessment.
- There is a need for a clear system overview document explaining how all components fit together, and [Mark] will add this content. Example flows for student and teacher views are being drafted.
### **IT, Infrastructure, and Data Management**
- **Platform Access:** A speaker gained access to Teams after an IT fix. Another speaker noted a similar past issue. The email login is currently not working as the login mail is banned; IT needs to add DNS records to make it a trusted source, a request [Mark] may initiate.
- **Data Compliance and Google Integration:** The system uses Google Firebase, raising legal and compliance concerns, though no actual data leakage is occurring. A data management agreement with Google is required for classroom use. [Jesper] has contacted the legal department and needs to follow up, aiming to have it in place by November-December. The team is considering removing the convenient but problematic Gmail login option.
- **Exam Data (Prøvebanken):** Legal approval to use scraped exam data from Prøvebanken is pending with the Ministry of Education. The concern is that AI could learn exam patterns. The team possesses data on AI model performance against these exams but has decided not to publish these results until approval is granted. [Jesper] will follow up.
- **Infrastructure:**
    - A new AI initiative was discussed, but its relevance is unclear.
    - The capabilities of the "Erda" platform are uncertain; [Mark] will follow up with Morten to clarify.
    - A new **Herd app** allows background jobs (e.g., AI tasks) to run without requiring an active laptop.
    - The system currently uses the "dumbest, cheapest, and fastest" model, highlighting the trade-off between cost, speed, and capability.
### **Teacher Feedback and Platform Features**
- **General Feedback:** "Really good" teacher feedback was received via a spreadsheet. [Mark] has been implementing suggestions like labels on graphs and multiple tables. The "feedback on Apple platform" channel was designated for updates, and [Jesper] will email teachers to thank them.
- **Feature Requests:**
    - To allow a student to work individually, a unique group ID can be created.
    - A key request is the ability for teachers and students to write code directly in the system.
    - Teachers find the UI difficult, which could be considered a bug. Usage analytics are needed to identify friction points.
- **Researcher Access:** Researchers currently cannot view student activity within teacher-created classes. [Mark] confirmed the data exists and agreed to add a feature to expose it for research purposes.
### **Content, Activities, and Conceptual Framework**
- **Standardizing Prompts:** The team discussed standardizing teaching prompts. The app has character limits for speed, so the proposed solution is to use concise in-app prompts that explicitly instruct the AI to consult longer external documents for detailed content.
- **Example Activities:** To help teachers, the team will create more example activities. [Jesper] and Eswin will construct examples (e.g., for a C-level "energy conservation" activity) and possibly create a video guide. An activity matrix was proposed, organized by "Subject Content" and "Activity Type."
- **Conceptual Framework:**
    - The team plans to develop the system's underlying conceptual framework, with **Embodied Cognition** as the umbrella theory.
    - **Self-Determination Theory (SDT)** will be incorporated to inform student motivation and well-being.
    - The framework will be grounded in research literature relevant to the curriculum (e.g., physics C-level energy concepts). [Aswin] will find and share relevant literature.
- **Bounding AI Dialogue:** To prevent the AI from drifting off-topic, the team will use concept/question maps tied to specific learning goals at the activity level. This structure will guide the AI dialogue toward desired outcomes while allowing for limited deviation.
### **AI Tutor Personas and Evaluation**
- **Persona Development:** The team will develop research-based "Tutor Personas" that operate as a layer on top of activities. Proposed personas include those based on Self-Determination Theory (SDT), Dyste (authentic questions), ESRU, IBSE, and a "Bob Evans" persona. [Jesper] will provide papers on these theories. A workflow is needed for researchers to add and manage these personas.
- **Persona-Activity Matching:** It was noted that some personas might be better suited for certain activities. The team discussed including suggested activities when creating a tutor and benchmarking performance, which could be a key project outcome. A gatekeeper may be needed to prevent clashes between an activity's style (e.g., Socratic) and a tutor's persona.
- **Evaluation and Rubrics:** A benchmark for rating session quality is needed. The "LLM as a judge" problem (models rating highly) was noted, emphasizing the need for a tight, well-defined rubric for reliable evaluation. **Eugenia Etkina's Scientific Abilities Framework** was introduced as a potential source for creating such rubrics.
### **Pilot Testing and Future Development**
- **Target Audience:** The immediate focus for activities is Physics C-level, as most teachers will begin teaching this in November. Physics A-level is a secondary possibility.
- **Recruitment:** [Jesper] will connect the team with Julia, a student at Niels Bohr Institute (NBI), to explore involving NBI students. Other recruitment options include university physics first-years and leveraging a December 2026 physics star lecture.
- **Timeline:** Small-scale pilots are desired in 2026, with broader trials in 2027, pending the Google data management agreement.
- **India Context & Spin-off:** The current platform is unsuitable for India, where students cannot use phones in class. The team discussed branching into a simpler, product-focused variant and potentially forming a company, with a follow-up meeting planned.
- **Future Features:** A potential feature is displaying a session's resource consumption (e.g., in kWh) to improve AI literacy.
### **Administrative and Scheduling**
- [Jesper] is applying for funding for a teacher planning tool.
- [Mark] is seeking to change offices due to back issues.
- Copper meetings are every second Wednesday at 13:00.
- The next team meeting is tentatively scheduled for Wednesday after 12:00.
## Next Arrangements
- [ ] **Compliance & Legal:**
    - [ ] Jesper to follow up with the legal department regarding the data management agreement with Google.
    - [ ] Jesper to follow up with the Ministry of Education contact regarding legal approval for Prøvebanken exam data access.
    - [ ] Do **not** publish AI model exam performance results until legal approval is granted.
- [ ] **Technical & Development:**
    - [ ] Mark to potentially contact IT to resolve the email login issue by getting the DNS trusted.
    - [ ] Mark to follow up with Morten about the capabilities of the Erda platform.
    - [ ] Mark to add researcher-level visibility into student session data within teacher-created classes.
    - [ ] Mark to work on creating a workflow for researchers to add and configure new tutor personas.
    - [ ] Investigate supporting very long teaching prompts and automated summarization.
    - [ ] Incorporate UI/UX telemetry to observe usage patterns and identify pain points.
- [ ] **Planning & Documentation:**
    - [ ] Mark to create a plan for the next few months prioritizing compliance and development tasks.
    - [ ] Define a standardized prompt structure and guidelines for teaching prompts.
    - [ ] Develop concept/question maps tied to specific learning goals.
    - [ ] Mark to add a clear system overview section to the documentation.
    - [ ] Document differences from existing tools and hosting requirements; link GitHub repository.
    - [ ] Mark to share system architecture diagrams and data with Aswin for a research paper.
- [ ] **Content & Framework:**
    - [ ] Jesper and Eswin will create example activities and a potential video guide.
    - [ ] Jesper will start working on the underlying conceptual framework for the system.
    - [ ] Jesper will provide information (papers, text, images) on research-based tutor personas (SDT, Dyste, etc.).
    - [ ] Gather and share literature for physics C activities (e.g., energy concepts).
    - [ ] Team to develop a session quality rubric (potentially using Etkina's framework and a paper from Aswin).
    - [ ] Aswin to share the paper with two rubrics with the team.
- [ ] **Pilots & Collaboration:**
    - [ ] Jesper will email teachers to thank them and share updates on feedback.
    - [ ] Contact Julia regarding recruiting students for early trials ([Jesper]).
    - [ ] Explore recruiting physics first-year students and leveraging the physics star lecture ([Jesper]).
    - [ ] Plan meeting with DK to discuss a simpler one-on-one tutor product for India.
- [ ] **Scheduling & Admin:**
    - [ ] Schedule the next team meeting on 2026-09-09 after 12:00.
    - [ ] Book room for the Kubonic meeting on 2026-09-02.
    - [ ] Jesper to provide Mark with the transcript and Copper meeting schedule.
    - [ ] Explore office seating change for Mark.
## AI Suggestions
> **AI Suggestions**
> AI has identified the following issues that were not concluded in the meeting or lack clear action items; please pay attention:
> 1. **Data Governance as a Blocker:** The data management agreement with Google and legal approval for Prøvebanken data are unresolved and blocking pilots and research. Escalation paths and deadlines should be established to avoid indefinite delays.
> 2. **Undefined Evaluation Strategy:** The team agrees a benchmark for rating sessions is critical, but no specific rubric has been selected or assigned for development. This risks the project proceeding without a validated, repeatable evaluation method.
> 3. **Lack of Concrete Implementation Plans:**
>    - The integration of **SDT into the conceptual framework** lacks a formal plan.
>    - The **relevance of the university's AI initiative** to the project remains unknown.
>    - A mechanism to **prevent conflicts between tutor personas and activity styles** was discussed but not designed.
>    - **Researcher data access** was agreed upon but lacks a delivery timeline.
> 4. **Unclear User-Facing Communication:**
>    - The platform's UI is considered difficult for teachers, but no action was assigned to investigate or redesign it.
>    - It is not clear how to communicate the AI's capability to generate C-level physics examples to teachers.
> 5. **Ambiguous Technical and Project Scope:**
>    - A decision on whether to **remove the Gmail login option** has not been made.
>    - The plan for a potential **product spin-off for India** is conceptual and requires a defined scope, requirements, and business strategy.
>    - No specific plan was made to manage the **handover of coding work** mentioned in one session.