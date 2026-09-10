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
    overrideMode: null,
    defaultConstructs: [
      {
        name: "elicit",
        summary: null,
        behaviours: [{ text: "Ask for an explanation.", dimension: "epistemic" }],
        avoid: ["Asking a yes/no question."],
      },
    ],
    defaultProvenance: [{ citation: "Ruiz-Primo & Furtak (2007). JRST 44(1).", vouchedBy: "M", note: null }],
    defaultSummary: "A turn-level assessment conversation.",
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

beforeEach(() => {
  vi.restoreAllMocks();
  // The page mounts TutorApproachPanel, which fetches on mount. Stubbed for the
  // instruction-editor tests; the panel has its own describe block below.
  vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue({ tutors: [], frameworks: [] });
  vi.spyOn(teacherApi, "previewFrameworkStructure").mockResolvedValue({
    instruction: GENERATED,
    defaultInstruction: GENERATED,
  });
});
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
    expect(screen.getAllByRole("button", { name: /Edit wording/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Edit teaching approach/ })).toHaveLength(1);
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
      .mockResolvedValue(
        // overrideMode mirrors what the backend actually stamps on a text save.
        esru({ instruction: "Ask, then act.", isOverridden: true, overrideVersion: 1, overrideMode: "text" }),
      );

    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit wording/ }));

    // The generated version is always on the page, so an edit reads as a delta
    // from the theory rather than as an opaque prompt.
    expect(screen.getByText(/the version without your edits/i)).toBeInTheDocument();

    const box = screen.getByLabelText(/What the tutor is told/i);
    expect(box).toHaveValue(GENERATED);
    await user.clear(box);
    await user.type(box, "Ask, then act.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith("esru", "Ask, then act."));
    await screen.findByText(/Wording edited/);
  });

  it("offers Revert only once an override exists", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([
      esru({ instruction: "Ask, then act.", isOverridden: true, overrideVersion: 2, overrideMode: "text" }),
    ]);
    const revertSpy = vi.spyOn(teacherApi, "revertFrameworkInstruction").mockResolvedValue(esru());

    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit wording/ }));

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
    await user.click(await screen.findByRole("button", { name: /Edit wording/ }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("Structural editor (TUTOR-4 — the researcher edits the theory, not the prose)", () => {
  it("edits behaviours and references, and previews from the real generator", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    const previewSpy = vi.spyOn(teacherApi, "previewFrameworkStructure").mockResolvedValue({
      instruction: "## Regenerated\n- Ask for their reasoning.",
      defaultInstruction: GENERATED,
    });
    const saveSpy = vi
      .spyOn(teacherApi, "saveFrameworkStructure")
      .mockResolvedValue(esru({ isOverridden: true, overrideMode: "structured", overrideVersion: 1 }));

    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit teaching approach/ }));

    // The behaviour is editable text, not a paragraph of rendered prose.
    const behaviour = screen.getByLabelText("Behaviours 1");
    expect(behaviour).toHaveValue("Ask for an explanation.");
    await user.clear(behaviour);
    await user.type(behaviour, "Ask for their reasoning.");

    // References are editable too — that was the other half of the ask.
    expect(screen.getByLabelText(/Citation/)).toHaveValue("Ruiz-Primo & Furtak (2007). JRST 44(1).");
    expect(screen.getByLabelText(/Checked by/)).toHaveValue("M");

    // The preview comes from the server, so it cannot drift from what the
    // tutor is actually told.
    await waitFor(() => expect(previewSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("structure-preview")).toHaveTextContent("Ask for their reasoning."),
    );

    await user.click(screen.getByRole("button", { name: /Save teaching approach/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const sent = saveSpy.mock.calls[0][1];
    expect(sent.constructs[0].behaviours[0].text).toBe("Ask for their reasoning.");
    // The epistemic/conceptual tag survives an edit of the text beside it —
    // rebuilding behaviours from strings alone would silently drop the theory's
    // own dimension axis.
    expect(sent.constructs[0].behaviours[0].dimension).toBe("epistemic");
  });

  it("refuses to save a citation nobody has vouched for", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    const saveSpy = vi.spyOn(teacherApi, "saveFrameworkStructure");

    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit teaching approach/ }));
    await user.clear(screen.getByLabelText(/Checked by/));

    expect(await screen.findByText(/needs a citation and the initials/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save teaching approach/ })).toBeDisabled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("will not let the last construct be deleted into a silent no-op", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit teaching approach/ }));

    await user.click(screen.getByRole("button", { name: /Remove construct elicit/i }));
    expect(await screen.findByText(/needs at least one construct/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save teaching approach/ })).toBeDisabled();
  });

  it("opens on the editor the researcher last used", async () => {
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([
      esru({ isOverridden: true, overrideMode: "text", overrideVersion: 1 }),
    ]);
    render(<ResearchFrameworksPage />);
    // A wording edit is badged as such, so a researcher can tell at a glance
    // which frameworks still trace to their constructs.
    expect(await screen.findByText(/Wording edited/)).toBeInTheDocument();
  });
});

describe("TutorApproachPanel (TUTOR-4 — assigning an approach to the default tutors)", () => {
  const sofie: teacherApi.TutorPayload = {
    id: "sofie",
    displayName: "Sofie",
    summary: "Default tutor.",
    personaId: "sofie",
    frameworkId: null,
    interactionStyle: "socratic",
    status: "ready",
    version: 1,
    isVariant: false,
    lineage: { kind: "original" },
    persona: null,
    frameworkName: null,
    frameworkSummary: null,
  };

  it("assigns a framework to a default tutor", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue({ tutors: [sofie], frameworks: [] });
    const assignSpy = vi
      .spyOn(teacherApi, "setTutorFramework")
      .mockResolvedValue({ tutor: { ...sofie, frameworkId: "esru" } });

    render(<ResearchFrameworksPage />);
    const select = await screen.findByLabelText(/Teaching approach for Sofie/i);
    // Ships with none — the catalogue does not make a pedagogical claim nobody
    // signed off, so the claim starts here.
    expect(select).toHaveValue("");

    await user.selectOptions(select, "esru");
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("sofie", "esru"));
    await waitFor(() => expect(screen.getByLabelText(/Teaching approach for Sofie/i)).toHaveValue("esru"));
  });

  it("sends null when set back to no approach, which is how an assignment is undone", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue({
      tutors: [{ ...sofie, frameworkId: "esru" }],
      frameworks: [],
    });
    const assignSpy = vi.spyOn(teacherApi, "setTutorFramework").mockResolvedValue({ tutor: sofie });

    render(<ResearchFrameworksPage />);
    await user.selectOptions(await screen.findByLabelText(/Teaching approach for Sofie/i), "");
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("sofie", null));
  });

  it("does not offer a framework whose teaching moves are unwritten", async () => {
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru(), poe()]);
    vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue({ tutors: [sofie], frameworks: [] });

    render(<ResearchFrameworksPage />);
    const select = await screen.findByLabelText(/Teaching approach for Sofie/i);
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(options).toContain("esru");
    // A placeholder would give the tutor an approach it cannot teach with.
    expect(options).not.toContain("poe");
  });
});
