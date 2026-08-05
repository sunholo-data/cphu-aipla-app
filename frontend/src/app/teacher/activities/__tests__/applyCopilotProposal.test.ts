import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useActivityBuilder } from "@/hooks/useActivityBuilder";
import type { ActivityConfigPayload } from "@/lib/teacherApi";

import { applyCopilotProposal } from "../applyCopilotProposal";

/**
 * The co-pilot's `set_activity_facets` Apply path (1.1.61 M3).
 *
 * Propose-only is enforced on the backend; what matters here is that Applying a
 * proposal behaves like the teacher making the same edit by hand — additive
 * where additive is expected, and never clearing a field the proposal did not
 * mention.
 */
describe("applyCopilotProposal — set_activity_facets", () => {
  it("applies subject, level and tags to the builder", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() =>
      applyCopilotProposal(
        { kind: "set_activity_facets", subject: "Fysik", level: "B", tags: ["lab"], label: "x" },
        result.current,
      ),
    );
    expect(result.current.subject).toBe("Fysik");
    expect(result.current.level).toBe("B");
    expect(result.current.tags).toEqual(["lab"]);
  });

  it("MERGES tags rather than replacing them", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.hydrate({ tags: ["min-egen"] } as ActivityConfigPayload));
    act(() =>
      applyCopilotProposal(
        { kind: "set_activity_facets", subject: null, level: null, tags: ["lab"], label: "x" },
        result.current,
      ),
    );
    expect(result.current.tags).toEqual(["min-egen", "lab"]);
  });

  it("does not duplicate a tag the activity already carries", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.hydrate({ tags: ["lab"] } as ActivityConfigPayload));
    act(() =>
      applyCopilotProposal(
        { kind: "set_activity_facets", subject: null, level: null, tags: ["lab"], label: "x" },
        result.current,
      ),
    );
    expect(result.current.tags).toEqual(["lab"]);
  });

  it("leaves fields the proposal did not mention ALONE (never clears them)", () => {
    // "add the tag lab" must not drop a subject the teacher set by hand.
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.hydrate({ subject: "Fysik", level: "A" } as ActivityConfigPayload));
    act(() =>
      applyCopilotProposal(
        { kind: "set_activity_facets", subject: null, level: null, tags: ["lab"], label: "x" },
        result.current,
      ),
    );
    expect(result.current.subject).toBe("Fysik");
    expect(result.current.level).toBe("A");
    expect(result.current.tags).toEqual(["lab"]);
  });

  it("the applied facets reach the save payload", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() =>
      applyCopilotProposal(
        { kind: "set_activity_facets", subject: "Fysik", level: "C", tags: ["eksamen"], label: "x" },
        result.current,
      ),
    );
    const payload = result.current.toSavePayload();
    expect(payload.subject).toBe("Fysik");
    expect(payload.level).toBe("C");
    expect(payload.tags).toEqual(["eksamen"]);
  });
});
