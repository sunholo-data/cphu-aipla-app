import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FidelityPayload } from "@/lib/teacherApi";

import { TeachingApproachSection } from "../TeachingApproachSection";

const teacherPayload: FidelityPayload = {
  frameworkId: "esru",
  frameworkLabel: "Question-and-use cycle (ESRU)",
  abstained: false,
  abstainReason: "",
  summary: "The tutor asked open questions and revoiced the group's claim, then used the simulation once.",
  drift: ["The use phase came only after the sim run."],
  spokenIncluded: true,
  promptVersion: "fidelity-r1",
};

describe("TeachingApproachSection (1.1.107 M5)", () => {
  it("renders nothing when there is no read", () => {
    const { container } = render(<TeachingApproachSection fidelity={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a teacher the prose, the drift and the approach link — no bands", () => {
    render(<TeachingApproachSection fidelity={teacherPayload} />);
    expect(screen.getByRole("heading", { name: /Teaching approach/ })).toBeInTheDocument();
    expect(screen.getByText(/asked open questions/)).toBeInTheDocument();
    expect(screen.getByText("The use phase came only after the sim run.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Read about this approach/ })).toHaveAttribute("href", "/project/tutors/esru");
    expect(screen.getByText(/recorded discussion/)).toBeInTheDocument();
    expect(screen.queryByText(/Construct detail/)).not.toBeInTheDocument();
  });

  it("says not assessed, with the reason, when the judge abstained", () => {
    render(
      <TeachingApproachSection
        fidelity={{ ...teacherPayload, abstained: true, abstainReason: "too little dialogue to assess (2 tutor turns; need 3)" }}
      />,
    );
    expect(screen.getByText(/Not assessed — too little dialogue/)).toBeInTheDocument();
    expect(screen.queryByText(/asked open questions/)).not.toBeInTheDocument();
  });

  it("renders the construct table only when the payload carries it (researcher)", () => {
    render(
      <TeachingApproachSection
        fidelity={{
          ...teacherPayload,
          overallBand: "partial",
          model: "gemini-x",
          evidenceSummary: { units: 7, tutor: 4, student: 3 },
          constructs: {
            elicit: { band: "strong", score: 2, rationale: "Open questions throughout.", evidence: [0, 2] },
            use: { band: "partial", score: 1, rationale: "One use move, late.", evidence: [4, 6] },
          },
        }}
      />,
    );
    expect(screen.getByText(/Construct detail/)).toBeInTheDocument();
    expect(screen.getByText("elicit")).toBeInTheDocument();
    expect(screen.getByText("strong")).toBeInTheDocument();
    expect(screen.getAllByText("partial").length).toBeGreaterThan(0);
    expect(screen.getByText("0, 2")).toBeInTheDocument();
    expect(screen.getByText(/4 tutor \/ 3 student turns/)).toBeInTheDocument();
  });
});
