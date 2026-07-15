import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { ActivityPayload } from "@/lib/teacherApi";
import ResearchActivityDetailPage from "@/app/teacher/research/activities/[id]/page";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "act-x" }) }));

// ConceptMapView renders an SVG that isn't the focus here; keep it simple.
vi.mock("@/components/workspace/ConceptMapView", () => ({
  ConceptMapView: () => <div data-testid="concept-map-view" />,
}));

function makeActivity(overrides: Partial<ActivityPayload> = {}): ActivityPayload {
  return {
    activityId: "act-x",
    ownerUid: "owner-1",
    ownerLabel: "Ms. Hansen",
    skillId: "concept-dialogue",
    visibility: "published",
    classId: "",
    teacherUid: "owner-1",
    title: "Kastebevægelse",
    teachingGoal: "Undersøg skråt kast.",
    language: "da",
    difficulty: "standard",
    pairedWorkbench: null,
    workbenchType: "none",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("ResearchActivityDetailPage (RVIEW-1 M1)", () => {
  it("renders the full read-only config: goal, setup, and each element in detail", async () => {
    vi.spyOn(teacherApi, "fetchActivity").mockResolvedValue(
      makeActivity({
        checklist: [
          { id: "s1", label: "Opstil forsøget" },
          { id: "s2", label: "Mål 5 gange" },
        ],
        note: [{ id: "n1", title: "Tip", body: "Husk enheder." }],
        conceptMap: [
          {
            id: "m1",
            title: "Kast",
            nodes: [{ id: "vektorer", label: "Vektorer", checkQuestions: [{ id: "q1", prompt: "Dekomponér v?" }] }],
            edges: [],
          },
        ],
      }),
    );
    render(<ResearchActivityDetailPage />);

    expect(await screen.findByText("Undersøg skråt kast.")).toBeInTheDocument();
    expect(screen.getByText("Owner: Ms. Hansen")).toBeInTheDocument();
    // element detail (not just a badge): checklist items, note body, concept map
    expect(screen.getByText("Opstil forsøget")).toBeInTheDocument();
    expect(screen.getByText("Husk enheder.")).toBeInTheDocument();
    expect(screen.getByTestId("concept-map-view")).toBeInTheDocument();
    expect(screen.getByText("Dekomponér v?")).toBeInTheDocument(); // the check question
  });

  it("shows a not-found state when the activity 404s", async () => {
    vi.spyOn(teacherApi, "fetchActivity").mockRejectedValue(new Error("get activity: 404 not found"));
    render(<ResearchActivityDetailPage />);
    expect(await screen.findByText("Activity not found")).toBeInTheDocument();
  });

  it("shows researcher-access-required on 403", async () => {
    vi.spyOn(teacherApi, "fetchActivity").mockRejectedValue(new Error("get activity: 403 forbidden"));
    render(<ResearchActivityDetailPage />);
    await waitFor(() => expect(screen.getByText("Researcher access required")).toBeInTheDocument());
  });
});
