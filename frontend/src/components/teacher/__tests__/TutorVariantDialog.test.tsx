import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { TutorPayload } from "@/lib/teacherApi";
import { TutorVariantDialog } from "@/components/teacher/TutorVariantDialog";

const parent: TutorPayload = {
  id: "sofie",
  displayName: "Sofie",
  summary: null,
  personaId: "sofie",
  frameworkId: null,
  interactionStyle: "warm",
  status: "ready",
  version: 1,
  isVariant: false,
  lineage: { kind: "original", parentTutorId: null },
  persona: { id: "sofie", name: "Sofie", title: null, avatar: "/personas/sofie.webp" },
  frameworkName: null,
  frameworkSummary: null,
};

const frameworks = [
  { id: "esru", name: "Question-and-use cycle (ESRU)", summary: "", isPlaceholder: false },
  { id: "authentic-dialogue", name: "Open dialogue (Authentic Dialogue)", summary: "", isPlaceholder: false },
  { id: "poe", name: "Predict, observe, explain (POE)", summary: "", isPlaceholder: true },
];

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("TutorVariantDialog (1.1.91 M5)", () => {
  it("only offers frameworks whose teaching moves are written", async () => {
    render(<TutorVariantDialog parent={parent} frameworks={frameworks} onCreated={vi.fn()} onCancel={vi.fn()} />);
    // A placeholder would give a tutor that claims an approach and teaches none.
    expect(screen.queryByRole("option", { name: /Predict, observe, explain/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Question-and-use cycle/ })).toBeInTheDocument();
    expect(screen.getByText(/1 more frameworks are in the library/i)).toBeInTheDocument();
  });

  it("says plainly that the parent is not changed", () => {
    render(<TutorVariantDialog parent={parent} frameworks={frameworks} onCreated={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/Sofie is not changed/i)).toBeInTheDocument();
  });

  it("derives a slug id from the name and shows it", async () => {
    const user = userEvent.setup();
    render(<TutorVariantDialog parent={parent} frameworks={frameworks} onCreated={vi.fn()} onCancel={vi.fn()} />);
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Sofie Lab Coach");
    // Shown because it is the key 1.1.92 attributes scores to.
    expect(screen.getByText("sofie-lab-coach")).toBeInTheDocument();
  });

  it("creates the variant with its parent and chosen framework", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const spy = vi
      .spyOn(teacherApi, "createTutorVariant")
      .mockResolvedValue({ ...parent, id: "sofie-variant", isVariant: true });

    render(<TutorVariantDialog parent={parent} frameworks={frameworks} onCreated={onCreated} onCancel={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText(/Teaching approach/i), "esru");
    await user.click(screen.getByRole("button", { name: /Create variant/ }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ parentId: "sofie", frameworkId: "esru" }),
      ),
    );
    expect(onCreated).toHaveBeenCalled();
  });

  it("explains a duplicate id rather than showing a raw error", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "createTutorVariant").mockRejectedValue(new Error("create failed: 409"));
    render(<TutorVariantDialog parent={parent} frameworks={frameworks} onCreated={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Create variant/ }));
    await screen.findByText(/already exists/i);
  });
});
