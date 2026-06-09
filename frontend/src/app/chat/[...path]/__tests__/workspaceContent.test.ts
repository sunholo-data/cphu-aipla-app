import { describe, expect, it } from "vitest";

import { SIM_WORKSPACE_SLUGS, workspaceContentKind } from "../workspaceContent";

describe("workspaceContentKind — workspace composer dispatch", () => {
  it("returns 'sim' for each registered sim slug (regardless of checklist)", () => {
    for (const slug of SIM_WORKSPACE_SLUGS) {
      expect(workspaceContentKind(slug, false)).toBe("sim");
      expect(workspaceContentKind(slug, true)).toBe("sim");
    }
  });

  it("returns 'checklist' for a non-sim activity that has a checklist", () => {
    expect(workspaceContentKind("concept-dialogue", true)).toBe("checklist");
    expect(workspaceContentKind("0078a171-some-uuid", true)).toBe("checklist");
  });

  it("returns 'none' for a non-sim activity with no checklist (chat-only)", () => {
    expect(workspaceContentKind("concept-dialogue", false)).toBe("none");
  });

  it("returns 'none' when there is no skill slug yet", () => {
    expect(workspaceContentKind(null, false)).toBe("none");
    expect(workspaceContentKind(undefined, false)).toBe("none");
    // a checklist still wins even without a resolved slug
    expect(workspaceContentKind(null, true)).toBe("checklist");
  });

  it("keeps the three shipped sims in the registry", () => {
    expect(SIM_WORKSPACE_SLUGS.has("problem-set-hints")).toBe(true);
    expect(SIM_WORKSPACE_SLUGS.has("led-planck-tutor")).toBe(true);
    expect(SIM_WORKSPACE_SLUGS.has("kinebot-kinematics-tutor")).toBe(true);
  });
});
