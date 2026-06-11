import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the browser audio lib + the authed fetch.
const startMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue({
  blob: new Blob(["a"], { type: "audio/webm" }),
  mimeType: "audio/webm",
  durationMs: 1200,
});

vi.mock("@/lib/audioCapture", () => ({
  isAudioCaptureSupported: () => true,
  AudioRecorder: class {
    start = startMock;
    stop = stopMock;
    cancel = vi.fn();
    get recording() {
      return false;
    }
  },
}));

const fetchMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({ fetchWithAuth: (...a: unknown[]) => fetchMock(...a) }));

import { VoiceComposerControls } from "../VoiceComposerControls";

afterEach(() => {
  vi.clearAllMocks();
});

const base = {
  skillId: "s1",
  lang: "da",
  onTranscript: vi.fn(),
  onNotice: vi.fn(),
};

describe("VoiceComposerControls", () => {
  it("renders nothing when neither capability is enabled", () => {
    const { container } = render(
      <VoiceComposerControls {...base} voiceInputEnabled={false} recordingEnabled={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the mic when voice input is enabled", () => {
    render(<VoiceComposerControls {...base} voiceInputEnabled recordingEnabled={false} />);
    expect(screen.getByLabelText("Talk to type")).toBeInTheDocument();
    expect(screen.queryByLabelText("Record this class")).not.toBeInTheDocument();
  });

  it("dictation: start -> stop -> transcribe -> onTranscript", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: "hej verden" }) });
    const onTranscript = vi.fn();
    render(
      <VoiceComposerControls {...base} onTranscript={onTranscript} voiceInputEnabled recordingEnabled={false} />,
    );

    fireEvent.click(screen.getByLabelText("Talk to type"));
    await waitFor(() => expect(startMock).toHaveBeenCalled());

    fireEvent.click(await screen.findByLabelText("Stop dictation"));
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("hej verden"));

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/voice/stt/transcribe");
    expect((opts as { method: string }).method).toBe("POST");
  });

  it("record-lesson: start shows the banner, stop posts to /recording", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<VoiceComposerControls {...base} voiceInputEnabled={false} recordingEnabled />);

    fireEvent.click(screen.getByLabelText("Record this class"));
    expect(await screen.findByText(/Recording this class/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Stop"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toContain("/api/voice/recording");
  });
});
