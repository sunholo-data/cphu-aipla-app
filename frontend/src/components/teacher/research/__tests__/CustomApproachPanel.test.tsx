import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { CustomApproach } from "@/lib/teacherApi";
import { CustomApproachPanel } from "@/components/teacher/research/CustomApproachPanel";

function approach(over: Partial<CustomApproach> = {}): CustomApproach {
  return {
    id: "custom-warm-coach",
    label: "Warm coach",
    summary: "Encouraging.",
    instructionText: "Be kind. Ask first.",
    layer: "custom",
    status: "ready",
    authorUid: "t-1",
    authorRole: "teacher",
    materialRefs: [],
    canEdit: true,
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(teacherApi, "listCustomApproaches").mockResolvedValue([approach()]);
});
afterEach(() => vi.restoreAllMocks());

describe("custom teaching approaches (1.1.110)", () => {
  it("says plainly that a custom approach makes no claim to a paper", async () => {
    // The whole reason free-text authoring moved here from the published
    // frameworks: the capability was fine, the claim attached to it was not.
    render(<CustomApproachPanel />);
    expect(await screen.findByText(/not drawn from a published paper/i)).toBeInTheDocument();
    expect(screen.getByText(/carries no constructs and no citations/i)).toBeInTheDocument();
  });

  it("creates an approach from a name and its instructions", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(teacherApi, "createCustomApproach").mockResolvedValue(approach());
    render(<CustomApproachPanel />);

    await user.click(await screen.findByRole("button", { name: /New approach/i }));
    await user.type(screen.getByLabelText(/^Name$/i), "Warm coach");
    await user.type(screen.getByLabelText(/What the tutor is told/i), "Be kind.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        label: "Warm coach",
        summary: "",
        instructionText: "Be kind.",
      }),
    );
  });

  it("will not save without both a name and instructions", async () => {
    const user = userEvent.setup();
    render(<CustomApproachPanel />);
    await user.click(await screen.findByRole("button", { name: /New approach/i }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(screen.getByLabelText(/^Name$/i), "Warm coach");
    // A named approach with no instructions would give the tutor nothing.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("offers no edit controls on someone else's approach", async () => {
    // canEdit is computed SERVER-side per row. The UI honours it and never
    // re-derives it — a second copy of an access rule disagrees with the first
    // the moment one changes.
    vi.spyOn(teacherApi, "listCustomApproaches").mockResolvedValue([
      approach({ canEdit: false, authorUid: "t-2", authorRole: "teacher" }),
    ]);
    render(<CustomApproachPanel />);

    expect(await screen.findByText(/belongs to someone else/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete /i })).not.toBeInTheDocument();
  });

  it("warns that deleting is not reference-checked before it deletes", async () => {
    // The server does NOT check whether a class still uses the approach, and
    // framework resolution is None-tolerant — so a dangling reference is a
    // silent loss of pedagogy, not an error. The dialog has to say so.
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const del = vi.spyOn(teacherApi, "deleteCustomApproach").mockResolvedValue();

    render(<CustomApproachPanel />);
    await user.click(await screen.findByRole("button", { name: /^Delete Warm coach/i }));

    expect(confirmSpy.mock.calls[0][0]).toMatch(/Nothing checks whether a class is still using/i);
    expect(del).not.toHaveBeenCalled();
  });

  it("keeps the typed text when a save fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "createCustomApproach").mockRejectedValue(new Error("boom"));
    render(<CustomApproachPanel />);

    await user.click(await screen.findByRole("button", { name: /New approach/i }));
    await user.type(screen.getByLabelText(/^Name$/i), "Warm coach");
    await user.type(screen.getByLabelText(/What the tutor is told/i), "Be kind.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/Could not save/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/What the tutor is told/i)).toHaveValue("Be kind.");
  });
});
