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
});
