import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReadAloudButton } from "@/components/chat/ReadAloudButton";

interface FakeUtterance {
  text: string;
  lang: string;
  rate: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

let speakMock: ReturnType<typeof vi.fn<any[], unknown>>;
let cancelMock: ReturnType<typeof vi.fn>;
let lastUtt: FakeUtterance | null;

beforeEach(() => {
  speakMock = vi.fn<any[], unknown>((u: FakeUtterance) => {
    lastUtt = u;
  });
  cancelMock = vi.fn();
  lastUtt = null;
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: { speak: speakMock, cancel: cancelMock, speaking: false },
  });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    vi.fn(function (this: FakeUtterance, text: string) {
      this.text = text;
      this.lang = "";
      this.rate = 1.0;
      this.onend = null;
      this.onerror = null;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReadAloudButton", () => {
  it("renders nothing when speechSynthesis is unavailable", () => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: undefined,
    });
    const { container } = render(<ReadAloudButton text="Hello" lang="en" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a Read-aloud button when speechSynthesis is available", () => {
    render(<ReadAloudButton text="Hej" lang="da" />);
    expect(screen.getByRole("button", { name: /read aloud/i })).toBeInTheDocument();
  });

  it("clicks → speaks with the configured text + lang", () => {
    render(<ReadAloudButton text="Hej studerende" lang="da" />);
    fireEvent.click(screen.getByRole("button", { name: /read aloud/i }));
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(lastUtt?.text).toBe("Hej studerende");
    expect(lastUtt?.lang).toBe("da");
  });

