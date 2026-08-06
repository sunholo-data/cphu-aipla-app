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

/**
 * 1.1.63 M1 — the attach path must CACHE THE TITLE.
 *
 * `MaterialRef.origin` is provenance ("uvm.dk", "Haka Fysik"), not a title, and
 * for a long time it was the only label cached at citation time — which is
 * exactly why the tutor cited domains at students. `title` fixes that, but only
 * if every attach site actually sets it.
 *
 * A field that is on the model and set by no write path is the shape of two
 * bugs this repo has already shipped: `subject` (on the model, unset for two
 * and a half weeks) and `ActivityConfig.language` (read into the config and
 * never used at all). These tests are the guard.
 */
describe("applyCopilotProposal — attach_material caches the title (1.1.63 M1)", () => {
  it("caches the doc title on the MaterialRef, not just the origin", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() =>
      applyCopilotProposal(
        {
          kind: "attach_material",
          materialKind: "curriculum",
          docId: "d1",
          origin: "mathematicus.dk",
          title: "Kastebevægelse — noter",
          label: "Kastebevægelse — noter",
        },
        result.current,
      ),
    );
    expect(result.current.materials[0]).toMatchObject({
      docId: "d1",
      origin: "mathematicus.dk",
      title: "Kastebevægelse — noter",
    });
  });

  it("falls back to the display label when a proposal predates the title field", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() =>
      applyCopilotProposal(
        {
          kind: "attach_material",
          materialKind: "curriculum",
          docId: "d1",
          origin: "uvm.dk",
          label: "Fysik B læreplan",
        },
        result.current,
      ),
    );
    expect(result.current.materials[0].title).toBe("Fysik B læreplan");
  });

  it("the cached title survives into the save payload", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() =>
      applyCopilotProposal(
        {
          kind: "attach_material",
          materialKind: "curriculum",
          docId: "d1",
          origin: "uvm.dk",
          title: "Fysik B læreplan",
          label: "Fysik B læreplan",
        },
        result.current,
      ),
    );
    const payload = result.current.toSavePayload();
    expect(payload.materials?.[0]).toMatchObject({ title: "Fysik B læreplan" });
  });
});
