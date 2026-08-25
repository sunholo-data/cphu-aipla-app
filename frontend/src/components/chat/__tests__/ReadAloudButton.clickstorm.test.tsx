/**
 * Voice-button hammering — M's 17 Aug notes: "hammering the voice button needs
 * to debounce".
 *
 * `isSpeaking` cannot be the guard on the Cloud TTS path. It is only set true
 * AFTER `await fetchWithAuth("/api/proxy/api/voice/tts/synthesize")` resolves,
 * so every click landing in that window reads it as false and starts another
 * synthesis. Cloud TTS is billed per call and metered into `aipla_voice_cost`,
 * so a student drumming the button spends real money and then hears the same
 * line played over itself several times.
 *
 * Lives in its own file because the module-level `vi.mock` below is hoisted to
 * the top of whichever file it is in. Appending it to ReadAloudButton.test.tsx
 * silently broke that file's own Cloud-TTS test, which mocks at a different
 * layer — a mock's blast radius is the file, not the describe block.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReadAloudButton } from "@/components/chat/ReadAloudButton";
import { fetchWithAuth } from "@/lib/apiClient";

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(),
}));

const mockedFetch = fetchWithAuth as unknown as ReturnType<typeof vi.fn>;

describe("ReadAloudButton — Cloud TTS click storms", () => {
  beforeEach(() => {
    // Fake timers so a DELIBERATE second press (slow) is distinguishable from
    // drumming (fast). Without control of the clock every press in a test is
    // sub-millisecond and indistinguishable from a drum roll.
    vi.useFakeTimers();
    mockedFetch.mockReset();
    // Never settles: models the real gap between the click and playback.
    mockedFetch.mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderButton(text = "Bølgelængden er konstant") {
    render(<ReadAloudButton text={text} lang="da" provider="gcp_wavenet" />);
    return screen.getByRole("button", { name: /read aloud/i });
  }

  it("fires ONE synthesize request no matter how hard the button is hammered", async () => {
    const button = renderButton();

    await act(async () => {
      for (let i = 0; i < 8; i++) fireEvent.click(button);
    });

    // Was 8 before any guard. With only the in-flight ref it was still 4 —
    // this is a play/stop toggle, so drumming alternates start/stop/start/stop
    // and every other press bought a synthesis.
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("treats a second press as stop, then allows a fresh read", async () => {
    // The guard must not latch. A student who starts a read, changes their
    // mind, and starts again must not be locked out for the session.
    const button = renderButton();

    await act(async () => {
      fireEvent.click(button); // start
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1000); // a person reacting, not drumming
      fireEvent.click(button); // stop — clears the guard
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      fireEvent.click(button); // start again
    });

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("does not block a DIFFERENT message's button", async () => {
    // The guard is per component instance. Two bubbles each have their own
    // button, and reading one must not disable the other.
    render(<ReadAloudButton text="Første" lang="da" provider="gcp_wavenet" />);
    render(<ReadAloudButton text="Anden" lang="da" provider="gcp_wavenet" />);
    const [first, second] = screen.getAllByRole("button", { name: /read aloud/i });

    await act(async () => {
      fireEvent.click(first);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      fireEvent.click(second);
    });

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });
});
