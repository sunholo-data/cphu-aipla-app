# 09-29 Meeting: AI Tutoring Platform – Simulation, UI, Model Testing & Research Planning
> Date: 2026-09-29 14:58:08
> Location: IND and the interwebs
> Participants: [Aswin] [Jesper] [Mark]
>
> Converted from the meeting tool's `.docx` export with `docparse` (local, deterministic) on
> 2026-09-30. The original `.docx` is in git history (`f9f364b6`). Transcribed names vary for one
> tutor persona ("Miguel", "Michael"); it is **Mikkel**. "Atawa" is **Atharva (AD)**. The
> reconciled triage of this meeting is in [notes-2026-09-29.md](notes-2026-09-29.md).

## Meeting Notes

### **Schedule and Attendance for Upcoming Weeks**
- [Jesper] is leaving for Scotland midweek, has Monday off, and will not meet next week.
- A meeting with Daniel's class is tentatively scheduled for Monday 11:13–12:00 to explain the platform.
- A possible 8:00 session on Monday with Lisbet from AMSC (AI in Math and Science Classrooms) was discussed; [Jesper] will email her.
- [Mark] can attend the 8:00 session.
- Conclusion: [Jesper] will contact Lisbet. The general meeting next week is unlikely.

### **Thursday Teams Meeting with Klaus (Brighton)**
- [Jesper] has a Teams call on Thursday at 13:00 with Klaus from Brighton about audio.
- [Mark] can join and prefers to attend in person.
- Conclusion: Proceed with the Thursday 13:00 meeting.

### **Data Protection and Google/Firebase Agreements**
- [Jesper] is waiting for a response from the Legal/Data Protection Officer on using the existing Firebase agreement as an interim Data Processing Agreement (DPA).
- [Mark] noted that many organizations have DPAs with Google, and applicability depends on policy.
- Conclusion: Awaiting feedback from Legal/DPO.

### **Classroom Simulation Trial (Sun–Earth–Moon)**
- [Jesper] ran the simulation with teachers, and the concept was well understood.
- A "stop" condition was implemented: the bot stops asking questions if students reach the top tier.
- The tutor can identify misconceptions and direct learners to appropriate missions.
- UI feedback indicated the interface felt cramped, especially on smaller screens. Laptops or projectors are recommended.
- A request was made for the tutor (Miguel persona) to automatically acknowledge mission completion.
- Conclusion: The simulation is effective, but the UI needs refinement and automated tutor feedback should be added.

### **Simulation Tool Functionality and AI Tutor Interaction**
- The team reviewed the astronomy simulation's features. A UI issue was noted where menus obstruct the view and cannot be minimized.
- [Mark] proposed enabling the AI tutor to actively manipulate the simulation for the student.
- Conclusion: Development will focus on adding the AI manipulation feature before optimizing for speed and cost.

### **Authoring Workflow and Prompt Usage**
- [Jesper] authored the simulation from scratch using Claude.
- [Mark] highlighted that using the provided "prompt text.txt" speeds up integration and adds features like automatic tutor feedback. A teacher (Eida) had smoother results using it.
- Conclusion: The standard authoring prompt should be used for future builds to improve integration.

### **Model Choice and Performance (Cloud vs Local/Open Source)**
- The current system uses a baseline version of Google Flash. The team is considering testing locally installed models (e.g., Llama) to compare quality and latency.
- [Mark] expects similar quality but slower responses locally, with token speed being the main risk.
- Open-source models have multimodal capabilities, and summer benchmarking suggests parity with the current light model.
- Conclusion: The team plans to test local models, focusing on speed as the key factor.

### **Impact on Recording/Transcription Features**
- There was a concern that switching models could slow voice recording and real-time analysis.
- [Mark] indicated audio recording storage is separate, and better models might improve transcription accuracy.
- Real-time analysis capability with open-source models needs verification.
- Conclusion: Recording/transcription is unlikely to be negatively affected. The impact on real-time analysis speed requires investigation.

### **Automated Concept Maps for AI Guidance**
- [Mark] introduced a "Concept Map" feature to keep the AI tutor focused. The system can auto-generate a map from class materials.
- Concept maps can be applied hierarchically, allowing activities to tick off concepts over time.
- Conclusion: The tool is functional but needs practical testing by teachers.

### **Integration of Tutor and Activities**
- Tightly coupling the tutor with activities (like the solar system app) makes it harder for students to use external tools like ChatGPT and is more effective.
- Conclusion: The most effective AI activities are those with tight integration between the tutor and the activity itself.

### **Platform Feedback and Language Issues**
- The tutor sometimes displays simulation variables as LaTeX and occasionally switches to Danish.
- Teacher feedback noted the Danish translation was "a bit weird," and different decimal conventions were an issue.
- Conclusion: A fix is in progress to externalize text into language-specific files, which should resolve the language-switching and translation issues.

### **AI Model Performance and Tutor Behavior**
- The current Flash model struggles with some harder tasks. However, it was noted that tutor mistakes can be a learning opportunity for students.
- The tutor persona "Michael" was found to be too "sycophantic," which is a prompting issue.
- The tutor successfully resists giving direct answers. In one case, a student became frustrated when the tutor wouldn't confirm their answer.
- It was observed that different tutor personas sometimes gave the same answers.

