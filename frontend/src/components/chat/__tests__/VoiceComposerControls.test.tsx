import { fireEvent, render as rtlRender, screen, waitFor, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { LocaleProvider } from "@/i18n";
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
    getLevel = () => 0;
    get recording() {
      return false;
    }
  },
}));

const fetchMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({ fetchWithAuth: (...a: unknown[]) => fetchMock(...a) }));

import { VoiceComposerControls } from "../VoiceComposerControls";
import type { SegmentedRecorder } from "@/lib/audioCapture";

// 1.1.108: these assertions are about behaviour, written against the English
// labels — render under an English activity. The Danish default is covered by
// the component's own `da` assertions / i18n tests.
const EnglishActivity = ({ children }: { children: ReactNode }) => (
  <LocaleProvider locale="en">{children}</LocaleProvider>
);
const render = (ui: ReactElement, options?: RenderOptions) =>
  rtlRender(ui, { wrapper: EnglishActivity, ...options });


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
  it("renders nothing when voice input is disabled", () => {
    const { container } = render(<VoiceComposerControls {...base} voiceInputEnabled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the mic when voice input is enabled (and never a record button)", () => {
    render(<VoiceComposerControls {...base} voiceInputEnabled />);
    expect(screen.getByLabelText("Talk to type")).toBeInTheDocument();
    // "Record this class" now lives in LessonRecordingPanel, not here.
    expect(screen.queryByLabelText("Record this class")).not.toBeInTheDocument();
  });

  it("dictation: start -> stop -> transcribe -> onTranscript", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: "hej verden" }) });
    const onTranscript = vi.fn();
    render(<VoiceComposerControls {...base} onTranscript={onTranscript} voiceInputEnabled />);

    fireEvent.click(screen.getByLabelText("Talk to type"));
    await waitFor(() => expect(startMock).toHaveBeenCalled());

    fireEvent.click(await screen.findByLabelText("Stop dictation"));
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("hej verden"));

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/voice/stt/transcribe");
    expect((opts as { method: string }).method).toBe("POST");
  });

  it("while a lesson records, dictation taps the recording instead of opening a second mic", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: "hvad sker der" }) });
    const tapStop = vi.fn().mockResolvedValue({
      blob: new Blob(["b"], { type: "audio/wav" }),
      mimeType: "audio/wav",
      durationMs: 900,
    });
    const tap = vi.fn(() => ({ getLevel: () => 0, stop: tapStop, cancel: vi.fn() }));
    const lessonRecorder = { recording: true, tap } as unknown as SegmentedRecorder;
    const onTranscript = vi.fn();
    const onOwnMicChange = vi.fn();
    render(
      <VoiceComposerControls
        {...base}
        onTranscript={onTranscript}
        voiceInputEnabled
        lessonRecorder={lessonRecorder}
        onOwnMicChange={onOwnMicChange}
      />,
    );

    // Not disabled any more while recording (the 2026-11-23 complaint).
    expect(screen.getByLabelText("Talk to type")).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText("Talk to type"));
    fireEvent.click(await screen.findByLabelText("Stop dictation"));
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("hvad sker der"));

    expect(tap).toHaveBeenCalledTimes(1);
    expect(tapStop).toHaveBeenCalledTimes(1);
    expect(startMock).not.toHaveBeenCalled(); // no own getUserMedia
    expect(onOwnMicChange).not.toHaveBeenCalled();
  });

  it("without a recording, dictation uses its own mic and reports it", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: "x" }) });
    const onOwnMicChange = vi.fn();
    render(<VoiceComposerControls {...base} voiceInputEnabled onOwnMicChange={onOwnMicChange} />);
    fireEvent.click(screen.getByLabelText("Talk to type"));
    await waitFor(() => expect(onOwnMicChange).toHaveBeenCalledWith(true));
    fireEvent.click(await screen.findByLabelText("Stop dictation"));
    await waitFor(() => expect(onOwnMicChange).toHaveBeenLastCalledWith(false));
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});
