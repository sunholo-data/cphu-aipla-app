// TUTOR-2 M2 — where a tutor is made.
//
// TutorVariantDialog was complete, tested and mounted NOWHERE for eighteen
// days; zero variants exist on any environment as a result. The first test here
// is therefore about the thing that was actually missing: can a person open it.

import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { TutorCatalogue, TutorPayload } from "@/lib/teacherApi";
import { MyTutorsPanel } from "@/components/teacher/research/MyTutorsPanel";

// 1.1.108 — teacher screens follow the person's language, Danish by default.
// These tests assert the English copy, so they render inside an English
// context; the Danish default has its own assertion in teacherResearchLocale.test.tsx.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const result = rtlRender(wrap(ui), options);
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
}

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
    frameworkName: "Question-and-use cycle (ESRU)",
    frameworkSummary: null,
    canEdit: true,
    ...over,
  };
}

function catalogue(tutors: TutorPayload[]): TutorCatalogue {
  return {
    tutors,
    skillBoundTutors: [],
    frameworks: [
      { id: "esru", name: "Question-and-use cycle (ESRU)", summary: "", isPlaceholder: false },
      { id: "cer", name: "Claim-evidence-reasoning (CER)", summary: "", isPlaceholder: false },
    ],
  };
}

beforeEach(() => {
  vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue(catalogue([tutor()]));
  vi.spyOn(teacherApi, "listCustomPersonas").mockResolvedValue({
    personas: [
      {
        id: "persona-fru-hansen",
        name: "Fru Hansen",
        avatar: "/personas/frida.webp",
        language: "da",
        interactionStyle: "socratic",
        source: "firestore",
        canEdit: true,
      },
    ],
    avatars: [],
  });
});
afterEach(() => vi.restoreAllMocks());

describe("MyTutorsPanel", () => {
  it("opens the variant dialog — the thing that had no home at all", async () => {
    render(<MyTutorsPanel />);
    await userEvent.click(await screen.findByLabelText("Make a variant of Sofie"));
    // The dialog's own inputs, rendered at last.
    expect(await screen.findByDisplayValue("Sofie — variant")).toBeInTheDocument();
  });

  it("refuses to author a tutor with no approach, and says why", async () => {
    // ⚠️ The 1.1.91 rule, moved from the person to the tutor: "a tutor with a
    // theory field and no theory in it makes an unfounded claim look founded".
    const create = vi.spyOn(teacherApi, "createTutor");
    render(<MyTutorsPanel />);

    await userEvent.click(await screen.findByRole("button", { name: "New tutor" }));
    await userEvent.type(screen.getByLabelText("Name"), "My tutor");
    await userEvent.click(screen.getByRole("button", { name: "Create tutor" }));

    expect(await screen.findByText("Choose a teaching approach.")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("authors a tutor once an approach is named", async () => {
    const create = vi.spyOn(teacherApi, "createTutor").mockResolvedValue(tutor({ id: "my-tutor" }));
    render(<MyTutorsPanel />);

    await userEvent.click(await screen.findByRole("button", { name: "New tutor" }));
    await userEvent.type(screen.getByLabelText("Name"), "My tutor");
    await userEvent.selectOptions(screen.getByLabelText("Teaching approach"), "esru");
    await userEvent.click(screen.getByRole("button", { name: "Create tutor" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ displayName: "My tutor", frameworkId: "esru" })),
    );
  });

  it("reads a tutor with no visibility field as shared", async () => {
    // ABSENT IS NOT PRIVATE — the rule that stops every pre-existing tutor
    // disappearing from every picker at once.
    render(<MyTutorsPanel />);
    expect(await screen.findByTestId("tutor-visibility-sofie")).toHaveTextContent("Shared");
  });

  it("says what private actually means", async () => {
    vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue(
      catalogue([tutor({ visibility: "private" })]),
    );
    render(<MyTutorsPanel />);
    expect(await screen.findByTestId("tutor-visibility-sofie")).toHaveTextContent("Only you");
    expect(screen.getByText(/The research team can/)).toBeInTheDocument();
  });

  it("offers share and delete only on a tutor you may edit", async () => {
    vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue(
      catalogue([tutor({ id: "theirs", displayName: "Theirs", canEdit: false })]),
    );
    render(<MyTutorsPanel />);
    await screen.findByText("Theirs");

    expect(screen.queryByLabelText(/Share with other teachers/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Delete/)).not.toBeInTheDocument();
    // ...but anyone may fork it. That is what a variant is FOR.
    expect(screen.getByLabelText("Make a variant of Theirs")).toBeInTheDocument();
  });
});


describe("a tutor can wear a face someone made (TUTOR-2 M3)", () => {
  it("offers the custom personas and sends the chosen one", async () => {
    // Without this the persona editor would be a stack with no consumer — a
    // teacher could make a face and never put it on anything, which is M6's
    // bug one layer up.
    const create = vi.spyOn(teacherApi, "createTutor").mockResolvedValue(tutor());
    render(<MyTutorsPanel />);

    await userEvent.click(await screen.findByRole("button", { name: "New tutor" }));
    await userEvent.type(screen.getByLabelText("Name"), "My tutor");
    await userEvent.selectOptions(screen.getByLabelText("Teaching approach"), "esru");
    await userEvent.selectOptions(await screen.findByLabelText("Face and voice"), "persona-fru-hansen");
    await userEvent.click(screen.getByRole("button", { name: "Create tutor" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ personaId: "persona-fru-hansen" })),
    );
  });
});
