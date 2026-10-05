import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { CustomApproach } from "@/lib/teacherApi";
import { CustomApproachPanel } from "@/components/teacher/research/CustomApproachPanel";

// 1.1.108 — teacher screens follow the person's language, Danish by default.
// These tests assert the English copy, so they render inside an English
// context; the Danish default has its own assertion in teacherResearchLocale.test.tsx.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const result = rtlRender(wrap(ui), options);
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
}

function approach(over: Partial<CustomApproach> = {}): CustomApproach {
  return {
    id: "custom-warm-coach",
    label: "Warm coach",
    summary: "Encouraging.",
    instructionText: "Be kind. Ask first.",
    register: null,
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

  it("tells the teacher that researchers can see this work", async () => {
    // 1.1.91 M4's gate, met in the product rather than in a meeting. It is the
    // teacher's professional work, and the trust-card principle applies to
    // teachers as much as to students — so the surface says so where the work
    // is written, and says what researchers CANNOT do too.
    render(<CustomApproachPanel />);
    expect(await screen.findByText(/Researchers on the project can see the approaches you write/i)).toBeInTheDocument();
    expect(screen.getByText(/They cannot change them/i)).toBeInTheDocument();
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
        register: null,
        sources: [],
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


describe("sharing a custom approach (TUTOR-2 M0/M1)", () => {
  it("reads an approach with no visibility field as shared", async () => {
    // ⚠️ ABSENT IS NOT PRIVATE. Rows written before the field keep the
    // behaviour they already had; defaulting them to private would make every
    // existing approach vanish from every other teacher's list at once.
    render(<CustomApproachPanel />);
    expect(await screen.findByTestId("approach-visibility-custom-warm-coach")).toHaveTextContent("Shared");
  });

  it("says what private actually means, rather than implying nobody can see it", async () => {
    // The research team can see a private approach, by decision. A teacher who
    // reads "private" as "nobody sees this" and learns otherwise loses trust,
    // not a bug report — so the panel says it next to the control.
    vi.spyOn(teacherApi, "listCustomApproaches").mockResolvedValue([approach({ visibility: "private" })]);
    render(<CustomApproachPanel />);
    expect(await screen.findByTestId("approach-visibility-custom-warm-coach")).toHaveTextContent("Only you");
    expect(screen.getByText(/visible to the research team/)).toBeInTheDocument();
  });

  it("shares with one control and takes it back with the same one", async () => {
    const set = vi.spyOn(teacherApi, "setCustomApproachVisibility").mockResolvedValue(approach());
    vi.spyOn(teacherApi, "listCustomApproaches").mockResolvedValue([approach({ visibility: "private" })]);
    render(<CustomApproachPanel />);

    await userEvent.click(await screen.findByLabelText(/Share with other teachers: Warm coach/));
    expect(set).toHaveBeenCalledWith("custom-warm-coach", "shared");
  });

  it("offers no share control on somebody else's approach", async () => {
    vi.spyOn(teacherApi, "listCustomApproaches").mockResolvedValue([approach({ canEdit: false })]);
    render(<CustomApproachPanel />);
    await screen.findByText("Warm coach");
    expect(screen.queryByLabelText(/Share with other teachers/)).not.toBeInTheDocument();
  });
});


describe("who made an approach, and what it draws on (1.1.150)", () => {
  it("does not call a teacher's approach the researcher's own", async () => {
    // The 2026-10-05 seminar: a pilot teacher's private "Didaktisk Tutor"
    // showed in a researcher's list as "yours", because the label read
    // `canEdit` — and a researcher may edit every approach. `isOwn` decides.
    vi.spyOn(teacherApi, "listCustomApproaches").mockResolvedValue([
      approach({
        id: "custom-didaktisk-tutor",
        label: "Didaktisk Tutor",
        canEdit: true,
        isOwn: false,
        authorUid: "t-9",
        authorRole: "teacher",
        authorEmail: "pilot.teacher@example.dk",
        createdVia: "ui",
        createdAt: "2026-10-03T13:00:42Z",
      }),
    ]);
    render(<CustomApproachPanel />);

    const line = await screen.findByTestId("approach-author-custom-didaktisk-tutor");
    expect(line).toHaveTextContent("Made by a teacher");
    expect(line).toHaveTextContent("pilot.teacher@example.dk");
    expect(line).toHaveTextContent(/created via the app on/);
    expect(line).not.toHaveTextContent("Made by you");
  });

  it("names your own as yours, and says when a creation record was not kept", async () => {
    vi.spyOn(teacherApi, "listCustomApproaches").mockResolvedValue([approach({ isOwn: true, createdAt: null })]);
    render(<CustomApproachPanel />);
    const line = await screen.findByTestId("approach-author-custom-warm-coach");
    expect(line).toHaveTextContent("Made by you");
    expect(line).toHaveTextContent("not recorded");
  });

  it("shows the sources an approach draws on, as links only when they are links", async () => {
    vi.spyOn(teacherApi, "listCustomApproaches").mockResolvedValue([
      approach({
        sources: [
          { citation: "Brousseau (1997)", url: "https://example.org/tds", note: "Devolution." },
          { citation: "Artigue (2009)" },
        ],
      }),
    ]);
    render(<CustomApproachPanel />);
    expect(await screen.findByRole("link", { name: "Brousseau (1997)" })).toHaveAttribute("href", "https://example.org/tds");
    expect(screen.getByText("Artigue (2009)")).toBeInTheDocument();
    expect(screen.getByText(/Devolution\./)).toBeInTheDocument();
  });

  it("round-trips sources through the editor without inventing who added them", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(teacherApi, "updateCustomApproach").mockResolvedValue(approach());
    vi.spyOn(teacherApi, "listCustomApproaches").mockResolvedValue([
      approach({
        sources: [{ citation: "Brousseau (1997)", url: "https://example.org/tds", addedBy: "t-1", addedAt: "2026-10-03T00:00:00Z" }],
      }),
    ]);
    render(<CustomApproachPanel />);

    await user.click(await screen.findByRole("button", { name: /^Edit Warm coach/i }));
    expect(screen.getByLabelText("Reference 1")).toHaveValue("Brousseau (1997)");
    await user.click(screen.getByRole("button", { name: "Add a source" }));
    await user.type(screen.getByLabelText("Reference 2"), "Artigue (2009)");
    await user.type(screen.getByLabelText("Note (optional) 2"), "Design.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const sent = update.mock.calls[0][1].sources;
    expect(sent).toEqual([
      { citation: "Brousseau (1997)", url: "https://example.org/tds", note: null, corpusRef: null },
      { citation: "Artigue (2009)", url: null, note: "Design.", corpusRef: null },
    ]);
    // Server-stamped fields are never sent back as if the client decided them.
    expect(JSON.stringify(sent)).not.toContain("addedBy");
  });

  it("drops a blank source row rather than sending it", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(teacherApi, "createCustomApproach").mockResolvedValue(approach());
    render(<CustomApproachPanel />);
    await user.click(await screen.findByRole("button", { name: /New approach/i }));
    await user.type(screen.getByLabelText(/^Name$/i), "Warm coach");
    await user.type(screen.getByLabelText(/What the tutor is told/i), "Be kind.");
    await user.click(screen.getByRole("button", { name: "Add a source" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ sources: [] })));
  });

  it("speaks Danish by default", async () => {
    vi.spyOn(teacherApi, "listCustomApproaches").mockResolvedValue([
      approach({ isOwn: false, authorRole: "researcher", createdVia: "copilot", createdAt: "2026-10-03T13:00:42Z" }),
    ]);
    rtlRender(<CustomApproachPanel />);
    const line = await screen.findByTestId("approach-author-custom-warm-coach");
    expect(line).toHaveTextContent("Lavet af en forsker");
    expect(line).toHaveTextContent("co-piloten");
  });
});
