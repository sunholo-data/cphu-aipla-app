import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { TeachingFrameworkPayload } from "@/lib/teacherApi";
import ResearchFrameworksPage from "@/app/teacher/research/frameworks/page";

const GENERATED = "## Teaching framework: ESRU\n\n### Elicit\n- Ask for an explanation.";

function esru(overrides: Partial<TeachingFrameworkPayload> = {}): TeachingFrameworkPayload {
  return {
    id: "esru",
    label: "ESRU — informal formative assessment cycle",
    summary: "A turn-level assessment conversation.",
    layer: "tp_cycle",
    status: "ready_for_review",
    constructs: [
      {
        name: "elicit",
        summary: null,
        behaviours: [{ text: "Ask for an explanation.", dimension: "epistemic" }],
        avoid: ["Asking a yes/no question."],
      },
    ],
    provenance: [{ citation: "Ruiz-Primo & Furtak (2007). JRST 44(1).", vouchedBy: "M", note: null }],
    instruction: GENERATED,
    defaultInstruction: GENERATED,
    isOverridden: false,
    ...overrides,
  };
}

function poe(): TeachingFrameworkPayload {
  return {
    ...esru(),
    id: "poe",
    label: "Predict-Observe-Explain",
    status: "placeholder",
    constructs: [],
    instruction: "",
    defaultInstruction: "",
  };
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("ResearchFrameworksPage (1.1.91 M1 — researcher edits the tutor instruction)", () => {
  it("shows the catalogue and badges a generated instruction as un-edited", async () => {
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru(), poe()]);
    render(<ResearchFrameworksPage />);

    await screen.findByText(/ESRU/);
    expect(screen.getByText("Generated from the theory")).toBeInTheDocument();
    // A placeholder says so, and offers no editor — an empty instruction is not
    // something to hand a researcher a textarea for.
    expect(screen.getByText("Awaiting pedagogical content")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Edit instruction/ })).toHaveLength(1);
  });

  it("renders access-required when the backend 403s a non-researcher", async () => {
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockRejectedValue(new Error("list failed: 403"));
    render(<ResearchFrameworksPage />);
    await screen.findByText(/Researcher access required/i);
  });

  it("saves an edited instruction and keeps the generated text visible beside it", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    const saveSpy = vi
      .spyOn(teacherApi, "saveFrameworkInstruction")
      .mockResolvedValue(esru({ instruction: "Ask, then act.", isOverridden: true, overrideVersion: 1 }));

    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit instruction/ }));

    // The generated version is always on the page, so an edit reads as a delta
    // from the theory rather than as an opaque prompt.
    expect(screen.getByText(/the version without your edits/i)).toBeInTheDocument();

    const box = screen.getByLabelText(/What the tutor is told/i);
    expect(box).toHaveValue(GENERATED);
    await user.clear(box);
    await user.type(box, "Ask, then act.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith("esru", "Ask, then act."));
    await screen.findByText(/Edited/);
  });

  it("offers Revert only once an override exists", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([
      esru({ instruction: "Ask, then act.", isOverridden: true, overrideVersion: 2 }),
    ]);
    const revertSpy = vi.spyOn(teacherApi, "revertFrameworkInstruction").mockResolvedValue(esru());

    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit instruction/ }));

    await user.click(screen.getByRole("button", { name: /Revert to generated/ }));
    await waitFor(() => expect(revertSpy).toHaveBeenCalledWith("esru"));
    // Back to the generated text, and the Revert affordance goes with it.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Revert to generated/ })).not.toBeInTheDocument(),
    );
  });

  it("disables Save until the instruction actually changes", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit instruction/ }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
