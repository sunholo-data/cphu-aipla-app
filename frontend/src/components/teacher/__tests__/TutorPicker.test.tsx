import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { TutorPayload } from "@/lib/teacherApi";
import { TutorPicker } from "@/components/teacher/TutorPicker";

function tutor(over: Partial<TutorPayload> = {}): TutorPayload {
  return {
    id: "sofie",
    displayName: "Sofie — Allround fysiklærer",
    summary: null,
    personaId: "sofie",
    frameworkId: null,
    interactionStyle: "warm",
    status: "ready",
    version: 1,
    isVariant: false,
    lineage: { kind: "original", parentTutorId: null },
    persona: { id: "sofie", name: "Sofie", title: "Allround fysiklærer", avatar: "/personas/sofie.webp" },
    frameworkName: null,
    frameworkSummary: null,
    ...over,
  };
}

const withFramework = tutor({
  id: "sofie-esru",
  displayName: "Sofie — lab coach",
  frameworkId: "esru",
  frameworkName: "Question-and-use cycle (ESRU)",
  frameworkSummary: "A turn-level assessment conversation…",
  isVariant: true,
  lineage: { kind: "variant-of", parentTutorId: "sofie" },
});

function mockCatalogue(tutors: TutorPayload[]) {
  vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue({
    tutors,
    frameworks: [{ id: "esru", name: "Question-and-use cycle (ESRU)", summary: "", isPlaceholder: false }],
  });
  vi.spyOn(teacherApi, "fetchPersonaCatalogue").mockResolvedValue({
    personas: [],
    defaultId: "sofie",
    interactionStyles: [
      { id: "warm", prompt: "## Interaction style: warm\nBe encouraging.", injected: true },
    ],
  });
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("TutorPicker (1.1.91 M1 — one choice)", () => {
  it("shows tone AND teaching approach on the card, without opening anything", async () => {
    mockCatalogue([tutor(), withFramework]);
    render(<TutorPicker classId="c-1" selectedTutorId={null} />);

    await screen.findByText("Sofie — Allround fysiklærer");
    // The bundling is only useful if both are legible at a glance.
    expect(screen.getByText(/warm · no set teaching approach/i)).toBeInTheDocument();
    expect(screen.getByText(/warm · Question-and-use cycle \(ESRU\)/i)).toBeInTheDocument();
  });

  it("never shows a framework as a bare acronym", async () => {
    mockCatalogue([withFramework]);
    render(<TutorPicker classId="c-1" selectedTutorId={null} />);
    await screen.findByText(/Question-and-use cycle \(ESRU\)/);
    // "ESRU" only ever appears inside the plain-language phrase.
    for (const node of screen.queryAllByText(/ESRU/)) {
      expect(node.textContent).toMatch(/Question-and-use cycle/);
    }
  });

  it("lets a teacher read what the approach does before choosing it", async () => {
    mockCatalogue([withFramework]);
    render(<TutorPicker classId="c-1" selectedTutorId={null} />);
    await screen.findByText(/What does this teaching approach do\?/i);
    expect(screen.getByText(/A turn-level assessment conversation/)).toBeInTheDocument();
  });

  it("saves the choice to the class", async () => {
    const user = userEvent.setup();
    mockCatalogue([tutor(), withFramework]);
    const save = vi.spyOn(teacherApi, "setClassTutor").mockResolvedValue(undefined);

    render(<TutorPicker classId="c-1" selectedTutorId={null} />);
    await user.click(await screen.findByRole("button", { name: /Sofie — lab coach/ }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("c-1", "sofie-esru"));
  });

  it("clicking the selected tutor clears it back to the default", async () => {
    const user = userEvent.setup();
    mockCatalogue([tutor()]);
    const save = vi.spyOn(teacherApi, "setClassTutor").mockResolvedValue(undefined);

    render(<TutorPicker classId="c-1" selectedTutorId="sofie" />);
    await user.click(await screen.findByRole("button", { name: /Sofie/ }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("c-1", null));
  });

  it("rolls the choice back and says so when saving fails", async () => {
    const user = userEvent.setup();
    mockCatalogue([tutor(), withFramework]);
    vi.spyOn(teacherApi, "setClassTutor").mockRejectedValue(new Error("boom"));

    render(<TutorPicker classId="c-1" selectedTutorId="sofie" />);
    await user.click(await screen.findByRole("button", { name: /Sofie — lab coach/ }));

    await screen.findByText(/Nothing has changed/i);
    // The original selection is restored, not left showing a lie.
    expect(screen.getByRole("button", { name: /Sofie — Allround/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the teaching-style transparency the persona panel used to carry", async () => {
    // Replacing the old panel must not lose sight of what the tutor is TOLD —
    // that would be a regression, not just a moved control.
    mockCatalogue([tutor()]);
    render(<TutorPicker classId="c-1" selectedTutorId={null} />);
    await screen.findByText(/How teaching styles are enforced/i);
  });

  it("says plainly when no tutor is chosen", async () => {
    mockCatalogue([tutor()]);
    render(<TutorPicker classId="c-1" selectedTutorId={null} />);
    await screen.findByText(/teaches as it always has/i);
  });

  it("offers no variant authoring on a class page", async () => {
    // Removed 2026-09-11. A class is where you CHOOSE a tutor; authoring a
    // research instrument is a different job at a different moment, and this
    // sat inside a <details> at the bottom of class settings — hard to find and
    // easy to trigger by accident. The API and the dialog component both
    // survive; only this placement is gone, and it must not creep back.
    mockCatalogue([tutor()]);
    render(<TutorPicker classId="c-1" selectedTutorId={null} />);
    await screen.findByText(/Sofie/);

    expect(screen.queryByText(/create a variant/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Researcher:/i)).not.toBeInTheDocument();
  });
});
