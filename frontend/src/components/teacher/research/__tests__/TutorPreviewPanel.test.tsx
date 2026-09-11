import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { TutorPayload } from "@/lib/teacherApi";
import { TutorPreviewPanel } from "@/components/teacher/research/TutorPreviewPanel";

function tutor(id: string, name: string, framework: string | null): TutorPayload {
  return {
    id,
    displayName: name,
    summary: null,
    personaId: id,
    frameworkId: framework,
    interactionStyle: "socratic",
    status: "ready",
    version: 1,
    isVariant: false,
    lineage: { kind: "original", parentTutorId: null },
    persona: null,
    frameworkName: framework,
    frameworkSummary: null,
  } as unknown as TutorPayload;
}

beforeEach(() => {
  vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue({
    tutors: [tutor("mikkel", "Mikkel", "ESRU"), tutor("sofie", "Sofie", "POE"), tutor("jonas", "Jonas", null)],
    skillBoundTutors: [],
    frameworks: [],
  } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("tutor preview (1.1.91 M3)", () => {
  it("says plainly that no student is involved and nothing is recorded as teaching", async () => {
    // The constraint the whole feature is built around. A surface that ran
    // tutor turns without saying this would look like it was logging lessons.
    render(<TutorPreviewPanel />);
    expect(await screen.findByText(/no student is involved/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing here is recorded as teaching/i)).toBeInTheDocument();
  });

  it("defaults to two tutors, because the question is comparative", async () => {
    render(<TutorPreviewPanel />);
    await screen.findByRole("button", { name: /Mikkel/ });
    expect(screen.getByRole("button", { name: /Mikkel/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Sofie/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Jonas/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("will not pick a third tutor — side by side is two", async () => {
    const user = userEvent.setup();
    render(<TutorPreviewPanel />);
    await user.click(await screen.findByRole("button", { name: /Jonas/ }));
    expect(screen.getByRole("button", { name: /Jonas/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("asks BOTH tutors the same thing and shows the replies together", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(teacherApi, "previewTutors").mockResolvedValue([
      { ok: true, tutorId: "mikkel", displayName: "Mikkel", reply: "What do you predict?", composedFrom: undefined },
      { ok: true, tutorId: "sofie", displayName: "Sofie", reply: "Predict first, then we look.", composedFrom: undefined },
    ]);

    render(<TutorPreviewPanel />);
    await screen.findByRole("button", { name: /Mikkel/ });
    await user.type(screen.getByLabelText(/Say something a student might say/i), "Which ball lands first?");
    await user.click(screen.getByRole("button", { name: /Ask both/i }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("Which ball lands first?", ["mikkel", "sofie"]),
    );
    expect(await screen.findByText("What do you predict?")).toBeInTheDocument();
    expect(screen.getByText("Predict first, then we look.")).toBeInTheDocument();
  });

  it("shows what a preview does NOT carry, so nobody signs off a half-prompt", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "previewTutors").mockResolvedValue([
      {
        ok: true,
        tutorId: "mikkel",
        displayName: "Mikkel",
        reply: "hi",
        composedFrom: {
          skill: "concept-dialogue",
          skillFound: true,
          approach: "ESRU",
          approachId: "esru",
          register: null,
          persona: "Mikkel",
          notIncluded: ["activity materials", "teacher ILOs", "group history"],
        },
      },
    ]);

    render(<TutorPreviewPanel />);
    await screen.findByRole("button", { name: /Mikkel/ });
    await user.type(screen.getByLabelText(/Say something/i), "q");
    await user.click(screen.getByRole("button", { name: /Ask both/i }));

    await screen.findByText("hi");
    expect(screen.getByText(/does not include activity materials/i)).toBeInTheDocument();
  });

  it("one tutor failing still shows the other's answer", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "previewTutors").mockResolvedValue([
      { ok: true, tutorId: "mikkel", displayName: "Mikkel", reply: "an answer" },
      { ok: false, tutorId: "sofie", displayName: "Sofie", error: "the tutor did not answer (ClientError)" },
    ]);

    render(<TutorPreviewPanel />);
    await screen.findByRole("button", { name: /Mikkel/ });
    await user.type(screen.getByLabelText(/Say something/i), "q");
    await user.click(screen.getByRole("button", { name: /Ask both/i }));

    expect(await screen.findByText("an answer")).toBeInTheDocument();
    expect(screen.getByText(/did not answer/i)).toBeInTheDocument();
  });

  it("refuses to run with nothing to ask", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(teacherApi, "previewTutors");
    render(<TutorPreviewPanel />);
    await screen.findByRole("button", { name: /Mikkel/ });
    await user.click(screen.getByRole("button", { name: /Ask both/i }));

    expect(await screen.findByText(/Type something to ask/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});