### **Tutor Persona and Activity Prompt Interference**
- There is a risk of conflict if an activity prompt and tutor persona have contradictory instructions.
- It was suggested that the import process could strip personality traits from activities to avoid conflicts.

### **Ideas for Kinesthetic Exercises and Tutor Interaction**
- The group discussed revisiting a kinesthetic exercise. Ideas included the tutor providing visual hints (images, animations) or controlling the simulation to reveal content based on student progress.

### **Aggregated Reporting and Teacher Insights**
- [Jesper] requested an aggregated view of concepts discussed across the class.
- [Mark] explained that data from the new concept maps will populate such a dashboard.
- Conclusion: The data structure exists, but the UI needs reorganization to make reports easier to find.

### **Enhancing Student Evaluations with Multimedia**
- [Aswin] emphasized that student evaluations should include the actual figures and data they create, contextually linked to the chat dialogues where they were used.
- Conclusion: [Mark] is working on integrating context-linked multimedia into evaluation logs.

### **Platform Constraints and New Administrative Features**
- The team will continue using Microsoft Teams to accommodate teachers.
- Recent updates allow teachers to delete group IDs and create customized AI tutors. The team agreed it is safe for teachers to upload custom avatar pictures.

### **Evaluating AI-Generated Tutor Personas**
- The current AI-generated tutor personas require professional evaluation to confirm they correctly implement pedagogical frameworks.

### **Planning for the Research Group Meeting on September 30, 2026**
- A demo is scheduled to showcase different tutor personas using a simple "wave simulation" activity.
- [Mark] will not be available but will ensure platform stability.
- [Jesper] will contact Daniel for details on duration and participants.

### **Onboarding and Schedule for Atawa**
- Atawa is expected to arrive on October 1 and will join the course as a participant from October 5-9 to get acquainted with the project before moving to an observer role.

### **Planning for a Future AI Conference**
- The group received approval for a conference titled "AI in Quantitative Research."
- The format will shift to interactive workshops, and framing it as a "masterclass" could secure funding.

## Next Arrangements
- [Jesper] to email Lisbet (AMSC) about the Monday 8:00 session.
- Confirm attendance and logistics for the Monday 8:00 session with Lisbet.
- Hold the Thursday 13:00 Teams meeting with Klaus (Brighton); [Mark] to attend in person.
- [Jesper] to follow up with Legal/DPO on the interim Firebase data processing agreement.
- [Jesper] and [Aswin] to prepare a "wave simulation" activity with different tutor personas for the demo on September 30.
- [Jesper] to contact Daniel for more details about the research group meeting.
- [Mark] to avoid pushing platform updates before the demo on September 30.
- [Jesper] to contact Atawa to propose his participation in the course from October 5-9.
- [Jesper] to share feedback on the AI conference proposal with the team.
- [Jesper] to call a separate meeting to discuss the new grant for a teacher education platform.
- [Jesper] to test the AI-assisted concept map feature and create introductory guides for the simulation tool.
- [Mark] to reorganize the class reporting UI to make aggregated concepts easier to find.
- [Mark] to complete the integration of context-linked figures into student chat evaluations.
- [Mark] to post complete release notes in the Microsoft Teams channel.
- [Mark] to continue work on the translation solution to separate text from app code.
- [Jesper] to develop a structured idea or simulation for a new kinesthetic exercise.
- Benchmark locally hosted/open-source models (e.g., Llama) for chat latency and real-time analysis viability.
- Verify the impact of model changes on real-time audio-driven tutor feedback.
- Add an event to simulations for tutor acknowledgement upon question-set completion.
- Review and adjust the UI for simulations (screen-size guidance, reduce cramped layouts).
- Use the standardized authoring prompt ("prompt text.txt") for future simulation builds.

## AI Suggestions
Issues the meeting tool flagged as not concluded or lacking a clear action item:
1. The schedule for Monday sessions (Daniel's class and Lisbet's) is tentative, and attendance is unclear.
2. Legal approval for the interim Firebase DPA is pending; a fallback plan is needed if it is not approved.
3. A clear test plan for evaluating local models (metrics, scenarios, success thresholds) is needed.
4. Specific UI improvements were noted but not scoped or assigned.
5. The tutor feedback trigger on mission completion lacks a technical specification.
6. A UI issue where menus obstruct the simulation view was identified, but no action was assigned.
7. The deployment process for UI tweaks is a bottleneck, but a systemic solution was deferred.
8. A technical implementation for custom teacher avatars (open uploads vs. pre-approved list) was not finalized.
9. A strategy for routing tasks to more advanced AI models when the primary model fails is undefined.
10. The issue of different tutor personas giving identical answers needs investigation.
11. The balance between Socratic guidance and providing necessary validation to avoid student frustration remains an open point.
12. A definitive technical solution for resolving conflicts between lesson descriptions and tutor personas was not established.
13. Exact logistics (duration, participant count) for the September 30 demo are still unknown.
