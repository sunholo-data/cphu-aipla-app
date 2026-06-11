import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const setClassCapabilities = vi.fn().mockResolvedValue({ ok: true });
const setClassVoiceSettings = vi.fn().mockResolvedValue({ ok: true });
const fetchVoiceList = vi.fn().mockResolvedValue({ languages: ["da"], voices: { da: [] } });

vi.mock("@/lib/teacherApi", () => ({
  setClassCapabilities: (...a: unknown[]) => setClassCapabilities(...a),
  setClassVoiceSettings: (...a: unknown[]) => setClassVoiceSettings(...a),
  fetchVoiceList: () => fetchVoiceList(),
}));

import { ClassVoiceSettingsPanel } from "../ClassVoiceSettingsPanel";

afterEach(() => vi.clearAllMocks());

describe("ClassVoiceSettingsPanel (M4 — simplified config)", () => {
  it("shows the two capability toggles as the primary surface", () => {
    render(<ClassVoiceSettingsPanel classId="c1" initial={null} onSaved={vi.fn()} />);
    expect(screen.getByText("Student voice input")).toBeInTheDocument();
    expect(screen.getByText("Record this class")).toBeInTheDocument();
  });

  it("demotes the raw voice picker behind a 'Custom voice (advanced)' disclosure", () => {
    render(<ClassVoiceSettingsPanel classId="c1" initial={null} onSaved={vi.fn()} />);
    expect(screen.getByText("Custom voice (advanced)")).toBeInTheDocument();
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
      <ClassVoiceSettingsPanel
        classId="c1"
        initial={null}
        initialVoiceInput
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Student voice input")).toBeChecked();
    expect(screen.getByLabelText("Record this class")).not.toBeChecked();
  });
});
