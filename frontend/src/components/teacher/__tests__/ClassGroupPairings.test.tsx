// CONCEPT-2 M7 — who could talk to whom.
//
// Two properties, and the second matters more than the first: the panel names
// the CONCEPT a pair would exchange, and it never reports a standing. "Which
// groups are ahead" is one careless change from "which groups are behind", and
// a class can read a teacher's screen.

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithTeacherAuth: (...args: unknown[]) => mockFetch(...args),
}));

import { ClassGroupPairings } from "@/components/teacher/ClassGroupPairings";

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const PAIRS = {
  classId: "cls-1",
  pairs: [
    { groups: ["grp-a", "grp-b"], aGives: ["Vektorer"], bGives: ["Trigonometri"], mutual: true },
    { groups: ["grp-a", "grp-c"], aGives: ["Vektorer"], bGives: [], mutual: false },
  ],
};

beforeEach(() => mockFetch.mockReset());

describe("ClassGroupPairings", () => {
  it("names the concept each group in a pair could explain", async () => {
    mockFetch.mockResolvedValue(ok(PAIRS));
    render(<ClassGroupPairings classId="cls-1" />);

    const pair = await screen.findByTestId("pairing-grp-a-grp-b");
    expect(pair).toHaveTextContent("grp-a kan forklare: Vektorer");
    expect(pair).toHaveTextContent("grp-b kan forklare: Trigonometri");
    expect(pair).toHaveTextContent("kan bytte");
  });

  it("shows a one-way pair without calling it an exchange", async () => {
    mockFetch.mockResolvedValue(ok(PAIRS));
    render(<ClassGroupPairings classId="cls-1" />);

    const pair = await screen.findByTestId("pairing-grp-a-grp-c");
    expect(pair).toHaveTextContent("grp-a kan forklare: Vektorer");
    expect(pair).not.toHaveTextContent("kan bytte");
    expect(pair).not.toHaveTextContent("grp-c kan forklare");
  });

  it("reports no score, rank or position anywhere on the panel", async () => {
    // The leaderboard guard. If a number or an ordinal ever appears here,
    // someone has started answering a different question.
    mockFetch.mockResolvedValue(ok(PAIRS));
    render(<ClassGroupPairings classId="cls-1" />);
    await screen.findByTestId("class-group-pairings");
    // Scoped to the PAIRS, not the panel: the intro deliberately contains the
    // word "rangliste" to say the panel is not one.
    const rows = [screen.getByTestId("pairing-grp-a-grp-b"), screen.getByTestId("pairing-grp-a-grp-c")];
    for (const row of rows) {
      const text = row.textContent ?? "";
      expect(text).not.toMatch(/\b\d+\s*%/);
      expect(text).not.toMatch(/point|score|rangliste|nr\.|plads/i);
    }
  });

  it("shows a designed empty state when no pair has anything to exchange", async () => {
    mockFetch.mockResolvedValue(ok({ classId: "cls-1", pairs: [] }));
    render(<ClassGroupPairings classId="cls-1" />);
    expect(await screen.findByTestId("pairings-empty")).toBeInTheDocument();
  });

  it("degrades to a message rather than taking the class page with it", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    render(<ClassGroupPairings classId="cls-1" />);
    await waitFor(() => expect(screen.getByText(/kunne ikke hentes/i)).toBeInTheDocument());
  });
});
