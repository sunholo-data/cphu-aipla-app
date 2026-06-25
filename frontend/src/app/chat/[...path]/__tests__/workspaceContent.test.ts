import { describe, expect, it } from "vitest";

import { workspaceContentKind } from "../workspaceContent";

describe("workspaceContentKind — workspace composer dispatch", () => {
  it("returns 'elements' when any workspace surface is present", () => {
    // The caller folds `activeArtefact != null` and every authored element
    // (checklist, table, chart, …) into this single boolean. USR-1: a sim is
    // an artefact, so it arrives here as `true` — no slug special-casing.
    expect(workspaceContentKind(true)).toBe("elements");
  });

  it("returns 'none' when there is no workspace surface (chat-only)", () => {
    expect(workspaceContentKind(false)).toBe("none");
  });
});
