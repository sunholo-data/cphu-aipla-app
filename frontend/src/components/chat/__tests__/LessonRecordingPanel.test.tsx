import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMyTranscript = vi.fn();
vi.mock("@/lib/transcriptApi", () => ({
  fetchMyTranscript: () => fetchMyTranscript(),
}));

const fetchMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({ fetchWithAuth: (...a: unknown[]) => fetchMock(...a) }));

// SegmentedRecorder stub: stop() flushes one segment via onSegment (triggers upload).
vi.mock("@/lib/audioCapture", () => ({
  isAudioCaptureSupported: () => true,
  SegmentedRecorder: class {
    onSegment: (r: unknown, seq: number) => void;
    constructor(onSegment: (r: unknown, seq: number) => void) {
      this.onSegment = onSegment;
    }
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn(async () => {
      this.onSegment(
        { blob: new Blob(["a"], { type: "audio/webm" }), mimeType: "audio/webm", durationMs: 1000 },
        0,
      );
    });
    cancel = vi.fn();
  },
}));

import { LessonRecordingPanel } from "../LessonRecordingPanel";

afterEach(() => vi.clearAllMocks());

const base = { lang: "da" as const };

describe("LessonRecordingPanel", () => {
  it("shows the record control and stays collapsed when there is no transcript", async () => {
    fetchMyTranscript.mockResolvedValue({ groupId: "g1", segments: [], text: "" });
    render(<LessonRecordingPanel {...base} />);
    await waitFor(() => expect(fetchMyTranscript).toHaveBeenCalled());
    expect(screen.getByLabelText("Record this class")).toBeInTheDocument();
    // No transcript -> body collapsed (the empty-state hint is not shown).
    expect(screen.queryByText(/No transcript yet/i)).not.toBeInTheDocument();
  });

  it("auto-expands the transcript body once there is text to read", async () => {
    fetchMyTranscript.mockResolvedValue({
      groupId: "g1",
      segments: [{ seq: 0, text: "hej", createdAt: "" }],
      text: "hej fra gruppen",
    });
    render(<LessonRecordingPanel {...base} />);
    await waitFor(() => expect(screen.getByText("hej fra gruppen")).toBeInTheDocument());
  });

  it("record -> stop posts the segment to /recording and reports recording state", async () => {
    fetchMyTranscript.mockResolvedValue({ groupId: "g1", segments: [], text: "" });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const onRecordingChange = vi.fn();
    render(<LessonRecordingPanel {...base} onRecordingChange={onRecordingChange} />);

    fireEvent.click(screen.getByLabelText("Record this class"));
    expect(await screen.findByText(/Recording this class…/i)).toBeInTheDocument();
    await waitFor(() => expect(onRecordingChange).toHaveBeenCalledWith(true));

    fireEvent.click(screen.getByText("Stop recording"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toContain("/api/voice/recording");
    await waitFor(() => expect(onRecordingChange).toHaveBeenCalledWith(false));
  });

  it("hides the transcript while recording even when text exists, and reveals it on stop", async () => {
    fetchMyTranscript.mockResolvedValue({
      groupId: "g1",
      segments: [{ seq: 0, text: "hej", createdAt: "" }],
      text: "hej fra gruppen",
    });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<LessonRecordingPanel {...base} />);
    // Pre-existing transcript auto-expands on load.
    await waitFor(() => expect(screen.getByText("hej fra gruppen")).toBeInTheDocument());

    // Starting a recording collapses it — the live capture is the focus.
    fireEvent.click(screen.getByLabelText("Record this class"));
    await waitFor(() => expect(screen.queryByText("hej fra gruppen")).not.toBeInTheDocument());

    // Stopping reveals it again for review.
    fireEvent.click(screen.getByText("Stop recording"));
    await waitFor(() => expect(screen.getByText("hej fra gruppen")).toBeInTheDocument());
  });

  it("lets the student manually collapse an auto-expanded transcript", async () => {
    fetchMyTranscript.mockResolvedValue({
      groupId: "g1",
      segments: [{ seq: 0, text: "hej", createdAt: "" }],
      text: "hej fra gruppen",
    });
    render(<LessonRecordingPanel {...base} />);
    await waitFor(() => expect(screen.getByText("hej fra gruppen")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Lesson transcript"));
    expect(screen.queryByText("hej fra gruppen")).not.toBeInTheDocument();
  });
});
