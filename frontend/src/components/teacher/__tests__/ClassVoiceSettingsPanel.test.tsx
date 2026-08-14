import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const setClassCapabilities = vi.fn().mockResolvedValue({ ok: true });
const setClassVoiceSettings = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@/lib/teacherApi", () => ({
  setClassCapabilities: (...a: unknown[]) => setClassCapabilities(...a),
  setClassVoiceSettings: (...a: unknown[]) => setClassVoiceSettings(...a),
}));

import { ClassVoiceSettingsPanel } from "../ClassVoiceSettingsPanel";

afterEach(() => vi.clearAllMocks());

describe("ClassVoiceSettingsPanel — capability toggles", () => {
  it("shows the two capability toggles as the primary surface", () => {
    render(<ClassVoiceSettingsPanel classId="c1" initial={null} onSaved={vi.fn()} />);
    expect(screen.getByText("Student voice input")).toBeInTheDocument();
    expect(screen.getByText("Record this class")).toBeInTheDocument();
  });

  it("toggling 'Record this class' persists via setClassCapabilities", async () => {
    render(<ClassVoiceSettingsPanel classId="c1" initial={null} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Record this class"));
    await waitFor(() =>
      expect(setClassCapabilities).toHaveBeenCalledWith("c1", { recordingEnabled: true }),
    );
  });

  it("reflects the initial capability state", () => {
    render(
      <ClassVoiceSettingsPanel classId="c1" initial={null} initialVoiceInput onSaved={vi.fn()} />,
    );
    expect(screen.getByLabelText("Student voice input")).toBeChecked();
    expect(screen.getByLabelText("Record this class")).not.toBeChecked();
  });
});

/**
 * 2026-08-14 — the custom language/voice picker was removed to keep the class
 * screen simple; the persona decides how the tutor sounds.
 *
 * Removing the UI is the easy half. The per-class slot still sits in the
 * server's resolution chain (student localStorage > per-class > skill > env),
 * so an override saved before today keeps beating the persona with nothing on
 * screen to explain why one class sounds different from the rest. These tests
 * pin both halves: gone for the common case, still escapable for the legacy one.
 */
describe("ClassVoiceSettingsPanel — the removed picker", () => {
  const withOverride = { language: "da", voice: "da-DK-Wavenet-E", provider: "google" };

  it("offers no way to SET a custom voice", () => {
    render(<ClassVoiceSettingsPanel classId="c1" initial={null} onSaved={vi.fn()} />);
    expect(screen.queryByText(/Custom voice/i)).toBeNull();
    expect(screen.queryByText("Language")).toBeNull();
    expect(screen.queryByText("Voice")).toBeNull();
    // No select at all — the picker was the only one on this panel.
    expect(document.querySelector("select")).toBeNull();
  });

  it("says nothing about voices when the class has no override", () => {
    // The whole point is a simpler screen: a class with nothing set must not
    // gain a paragraph explaining a feature it does not use.
    render(<ClassVoiceSettingsPanel classId="c1" initial={null} onSaved={vi.fn()} />);
    expect(screen.queryByText(/custom voice/i)).toBeNull();
  });

  it("surfaces a legacy override rather than letting it win invisibly", () => {
    render(
      <ClassVoiceSettingsPanel classId="c1" initial={withOverride} onSaved={vi.fn()} />,
    );
    expect(screen.getByText(/older/i)).toBeInTheDocument();
    // Names the actual voice, so a teacher can tell which class is the odd one.
    expect(screen.getByText("da-DK-Wavenet-E")).toBeInTheDocument();
  });

  it("clears the override back to the persona's voice", async () => {
    const onSaved = vi.fn();
    render(<ClassVoiceSettingsPanel classId="c1" initial={withOverride} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: /persona/i }));
    await waitFor(() =>
      expect(setClassVoiceSettings).toHaveBeenCalledWith("c1", {
        language: null,
        voice: null,
        provider: null,
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // And the notice goes away without waiting for the parent to refetch.
    await waitFor(() => expect(screen.queryByText(/older/i)).toBeNull());
  });
});
