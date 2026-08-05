import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityFacetEditor } from "@/components/teacher/ActivityFacetEditor";
import {
  ActivityFilterBar,
  EMPTY_ACTIVITY_FILTERS,
  hasActiveFilters,
  toFilterParams,
  type ActivityFilters,
} from "@/components/teacher/ActivityFilterBar";
import type { CurriculumFacets } from "@/lib/curriculumApi";
import * as teacherApi from "@/lib/teacherApi";
import type { ActivityPayload } from "@/lib/teacherApi";

const FACETS: CurriculumFacets = {
  subjects: [
    { value: "Fysik", label: "Fysik", count: 3 },
    { value: "Matematik", label: "Matematik", count: 0 },
  ],
  levels: [
    { value: "A", label: "A", count: 2 },
    { value: "__unlevelled__", label: "No level", count: 1 },
  ],
  folders: [],
  tags: [{ value: "lab", label: "lab", count: 2 }],
};

function makeActivity(over: Partial<ActivityPayload> = {}): ActivityPayload {
  return {
    activityId: "act-1",
    ownerUid: "t1",
    skillId: "concept-dialogue",
    visibility: "private",
    classId: "",
    teacherUid: "t1",
    title: "Kast med bold",
    teachingGoal: "G",
    language: "da",
    difficulty: "standard",
    pairedWorkbench: null,
    updatedAt: "2026-08-05T00:00:00Z",
    tags: [],
    subject: null,
    level: null,
    ...over,
  } as ActivityPayload;
}

describe("toFilterParams / hasActiveFilters", () => {
  it("omits empty values rather than sending them blank", () => {
    expect(toFilterParams(EMPTY_ACTIVITY_FILTERS)).toEqual({
      q: undefined,
      level: undefined,
      subject: undefined,
      tags: undefined,
    });
  });

  it("trims the query and keeps tags as an array", () => {
    const f: ActivityFilters = { q: "  bold  ", level: "A", subject: "Fysik", tags: ["lab"] };
    expect(toFilterParams(f)).toEqual({ q: "bold", level: "A", subject: "Fysik", tags: ["lab"] });
  });

  it("whitespace-only search does not count as an active filter", () => {
    expect(hasActiveFilters({ ...EMPTY_ACTIVITY_FILTERS, q: "   " })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_ACTIVITY_FILTERS, q: "x" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_ACTIVITY_FILTERS, tags: ["lab"] })).toBe(true);
  });
});

describe("ActivityFilterBar", () => {
  it("renders subject options from the SERVER facets, not a hardcoded list", () => {
    render(<ActivityFilterBar facets={FACETS} filters={EMPTY_ACTIVITY_FILTERS} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Fysik/ })).toBeInTheDocument();
    // A zero-count option stays visible and clickable — the rail must not
    // reshuffle as you filter.
    expect(screen.getByRole("button", { name: /Matematik \(0\)/ })).toBeInTheDocument();
  });

  it("renders nothing for a facet the server returned empty", () => {
    render(
      <ActivityFilterBar
        facets={{ subjects: [], levels: [], folders: [], tags: [] }}
        filters={EMPTY_ACTIVITY_FILTERS}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/filter by subject/i)).not.toBeInTheDocument();
  });

  it("selecting a tag ADDS it (tags are AND-combinable, not exclusive)", () => {
    const onChange = vi.fn();
    render(
      <ActivityFilterBar
        facets={FACETS}
        filters={{ ...EMPTY_ACTIVITY_FILTERS, tags: ["exam"] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /lab/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: ["exam", "lab"] }));
  });

  it("shows active-filter chips and a clear-all that resets everything", () => {
    const onChange = vi.fn();
    render(
      <ActivityFilterBar
        facets={FACETS}
        filters={{ q: "bold", level: "A", subject: "Fysik", tags: ["lab"] }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("Filtering by")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenCalledWith(EMPTY_ACTIVITY_FILTERS);
  });

  it("renders the unlevelled sentinel by its label, never its raw value", () => {
    render(
      <ActivityFilterBar
        facets={FACETS}
        filters={{ ...EMPTY_ACTIVITY_FILTERS, level: "__unlevelled__" }}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText("__unlevelled__")).not.toBeInTheDocument();
    expect(screen.getAllByText(/No level/).length).toBeGreaterThan(0);
  });
});

describe("ActivityFacetEditor", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows inherited facets as NON-removable, unlike own tags", () => {
    render(
      <ActivityFacetEditor
        activity={makeActivity({ tags: ["min-egen"], inheritedTags: ["mekanik"], inheritedSubjects: ["Fysik"] })}
        facets={FACETS}
        onUpdated={() => {}}
      />,
    );
    // The teacher's own tag has a remove control...
    expect(screen.getByLabelText("Remove tag min-egen")).toBeInTheDocument();
    // ...the inherited one is shown but cannot be removed here: it belongs to
    // the cited document, and offering an X that cannot work would be a lie.
    expect(screen.getByText("mekanik")).toBeInTheDocument();
    expect(screen.queryByLabelText("Remove tag mekanik")).not.toBeInTheDocument();
    expect(screen.getByText("From its materials")).toBeInTheDocument();
  });

  it("hides the inherited section entirely when nothing is inherited", () => {
    render(<ActivityFacetEditor activity={makeActivity()} facets={FACETS} onUpdated={() => {}} />);
    expect(screen.queryByText("From its materials")).not.toBeInTheDocument();
  });

  it("adding a tag PATCHes only the facets endpoint (never the full activity)", async () => {
    const patch = vi
      .spyOn(teacherApi, "patchActivityFacets")
      .mockResolvedValue(makeActivity({ tags: ["lab"] }));
    const updateFull = vi.spyOn(teacherApi, "updateActivity");
    const onUpdated = vi.fn();

    render(<ActivityFacetEditor activity={makeActivity()} facets={FACETS} onUpdated={onUpdated} />);
    fireEvent.change(screen.getByLabelText("New tag"), { target: { value: "lab" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith("act-1", { addTags: ["lab"] }));
    // The load-bearing assertion: the full-overwrite path is NOT used from the
    // library row, because that row has no elements to send.
    expect(updateFull).not.toHaveBeenCalled();
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
  });

  it("clearing the subject sends an explicit clear, not an ambiguous null", async () => {
    const patch = vi.spyOn(teacherApi, "patchActivityFacets").mockResolvedValue(makeActivity());
    render(
      <ActivityFacetEditor activity={makeActivity({ subject: "Fysik" })} facets={FACETS} onUpdated={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "" } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith("act-1", { clearSubject: true }));
  });

  it("keeps an off-vocabulary subject selectable rather than silently dropping it", () => {
    render(
      <ActivityFacetEditor
        activity={makeActivity({ subject: "Astronomi" })}
        facets={FACETS}
        onUpdated={() => {}}
      />,
    );
    expect((screen.getByLabelText("Subject") as HTMLSelectElement).value).toBe("Astronomi");
  });

  it("surfaces a failed save instead of pretending it worked", async () => {
    vi.spyOn(teacherApi, "patchActivityFacets").mockRejectedValue(new Error("boom"));
    render(<ActivityFacetEditor activity={makeActivity()} facets={FACETS} onUpdated={() => {}} />);
    fireEvent.change(screen.getByLabelText("New tag"), { target: { value: "lab" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    expect(await screen.findByText(/could not save/i)).toBeInTheDocument();
  });
});
