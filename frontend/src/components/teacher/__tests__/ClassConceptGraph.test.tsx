// CONCEPT-2 M5 — the class's concepts across the year.
//
// The property this file defends: a class's standing on a concept is the SPREAD
// of its groups, never a union. 1.1.121 M0 proposed the union; a view that
// rendered one would pass a naive "the concept appears" test, so every
// assertion here is about the split being VISIBLE.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithTeacherAuth: (...args: unknown[]) => mockFetch(...args),
}));

import { ClassConceptGraph } from "@/components/teacher/ClassConceptGraph";

const ROLLUP = {
  classId: "cls-1",
  groups: ["grp-a", "grp-b", "grp-c"],
  classGroups: ["grp-a", "grp-b", "grp-c", "grp-d"],
  edges: [{ from: "vektorer", to: "projektil" }],
  concepts: [
    {
      concept: "Vektorer",
      key: "vektorer",
      byGroup: { "grp-a": "demonstrated", "grp-b": "not_yet", "grp-c": "partial" },
      counts: { demonstrated: 1, partial: 1, not_yet: 1 },
      activityIds: ["act-1"],
      flags: [{ groupId: "grp-b", kind: "provenance" }],
    },
    {
      concept: "Projektil",
      key: "projektil",
      byGroup: { "grp-a": "partial" },
      counts: { demonstrated: 0, partial: 1, not_yet: 0 },
      activityIds: ["act-1", "act-2"],
      flags: [],
    },
  ],
};

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("ClassConceptGraph", () => {
  it("renders every concept with a segment per status, not one winning colour", async () => {
    mockFetch.mockResolvedValue(ok(ROLLUP));
    render(<ClassConceptGraph classId="cls-1" />);

    await screen.findByTestId("class-concept-graph");
    expect(screen.getByTestId("concept-node-vektorer")).toBeInTheDocument();
    // One group in each of three states → three segments. A union would render
    // this node as a single "demonstrated".
    expect(screen.getByTestId("spread-vektorer-demonstrated")).toBeInTheDocument();
    expect(screen.getByTestId("spread-vektorer-partial")).toBeInTheDocument();
    expect(screen.getByTestId("spread-vektorer-not_yet")).toBeInTheDocument();
  });

  it("shows groups that never met a concept as their own segment, not as not_yet", async () => {
    mockFetch.mockResolvedValue(ok(ROLLUP));
    render(<ClassConceptGraph classId="cls-1" />);
    await screen.findByTestId("class-concept-graph");

    // The class has four groups; one has no record for Vektorer at all.
    expect(screen.getByTestId("spread-vektorer-notSeen")).toBeInTheDocument();
    // Projektil: only grp-a has a record, so three groups never met it and
    // NONE of them is counted as having failed to show it.
    expect(screen.getByTestId("spread-projektil-notSeen")).toBeInTheDocument();
    expect(screen.queryByTestId("spread-projektil-not_yet")).not.toBeInTheDocument();
  });

  it("names every group on a selected concept, including the ones with no record", async () => {
    mockFetch.mockResolvedValue(ok(ROLLUP));
    render(<ClassConceptGraph classId="cls-1" />);
    await screen.findByTestId("class-concept-graph");

    await userEvent.click(screen.getByTestId("concept-node-vektorer"));
    const detail = await screen.findByTestId("class-concept-detail");
    expect(detail).toHaveTextContent("grp-a");
    expect(detail).toHaveTextContent("forstået");
    expect(detail).toHaveTextContent("på vej");
    expect(detail).toHaveTextContent("ikke vist endnu");
    // grp-d has no record — named, and named as absent rather than as failing.
    expect(detail).toHaveTextContent("grp-d");
    expect(detail).toHaveTextContent("har ikke mødt begrebet");
  });

  it("flags a conflict inside one group, and flags nothing for groups that merely differ", async () => {
    mockFetch.mockResolvedValue(ok(ROLLUP));
    render(<ClassConceptGraph classId="cls-1" />);
    await screen.findByTestId("class-concept-graph");
    await userEvent.click(screen.getByTestId("concept-node-vektorer"));

    // grp-b's own evidence disagrees with itself — that is a conflict.
    expect(await screen.findByTestId("flag-grp-b-provenance")).toBeInTheDocument();
    // grp-a and grp-c hold different statuses from each other, which is the
    // class's SHAPE and must never be dressed up as a problem.
    expect(screen.queryByTestId("flag-grp-a-provenance")).not.toBeInTheDocument();
    expect(screen.queryByTestId("flag-grp-c-provenance")).not.toBeInTheDocument();
  });

  it("records the teacher's own read for one group and re-reads the store", async () => {
    mockFetch.mockResolvedValue(ok(ROLLUP));
    render(<ClassConceptGraph classId="cls-1" />);
    await screen.findByTestId("class-concept-graph");
    await userEvent.click(screen.getByTestId("concept-node-vektorer"));

    mockFetch.mockClear();
    mockFetch.mockResolvedValue(ok(ROLLUP));
    await userEvent.click(screen.getByLabelText("Sæt Vektorer til forstået for grp-b"));

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/proxy/api/classes/cls-1/concept-override");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      concept: "Vektorer",
      groupId: "grp-b",
      status: "demonstrated",
    });
    // The server writes to every activity that maps the concept, so the panel
    // must re-read rather than patch its own guess in.
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(1));
  });

  it("shows a designed empty state before any group has been checked off", async () => {
    mockFetch.mockResolvedValue(ok({ ...ROLLUP, concepts: [], edges: [], groups: [] }));
    render(<ClassConceptGraph classId="cls-1" />);
    expect(await screen.findByTestId("class-concept-empty")).toBeInTheDocument();
  });

  it("degrades to a message when the rollup cannot be read — never takes the page with it", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    render(<ClassConceptGraph classId="cls-1" />);
    await waitFor(() => expect(screen.getByText(/kunne ikke hentes/i)).toBeInTheDocument());
  });
});
