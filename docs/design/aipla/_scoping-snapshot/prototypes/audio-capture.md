# Design brief: Audio capture (opt-in)

**Status:** Post-Jutland; target for Strand A post-holiday build  
**Source:** 2026-05-25 meeting: *"add the sound of students — audio at first, not video"*  
**Target repo:** `sunholo-data/cphu-aipla-app`  
**Privacy constraint:** Opt-in only; audio never leaves the browser without explicit consent; GDPR/school-context implications require JB to confirm institutional consent approach before implementation

---

## What this adds

Students working in a group talk to each other while using the workbench and tutor. Capturing that audio (with consent) adds a research data stream beyond chat logs: how do groups reason aloud? Do they discuss the tutor's questions before responding? Does the conversation shift when they discover a concept?

Audio is the agreed starting point. Video is deferred — higher privacy burden, lower incremental research value at this stage.

---

## User flow

```
Student group joins with code "bold-kazoo-87"
  │
  ├─ Activity loads as normal
  │
  └─ After ~30 seconds of activity, show opt-in prompt:
      ┌───────────────────────────────────────────────┐
      │  🎤 Help our research?                        │
      │                                               │
      │  We'd like to record your group's discussion  │
      │  during this activity. The recording is used  │
      │  only for educational research — it won't be  │
      │  shared publicly or linked to your name.      │
      │                                               │
      │  [Yes, record our discussion]  [No thanks]    │
      └───────────────────────────────────────────────┘
      
  If Yes:
  ├─ Browser requests microphone permission (standard Web API prompt)
  ├─ If granted: recording starts, mic indicator shown (persistent)
  ├─ Student can stop at any time: [■ Stop recording] button always visible
  └─ On session end: recording uploaded, receipt shown

  If No / permission denied:
  └─ Activity continues normally, no recording, no retry prompt
```

---

## Technical implementation

### Recording

Use the [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder). No external dependencies.

```javascript
async function startAudioCapture(groupId, activityId) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  const chunks = [];

  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = () => uploadAudio(new Blob(chunks, { type: 'audio/webm' }), groupId, activityId);
  
  recorder.start(10000); // collect a chunk every 10s (resume resilience)
  return recorder;
}
```

### Upload

Upload to the AIPLA research data store (Cloud Storage bucket, same zone as BigQuery sink per ADR-005). Do not send to any external speech-to-text service without a separate privacy assessment.

```
gs://aipla-research-audio/{group_id}/{activity_id}/{session_timestamp}.webm
```

Metadata stored alongside:
```json
{
  "group_id": "bold-kazoo-87",
  "activity_id": "boldkast-v1",
  "session_start": "2026-05-25T14:12:00Z",
  "consent_given_at": "2026-05-25T14:12:34Z",
  "duration_seconds": 1320
}
```

### Stop / withdraw

[■ Stop recording] button visible at all times once recording starts. Stopping:
1. Ends the MediaRecorder
2. Uploads the partial recording with a `stopped_early: true` flag
3. Removes the mic indicator

Students can ask for their recording to be deleted — handled offline via the group ID (no name needed, as per ADR-001 anonymisation). Provide a contact route (email JB) on the opt-in screen.

---

## Privacy requirements (must confirm with JB before shipping)

| Question | Current assumption | Needs confirmation |
|---|---|---|
| Consent age | 16+ can self-consent under Danish law; under 16 needs parental consent | JB to confirm school age range and whether parental consent flow is needed |
| Institutional approval | Recording in a school context likely requires school administration sign-off, not just student opt-in | JB to confirm whether UCPH IRB or school principal approval is needed |
| Retention period | Delete raw audio after transcription/analysis? Or retain for N years? | JB / AR to specify in data management plan |
| Access control | Who can listen to raw recordings? | JB to specify — suggest: research team only, named individuals |
| Transcript processing | If transcribing, which service? Must be GDPR-compliant, data-residency EU | Do not use OpenAI Whisper via API without confirming EU data residency |

**Do not ship audio capture until JB has signed off on all five points.**

---

## Text-to-speech (separate, lower-stakes)

From the same meeting: *"text-to-speech may be easy way as an option."*

This is the reverse direction — tutor responses read aloud to students. Significantly simpler privacy posture (no student data captured). Use the browser-native [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) `speechSynthesis`:

```javascript
function speakTutorResponse(text, lang = 'da-DK') {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}
```

No external API call, no data sent anywhere, works offline. Add a [🔊 Read aloud] button next to each tutor message. Language follows the activity config (`da` for Danish activities, `en` for KineBot). Can ship independently of audio capture.

---

## Checklist

**Text-to-speech (no privacy gate):**
- [ ] [🔊 Read aloud] button on each tutor message
- [ ] Uses `window.speechSynthesis` with activity language
- [ ] User can stop mid-utterance (click button again)

**Audio capture (requires JB sign-off first):**
- [ ] JB confirms consent/approval requirements
- [ ] Opt-in prompt UI (shown once, after 30s of activity)
- [ ] MediaRecorder with 10s chunk interval
- [ ] Persistent [■ Stop recording] button
- [ ] Upload to `gs://aipla-research-audio/` on stop/session end
- [ ] Metadata record in Firestore alongside upload
- [ ] Deletion request route documented for students