  it("clicks twice → second click cancels the in-flight utterance", () => {
    render(<ReadAloudButton text="Long passage" lang="en" />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /stop reading aloud/i }),
    ).toBeInTheDocument();
    fireEvent.click(btn);
    expect(cancelMock).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /read aloud/i }),
    ).toBeInTheDocument();
  });

  it("flips back to idle when the utterance ends naturally (onend)", () => {
    render(<ReadAloudButton text="Short" lang="en" />);
    fireEvent.click(screen.getByRole("button"));
    expect(
      screen.getByRole("button", { name: /stop reading aloud/i }),
    ).toBeInTheDocument();
    act(() => {
      lastUtt?.onend?.();
    });
    expect(
      screen.getByRole("button", { name: /read aloud/i }),
    ).toBeInTheDocument();
  });

  it("unmount cancels any in-flight utterance (no audio leak)", () => {
    const { unmount } = render(<ReadAloudButton text="Mid speech" lang="da" />);
    fireEvent.click(screen.getByRole("button"));
    cancelMock.mockClear();
    unmount();
    expect(cancelMock).toHaveBeenCalled();
  });

  it("strips common markdown before speaking (no asterisks read aloud)", () => {
    render(<ReadAloudButton text="**Bold** then `code` and _italic_" lang="en" />);
    fireEvent.click(screen.getByRole("button"));
    expect(lastUtt?.text).toBe("Bold then code and italic");
  });

  it("strips LaTeX delimiters but keeps the equation text", () => {
    render(<ReadAloudButton text="The answer is $v = 15$ m/s here" lang="en" />);
    fireEvent.click(screen.getByRole("button"));
    // "m/s" becomes "meters per second" via the unit substitution pass
    // that runs after LaTeX stripping.
    expect(lastUtt?.text).toBe("The answer is v = 15 meters per second here");
  });

  it("strips block LaTeX entirely (too hard to speak coherently)", () => {
    render(<ReadAloudButton text="Computed: $$\\frac{1}{2}mv^2$$ as energy" lang="en" />);
    fireEvent.click(screen.getByRole("button"));
    expect(lastUtt?.text).toBe("Computed: as energy");
  });

  it("strips emoji so 👇 doesn't read as 'down pointing backhand'", () => {
    render(<ReadAloudButton text="Skriv nedenfor 👇 og fortsæt" lang="da" />);
    fireEvent.click(screen.getByRole("button"));
    expect(lastUtt?.text).not.toContain("👇");
    expect(lastUtt?.text).toContain("Skriv nedenfor");
    expect(lastUtt?.text).toContain("fortsæt");
  });

  it("strips heading and list markers at line starts", () => {
    render(
      <ReadAloudButton
        text={"# Heading\n- first\n- second\n1. step one\n2. step two"}
        lang="en"
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(lastUtt?.text).not.toMatch(/^#|\b\d+\.\s/);
    expect(lastUtt?.text).toContain("Heading");
    expect(lastUtt?.text).toContain("first");
    expect(lastUtt?.text).toContain("step one");
  });

  it("auto-detects Danish text and overrides the lang prop", () => {
    // Caller passed lang="en" but text contains Danish-only chars.
    render(<ReadAloudButton text="Hvad er den næste øvelse?" lang="en" />);
    fireEvent.click(screen.getByRole("button"));
    expect(lastUtt?.lang).toBe("da");
  });

  it("respects lang prop when text has no Danish-only chars", () => {
    render(<ReadAloudButton text="What is the next exercise?" lang="en" />);
    fireEvent.click(screen.getByRole("button"));
    expect(lastUtt?.lang).toBe("en");
  });

  it("substitutes physics units (English): m/s² becomes 'meters per second squared'", () => {
    render(<ReadAloudButton text="The answer is 9.82 m/s² gravity" lang="en" />);
    fireEvent.click(screen.getByRole("button"));
    expect(lastUtt?.text).toContain("9.82 meters per second squared");
    expect(lastUtt?.text).not.toContain("m/s²");
  });

  it("substitutes physics units (Danish): m/s² becomes 'meter per sekund i anden'", () => {
    render(<ReadAloudButton text="Tyngdekraften er 9,82 m/s² på Jorden" lang="da" />);
    fireEvent.click(screen.getByRole("button"));
    expect(lastUtt?.text).toContain("9.82 meter per sekund i anden");
    expect(lastUtt?.text).not.toContain("m/s²");
  });

  it("normalizes decimal commas to periods so TTS doesn't say 'comma'", () => {
    render(<ReadAloudButton text="Værdien er 3,14159 cirka" lang="da" />);
    fireEvent.click(screen.getByRole("button"));
    expect(lastUtt?.text).toContain("3.14159");
    expect(lastUtt?.text).not.toMatch(/3,14/);
  });

  it("substitutes ² and ³ as 'squared' and 'cubed' (English)", () => {
    render(<ReadAloudButton text="Volume is x³ where x² is the side" lang="en" />);
    fireEvent.click(screen.getByRole("button"));
    expect(lastUtt?.text).toContain("cubed");
    expect(lastUtt?.text).toContain("squared");
    expect(lastUtt?.text).not.toMatch(/[²³]/);
  });

  it("substitutes math operators (±, ≈, ×) into spoken English", () => {
    render(<ReadAloudButton text="x = 5 ± 0.1, y ≈ 3 × π" lang="en" />);
    fireEvent.click(screen.getByRole("button"));
    expect(lastUtt?.text).toContain("plus or minus");
    expect(lastUtt?.text).toContain("approximately");
    expect(lastUtt?.text).toContain("times");
    expect(lastUtt?.text).not.toMatch(/[±≈×]/);
  });

  // --- 1.1.11 Cloud TTS path (provider != "browser") ---

  it("Cloud TTS path: POSTs to /api/voice/tts/synthesize and plays audio blob", async () => {
    const audioBytes = new Uint8Array([0xff, 0xfb, 1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(audioBytes, {
        headers: { "content-type": "audio/mpeg" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // Audio() needs to be mockable in jsdom.
    const playMock = vi.fn().mockResolvedValue(undefined);
    const audioCtor = vi.fn().mockImplementation(() => ({
      play: playMock,
      pause: vi.fn(),
      onended: null,
      onerror: null,
    }));
    vi.stubGlobal("Audio", audioCtor);
    // URL.createObjectURL doesn't exist in jsdom.
    const createUrlMock = vi.fn().mockReturnValue("blob:fake");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrlMock });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });

    render(
      <ReadAloudButton
        text="Hej!"
        lang="da"
        provider="gcp_wavenet"
        voice="da-DK-Wavenet-A"
        skillId="led-planck-tutor"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /read aloud/i }));

    // Let the async fetch + play promise chain settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/proxy/api/voice/tts/synthesize");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.text).toBe("Hej!");
    expect(body.lang).toBe("da");
    expect(body.voice).toBe("da-DK-Wavenet-A");
    expect(body.skillId).toBe("led-planck-tutor");
    expect(audioCtor).toHaveBeenCalledWith("blob:fake");
    expect(playMock).toHaveBeenCalled();
  });

  it("Cloud TTS JSON browser-signal: falls through to Web Speech", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"provider":"browser"}', {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ReadAloudButton text="Hej" lang="da" provider="gcp_wavenet" />);
    fireEvent.click(screen.getByRole("button", { name: /read aloud/i }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Fell back to browser Web Speech.
    expect(speakMock).toHaveBeenCalled();
  });

  it("click dispatches voice.cancel so a prior bubble's playback stops", () => {
    const cancelEvents: Event[] = [];
    const listener = (e: Event) => cancelEvents.push(e);
    window.addEventListener("aipla:voice.cancel", listener);
    try {
      render(<ReadAloudButton text="Hej" lang="da" />);
      fireEvent.click(screen.getByRole("button", { name: /read aloud/i }));
      expect(cancelEvents).toHaveLength(1);
      expect(cancelEvents[0].type).toBe("aipla:voice.cancel");
    } finally {
      window.removeEventListener("aipla:voice.cancel", listener);
    }
  });

  it("Cloud TTS fetch failure: degrades to browser Web Speech", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReadAloudButton text="Hej" lang="da" provider="gcp_wavenet" />);
    fireEvent.click(screen.getByRole("button", { name: /read aloud/i }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Graceful degradation kicks in.
    expect(speakMock).toHaveBeenCalled();
  });
});
