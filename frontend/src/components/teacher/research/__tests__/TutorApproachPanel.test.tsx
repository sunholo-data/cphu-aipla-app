// Assigning a tutor an approach, and undoing it (2026-09-29).
//
// `clearTutorFramework` had no call site, and the reason turned out to be a
// wrong sentence rather than a forgotten button: the panel told researchers to
// "set a tutor back to 'No stated approach' to undo", which is not an undo at
// all. It writes an assignment meaning "this tutor teaches with nothing",
// OVERRIDING whatever the tutor says about itself. Removing the assignment is
// the different act, and it needed `hasAssignment` to have anything to hang on.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { TutorCatalogue, TutorPayload } from "@/lib/teacherApi";
import { TutorApproachPanel } from "@/components/teacher/research/TutorApproachPanel";

const FRAMEWORKS = [
  { id: "esru", name: "Question-and-use cycle (ESRU)", isPlaceholder: false },
  { id: "cer", name: "Claim-evidence-reasoning (CER)", isPlaceholder: false },
];

function tutor(over: Partial<TutorPayload> = {}): TutorPayload {
  return {
    id: "sofie",
    displayName: "Sofie",
    interactionStyle: "socratic",
    status: "ready",
    version: 1,
    isVariant: false,
    lineage: { kind: "original" },
    persona: null,
    frameworkName: null,
    frameworkSummary: null,
    hasAssignment: false,
    ...over,
  };
}

function catalogue(tutors: TutorPayload[]): TutorCatalogue {
  return {
    tutors,
    skillBoundTutors: [],
    frameworks: FRAMEWORKS.map((f) => ({ ...f, summary: "" })),
  };
}

beforeEach(() => {
  vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue(catalogue([tutor()]));
});
afterEach(() => vi.restoreAllMocks());

describe("TutorApproachPanel", () => {
  it("offers no undo for a tutor nobody has assigned", async () => {
    render(<TutorApproachPanel frameworks={FRAMEWORKS} />);
    await screen.findByText("Sofie");
    // Nothing to undo: the tutor carries whatever it carries.
    expect(screen.queryByLabelText(/Undo my choice/)).not.toBeInTheDocument();
  });

  it("offers undo once a researcher has assigned one", async () => {
    vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue(
      catalogue([tutor({ hasAssignment: true, frameworkId: "esru", frameworkName: "ESRU" })]),
    );
    render(<TutorApproachPanel frameworks={FRAMEWORKS} />);
    expect(await screen.findByLabelText("Undo my choice for Sofie")).toBeInTheDocument();
  });

  it("undo REMOVES the assignment rather than assigning nothing", async () => {
    // ⚠️ The distinction the old copy blurred, pinned here so it cannot be
    // "simplified" back into a single call.
    const clear = vi.spyOn(teacherApi, "clearTutorFramework").mockResolvedValue({ tutor: tutor() });
    const set = vi.spyOn(teacherApi, "setTutorFramework");
    vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue(
      catalogue([tutor({ hasAssignment: true, frameworkId: "esru" })]),
    );
    render(<TutorApproachPanel frameworks={FRAMEWORKS} />);

    await userEvent.click(await screen.findByLabelText("Undo my choice for Sofie"));
    await waitFor(() => expect(clear).toHaveBeenCalledWith("sofie"));
    expect(set).not.toHaveBeenCalled();
  });

  it("'No stated approach' still ASSIGNS — it is a choice, not an undo", async () => {
    const set = vi.spyOn(teacherApi, "setTutorFramework").mockResolvedValue({ tutor: tutor() });
    const clear = vi.spyOn(teacherApi, "clearTutorFramework");
    vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue(
      catalogue([tutor({ hasAssignment: true, frameworkId: "esru" })]),
    );
    render(<TutorApproachPanel frameworks={FRAMEWORKS} />);

    await userEvent.selectOptions(await screen.findByLabelText(/Teaching approach for Sofie/), "");
    await waitFor(() => expect(set).toHaveBeenCalledWith("sofie", null));
    expect(clear).not.toHaveBeenCalled();
  });

  it("says plainly that the two are different", async () => {
    render(<TutorApproachPanel frameworks={FRAMEWORKS} />);
    await screen.findByText("Sofie");
    expect(screen.getByText(/overriding whatever it says about itself/i)).toBeInTheDocument();
  });
});
