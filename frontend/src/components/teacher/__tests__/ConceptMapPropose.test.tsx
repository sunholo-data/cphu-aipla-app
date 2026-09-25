// CONCEPT-2 M3 — "Foreslå begrebskort": the button that makes the co-pilot's
// existing propose_concept_map tool findable.
//
// The tool shipped in CONCEPT-1 M2. On prod on 2026-09-25, exactly ONE of the
// 56 activities carrying a concept map was authored by hand rather than copied
// from a template — so what was missing was never the capability, it was a
// reason for a teacher to think of asking. This file pins both directions: the
// button asks when a co-pilot is mounted, and it is ABSENT when one is not,
// rather than present and dead.

// The concept-map section is behind a build-time flag read at module scope, so
// it must be set before ActivityBuilderBody is imported — hence vi.hoisted,
// which runs above the import hoisting.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONCEPT_MAP = "1";
});

vi.mock("@/components/teacher/SimPicker", () => ({ SimPicker: () => <div /> }));
vi.mock("@/components/teacher/MaterialsSection", () => ({ MaterialsSection: () => <div /> }));
vi.mock("@/components/teacher/ActivityPreview", () => ({ ActivityPreview: () => <div /> }));

import { ActivityBuilderBody } from "@/components/teacher/ActivityBuilderBody";
import { CopilotEntryContext } from "@/components/teacher/copilot/CopilotEntryContext";
import { useActivityBuilder } from "@/hooks/useActivityBuilder";

function Harness() {
  const builder = useActivityBuilder();
  return <ActivityBuilderBody builder={builder} footer={<span>f</span>} />;
}

/** Render the builder inside a stub copilot context — `registered` is what
 *  decides whether the surface has anything to ask. */
function withCopilot(registered: boolean) {
  const asked: string[] = [];
  const value = {
    registered: registered ? { title: "Medbygger", open: () => {} } : null,
    register: () => () => {},
    ask: (text: string) => {
      asked.push(text);
      return registered;
    },
  };
  render(
    <CopilotEntryContext.Provider value={value}>
      <Harness />
    </CopilotEntryContext.Provider>,
  );
  return asked;
}

describe("Foreslå begrebskort", () => {
  it("asks the page co-pilot for a draft when one is mounted", async () => {
    const asked = withCopilot(true);
    await userEvent.click(screen.getByRole("button", { name: /Add concept map/i }));
    await userEvent.click(screen.getByRole("button", { name: /Foreslå begrebskort/i }));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("begrebskort");
    // The request must carry what the map is FOR, not just ask for one: a draft
    // with no prerequisites and no bar per concept is the shape M1 and M0 both
    // need filled in.
    expect(asked[0]).toContain("bygger på");
    expect(asked[0]).toContain("forstået");
  });

  it("offers no button at all when no co-pilot is mounted", async () => {
    withCopilot(false);
    await userEvent.click(screen.getByRole("button", { name: /Add concept map/i }));
    // A control that silently does nothing is worse than no control — the
    // "shipped with the control unmounted" footgun from the other direction.
    expect(screen.queryByRole("button", { name: /Foreslå begrebskort/i })).not.toBeInTheDocument();
  });
});
