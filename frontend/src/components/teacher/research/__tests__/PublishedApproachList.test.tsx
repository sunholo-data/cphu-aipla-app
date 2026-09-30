// TUTOR-2 M1 — the seven published approaches, as a teacher reads them.
//
// The property: a teacher can READ what a tutor built on an approach is
// actually told. 1.1.135's argument for letting a teacher author a tutor is
// that its approach must be one somebody can read — an invisible approach
// cannot be, and before this the seven were invisible to a teacher entirely.

import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { PublishedApproach } from "@/lib/teacherApi";
import { PublishedApproachList } from "@/components/teacher/research/PublishedApproachList";

// 1.1.108 — teacher screens follow the person's language, Danish by default.
// These tests assert the English copy, so they render inside an English
// context; the Danish default has its own assertion in teacherResearchLocale.test.tsx.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const result = rtlRender(wrap(ui), options);
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
}

const CATALOGUE: PublishedApproach[] = [
  {
    id: "esru",
    label: "Question-and-use cycle (ESRU)",
    summary: "Elicit, student responds, recognise, use.",
    status: "published",
    register: null,
    instruction: "Ask one question. Wait. Use what the student said in your next turn.",
    constructs: [
      {
        name: "Recognise",
        summary: "Show you heard the answer.",
        behaviours: ["Revoice the student's words.", "Avoid evaluative praise."],
      },
    ],
  },
];

beforeEach(() => {
  vi.spyOn(teacherApi, "fetchApproachCatalogue").mockResolvedValue(CATALOGUE);
});
afterEach(() => vi.restoreAllMocks());

describe("PublishedApproachList", () => {
  it("lists the approaches without opening any of them", async () => {
    render(<PublishedApproachList />);

    expect(await screen.findByText("Question-and-use cycle (ESRU)")).toBeInTheDocument();
    // Collapsed by default: seven prompts stacked open is a wall of text.
    expect(screen.queryByText(/Ask one question/)).not.toBeInTheDocument();
  });

  it("shows what the tutor is actually told, verbatim", async () => {
    render(<PublishedApproachList />);
    await screen.findByText("Question-and-use cycle (ESRU)");

    await userEvent.click(screen.getByLabelText(/Read this approach: Question-and-use cycle/));
    // The reviewability principle TutorPicker already states, honoured here:
    // the teacher can always see what the tutor is told.
    expect(screen.getByText(/Ask one question\. Wait\./)).toBeInTheDocument();
    expect(screen.getByText("Recognise")).toBeInTheDocument();
    expect(screen.getByText("Revoice the student's words.")).toBeInTheDocument();
  });

  it("offers no way to edit anything", async () => {
    // Read-only BY CONSTRUCTION: the payload has no editor state in it, so
    // there is nothing to hide. A test that only checked for absent buttons
    // would pass against a version that merely hid them.
    render(<PublishedApproachList />);
    await screen.findByText("Question-and-use cycle (ESRU)");
    await userEvent.click(screen.getByLabelText(/Read this approach/));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit|save|revert/i })).not.toBeInTheDocument();
  });

  it("degrades to a message rather than taking the tier with it", async () => {
    vi.spyOn(teacherApi, "fetchApproachCatalogue").mockRejectedValue(new Error("read approach catalogue: 403"));
    render(<PublishedApproachList />);
    await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument());
  });
});
