import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Capture the tutor-state push (mcp_app_context.calculator.state).
const pushCalc = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/useSimSnapshotPush", () => ({ useSimSnapshotPush: () => pushCalc }));

// Capture the human-tool-use card dispatch (the "shared with the AI" trust bit).
const dispatch = vi.fn();
vi.mock("@/hooks/useHumanToolEvents", () => ({ useHumanToolEvents: () => ({ dispatch }) }));

import { WorkbenchCalculator, type CalculatorElementDef } from "../WorkbenchCalculator";

const CALC: CalculatorElementDef = {
  id: "calc1",
  title: "Fart",
  formula: "s / t",
  inputs: [
    { id: "s", label: "Strækning", unit: "m" },
    { id: "t", label: "Tid", unit: "s" },
  ],
};

describe("WorkbenchCalculator", () => {
  it("renders the inputs and the formula", () => {
    render(<WorkbenchCalculator skillId="s" calculators={[CALC]} />);
    expect(screen.getByLabelText("Strækning")).toBeInTheDocument();
    expect(screen.getByLabelText("Tid")).toBeInTheDocument();
    expect(screen.getByText("s / t =")).toBeInTheDocument();
  });

  it("shows — until every input is filled, then computes the result", () => {
    render(<WorkbenchCalculator skillId="s" calculators={[CALC]} />);
    expect(screen.getByLabelText("Resultat")).toHaveTextContent("—");
    fireEvent.change(screen.getByLabelText("Strækning"), { target: { value: "10" } });
    expect(screen.getByLabelText("Resultat")).toHaveTextContent("—"); // t still empty
    fireEvent.change(screen.getByLabelText("Tid"), { target: { value: "2" } });
    expect(screen.getByLabelText("Resultat")).toHaveTextContent("5");
  });

  it("pushes the inputs + computed result to the tutor on blur (1.1.45)", () => {
    render(<WorkbenchCalculator skillId="s" sessionId="sess-1" calculators={[CALC]} />);
    fireEvent.change(screen.getByLabelText("Strækning"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Tid"), { target: { value: "10" } });
    fireEvent.blur(screen.getByLabelText("Tid"));

    expect(pushCalc).toHaveBeenCalledTimes(1);
    const [snap, kind] = pushCalc.mock.calls[0];
    // Passive context (no proactive auto-fire) — the tutor sees it next turn.
    expect(kind).toBe("calculator.commit");
    expect(snap.calculators[0].result).toBe("10"); // 100 / 10
    expect(snap.calculators[0].inputs).toEqual([
      { label: "Strækning", value: "100", unit: "m" },
      { label: "Tid", value: "10", unit: "s" },
    ]);
  });

  it("surfaces a 'shared with the AI' card naming the computed value (trust bit)", () => {
    render(<WorkbenchCalculator skillId="s" sessionId="sess-1" calculators={[CALC]} />);
    fireEvent.change(screen.getByLabelText("Strækning"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Tid"), { target: { value: "10" } });
    fireEvent.blur(screen.getByLabelText("Tid"));

    expect(dispatch).toHaveBeenCalledTimes(1);
    const arg = dispatch.mock.calls[0][0];
    expect(arg.label).toMatch(/Fart = 10/); // title + computed result
    expect(typeof arg.push).toBe("function"); // reuses the in-flight request
  });

  it("does not dispatch a card while the calculator is incomplete (no result)", () => {
    render(<WorkbenchCalculator skillId="s" sessionId="sess-1" calculators={[CALC]} />);
    const s = screen.getByLabelText("Strækning");
    fireEvent.change(s, { target: { value: "100" } }); // t still empty → no result
    fireEvent.blur(s);
    expect(pushCalc).toHaveBeenCalledTimes(1); // state still synced to the tutor
    expect(dispatch).not.toHaveBeenCalled(); // but no card for a half-filled calc
  });

  it("does not re-push or re-card when nothing changed (dedup)", () => {
    render(<WorkbenchCalculator skillId="s" sessionId="sess-1" calculators={[CALC]} />);
    const t = screen.getByLabelText("Tid");
    fireEvent.change(screen.getByLabelText("Strækning"), { target: { value: "100" } });
    fireEvent.change(t, { target: { value: "10" } });
    fireEvent.blur(t);
    fireEvent.blur(t); // same state → no second push
    expect(pushCalc).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  pushCalc.mockClear();
  dispatch.mockClear();
});
