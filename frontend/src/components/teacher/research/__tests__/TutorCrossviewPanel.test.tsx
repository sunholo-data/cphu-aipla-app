import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { CrossviewApproach, TutorCrossview } from "@/lib/teacherApi";
import { TutorCrossviewPanel } from "@/components/teacher/research/TutorCrossviewPanel";

function approach(over: Partial<CrossviewApproach> = {}): CrossviewApproach {
  return {
    id: "esru",
    label: "ESRU",
    authored: false,
    authorUid: null,
    authorRole: null,
    status: "ready_for_review",
    register: null,
    constructs: 4,
    sources: 3,
    tutorsAssigned: 1,
    turns: 48,
    sessions: 8,
    ...over,
  };
}

function view(over: Partial<TutorCrossview> = {}): TutorCrossview {
  return {
    usageAvailable: true,
    publishedApproaches: [approach()],
    authoredApproaches: [],
    tutors: [],
    variantCount: 0,
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("researcher cross-view (1.1.91 M4)", () => {
  it("shows teacher-authored approaches beside the published ones, with the author", async () => {
    vi.spyOn(teacherApi, "fetchTutorCrossview").mockResolvedValue(
      view({
        authoredApproaches: [
          approach({ id: "custom-warm-coach", label: "Warm coach", authored: true, authorRole: "teacher", turns: 0 }),
        ],
      }),
    );
    render(<TutorCrossviewPanel />);

    expect(await screen.findByText("Warm coach")).toBeInTheDocument();
    expect(screen.getByText("teacher")).toBeInTheDocument();
    // And the published ones, for comparison — the teacher list alone is not
    // the point.
    expect(screen.getByText("ESRU")).toBeInTheDocument();
  });

  it("keeps INTENT and USE as separate columns", async () => {
    // An approach assigned once and never run is not busy. Conflating the two
    // would say it was.
    vi.spyOn(teacherApi, "fetchTutorCrossview").mockResolvedValue(
      view({ publishedApproaches: [approach({ tutorsAssigned: 3, turns: 0 })] }),
    );
    render(<TutorCrossviewPanel />);

    expect(await screen.findByText(/counts how many tutors name an approach/i)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders an unreadable usage column BLANK, not as zero, and says why", async () => {
    // "Never used" is a finding about an approach; "could not read" is a fact
    // about a query. Rendering the second as the first is the deploy-status
    // footgun in a research column.
    vi.spyOn(teacherApi, "fetchTutorCrossview").mockResolvedValue(
      view({ usageAvailable: false, publishedApproaches: [approach({ turns: null, sessions: null })] }),
    );
    render(<TutorCrossviewPanel />);

    expect(await screen.findByRole("status")).toHaveTextContent(/blank rather than zero/i);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("links a used approach to its actual conversations", async () => {
    // The fix for the thing that got lost: "what the approach SAYS" and "what
    // it PRODUCED" were two unlinked pages, so a reader had to already know the
    // Conversations surface existed. The turn count is now the way in.
    vi.spyOn(teacherApi, "fetchTutorCrossview").mockResolvedValue(
      view({ publishedApproaches: [approach({ id: "authentic-dialogue", label: "Authentic Dialogue", turns: 48 })] }),
    );
    render(<TutorCrossviewPanel />);

    const link = await screen.findByRole("link", { name: "48" });
    expect(link).toHaveAttribute("href", "/teacher/research/logs?approach=authentic-dialogue");
  });

  it("does not link an approach that has taught nothing", async () => {
    // A link to an empty tab is a promise the page cannot keep.
    vi.spyOn(teacherApi, "fetchTutorCrossview").mockResolvedValue(
      view({ publishedApproaches: [approach({ turns: 0 })] }),
    );
    render(<TutorCrossviewPanel />);
    await screen.findByText("ESRU");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("reports zero variants as built-and-unused, not as absent", async () => {
    vi.spyOn(teacherApi, "fetchTutorCrossview").mockResolvedValue(view({ variantCount: 0 }));
    render(<TutorCrossviewPanel />);
    expect(await screen.findByText(/mechanism is built and unused/i)).toBeInTheDocument();
  });

  it("says a failed read is a failed read", async () => {
    vi.spyOn(teacherApi, "fetchTutorCrossview").mockRejectedValue(new Error("503"));
    render(<TutorCrossviewPanel />);
    expect(await screen.findByText(/failed read, not an empty one/i)).toBeInTheDocument();
  });
});
