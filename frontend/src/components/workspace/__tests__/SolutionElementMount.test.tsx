import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const pushSolution = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/useSimSnapshotPush", () => ({
  useSimSnapshotPush: () => pushSolution,
}));

const onProactiveTrigger = vi.fn();
const optsRef = { current: { skillId: "s", onProactiveTrigger } };
vi.mock("@/contexts/ProactiveSimContext", () => ({
  useOptionalProactiveSimOptsRef: () => optsRef,
}));

// The lazy TipTap editor — expose its onSubmit via a button (TipTap itself is
// covered by WorkbenchSolution's own concerns; here we test the mount wiring).
vi.mock("../WorkbenchSolution", () => ({
  WorkbenchSolution: ({ onSubmit }: { onSubmit: (md: string, doc: unknown) => void }) => (
    <button onClick={() => onSubmit("# min løsning", { type: "doc" })}>submit</button>
  ),
}));

import { SolutionElementMount } from "../SolutionElementMount";

afterEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe("SolutionElementMount (1.1.45 M4)", () => {
  it("on submit, pushes the solution to context AND triggers a feedback turn", async () => {
    render(
      <SolutionElementMount skillId="phys" sessionId="sess-1" solution={[{ id: "sol-1", prompt: "Solve" }]} />,
    );
    fireEvent.click(await screen.findByText("submit"));

    // The solution rides the iframe-context wire (mcp_app_context.solution.state)…
    await waitFor(() =>
      expect(pushSolution).toHaveBeenCalledWith({ markdown: "# min løsning" }, "solution.submit"),
    );
    // …and a feedback turn is triggered with a NON-EMPTY message (ag_ui_adk drops
    // empty-content turns) — this is what makes the tutor actually respond.
    await waitFor(() => expect(onProactiveTrigger).toHaveBeenCalledTimes(1));
    expect(onProactiveTrigger.mock.calls[0][0]).toMatch(/\S/);
  });

  it("renders nothing when there is no solution element", () => {
    const { container } = render(<SolutionElementMount skillId="s" solution={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("persists the submitted draft to sessionStorage (reload survives)", async () => {
    render(
      <SolutionElementMount skillId="phys" sessionId="sess-1" solution={[{ id: "sol-1", prompt: "" }]} />,
    );
    fireEvent.click(await screen.findByText("submit"));
    await waitFor(() => expect(window.sessionStorage.getItem("aipla:solution:phys")).toContain("doc"));
  });
});
