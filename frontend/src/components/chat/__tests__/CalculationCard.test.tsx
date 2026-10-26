import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";
import type { ToolCallState } from "@/hooks/useSkillAgent";

import { CalculationCard, parseCalculationResult } from "../CalculationCard";
import { MessageBubble } from "../MessageBubble";

vi.mock("@/components/protocols/A2UIRenderer", () => ({ A2UIRenderer: () => null }));
vi.mock("@/components/protocols/MCPAppToolCallRouter", () => ({ MCPAppToolCallRouter: () => null }));

/**
 * 1.1.152 M4 — the calculation a student SEES. Fixtures are real
 * `backend/maths/card.py` output (E = P·t for a 2000 W kettle over 150 s).
 */
const WORKING = "$P \\cdot t = 2000\\,\\text{W} \\cdot 150\\,\\text{s}$";
const SHOWN = JSON.stringify({
  ok: true,
  mode: "show",
  held: false,
  calc_id: "calc_f001b86fdf7ff09e",
  working: WORKING,
  latex: "$P \\cdot t = 2000\\,\\text{W} \\cdot 150\\,\\text{s} = 300\\,\\text{kJ}$",
  result: { value: 300.0, unit: "kJ" },
});
const HELD = JSON.stringify({
  ok: true,
  mode: "hold",
  held: true,
  calc_id: "calc_f001b86fdf7ff09e",
  working: WORKING,
  result_unit_latex: "\\text{kJ}",
  note: "The student sees the working WITHOUT the final value.",
});
const HELD_WRONG = JSON.stringify({
  ...JSON.parse(HELD),
  student: { value: "18000 kJ", status: "mismatch", direction: "too_large", hint: "time_unit", factor: 60.0 },
});
const HELD_MATCHED = JSON.stringify({
  ...JSON.parse(SHOWN),
  mode: "hold",
  student: { value: "300 kJ", status: "match" },
});
const WITH_G = JSON.stringify({
  ok: true,
  held: false,
  working: "$m \\cdot g = 70\\,\\text{kg} \\cdot 9{,}82\\,\\text{m}/\\text{s}^{2}$",
  latex: "$m \\cdot g = 70\\,\\text{kg} \\cdot 9{,}82\\,\\text{m}/\\text{s}^{2} = 687{,}4\\,\\text{N}$",
  constants_used: { g: "9.82 m/s^2" },
  result: { value: 687.4, unit: "N" },
});

describe("parseCalculationResult", () => {
  it("parses a shown and a held card", () => {
    expect(parseCalculationResult(SHOWN)).toMatchObject({ held: false, working: WORKING });
    expect(parseCalculationResult(HELD)).toMatchObject({ held: true, latex: null, resultUnitLatex: "\\text{kJ}" });
  });

  it("returns null for a refused, malformed or redacted result (the chip renders instead)", () => {
    expect(parseCalculationResult(JSON.stringify({ ok: false, error: "unknown symbol 'x'" }))).toBeNull();
    expect(parseCalculationResult("not json")).toBeNull();
    expect(parseCalculationResult(null)).toBeNull();
    expect(parseCalculationResult(JSON.stringify({ redacted: "server-only tool result" }))).toBeNull();
    // A "shown" card with no calculation in it is not a card.
    expect(parseCalculationResult(JSON.stringify({ ok: true, held: false, working: WORKING }))).toBeNull();
  });
});

describe("CalculationCard", () => {
  it("shows the whole calculation and says who computed it", () => {
    render(<CalculationCard result={parseCalculationResult(SHOWN)!} />);
    const card = screen.getByTestId("calculation-card");
    expect(card.dataset.held).toBe("false");
    expect(card.querySelector(".katex")).not.toBeNull(); // typeset, not raw `$…$`
    expect(card.textContent).not.toContain("$");
    expect(card.textContent).toContain("300");
    expect(screen.getByText("Platformen har regnet det ud, ikke AI'en.")).toBeInTheDocument();
  });

  it("on hold: the working with '?', no value, and the student's turn", () => {
    render(<CalculationCard result={parseCalculationResult(HELD)!} />);
    const card = screen.getByTestId("calculation-card");
    expect(card.dataset.held).toBe("true");
    expect(card.textContent).toContain("?");
    expect(card.textContent).toContain("150");
    expect(card.textContent).not.toContain("300");
    expect(screen.getByText(/Din tur/)).toBeInTheDocument();
  });

  it("on hold, a wrong answer gets the direction and its cause, still without the value", () => {
    render(<CalculationCard result={parseCalculationResult(HELD_WRONG)!} />);
    const feedback = screen.getByTestId("calculation-card-feedback");
    expect(feedback.textContent).toBe(
      "Dit svar (18000 kJ) er for stort. Det er en faktor 60 fra: kig på tidens enhed.",
    );
    expect(screen.getByTestId("calculation-card").textContent).not.toContain("300");
    expect(screen.queryByText(/Din tur/)).not.toBeInTheDocument();
  });

  it("a matching answer unlocks the result and says so", () => {
    render(<CalculationCard result={parseCalculationResult(HELD_MATCHED)!} />);
    expect(screen.getByTestId("calculation-card-feedback").textContent).toBe("Det passer med dit svar (300 kJ).");
    expect(screen.getByTestId("calculation-card").textContent).toContain("300");
  });

  it("names a constant the platform assumed", () => {
    render(<CalculationCard result={parseCalculationResult(WITH_G)!} />);
    expect(screen.getByText("Brugte g = 9.82 m/s^2")).toBeInTheDocument();
  });

  it("renders in English for an English activity", () => {
    render(
      <LocaleProvider locale="en">
        <CalculationCard result={parseCalculationResult(HELD_WRONG)!} />
      </LocaleProvider>,
    );
    expect(screen.getByText("Calculation")).toBeInTheDocument();
    expect(screen.getByTestId("calculation-card-feedback").textContent).toBe(
      "Your answer (18000 kJ) is too large. It is off by a factor of 60: look at the unit of time.",
    );
  });
});

describe("MessageBubble — show_calculation", () => {
  const bubble = (toolCalls: ToolCallState[]) => (
    <MessageBubble
      message={{ id: "bot-1", role: "assistant", content: "Se udregningen." }}
      skillId="s"
      userInitial="M"
      userDisplayName="M"
      toolCalls={toolCalls}
      navigateToBlock={vi.fn()}
      onAction={vi.fn()}
    />
  );

  it("renders the card, not a chip", () => {
    render(bubble([{ id: "tc-1", name: "show_calculation", status: "success", resultContent: SHOWN }]));
    expect(screen.getByTestId("calculation-card")).toBeInTheDocument();
    expect(screen.queryByText("show_calculation")).not.toBeInTheDocument();
  });

  it("draws the ENGINE's number even when the call's args carry a different one", () => {
    // The model's own arithmetic said 360 kJ (2000 W for 3 min); the engine was
    // given 150 s and computed 300 kJ. The card is the engine's.
    const argsJson = JSON.stringify({
      expression: "P * t",
      quantities: ["P = 2000 W", "t = 150 s"],
      result_unit: "kJ",
      student_value: "360 kJ",
    });
    render(bubble([{ id: "tc-1", name: "show_calculation", status: "success", resultContent: SHOWN, argsJson }]));
    const text = screen.getByTestId("calculation-card").textContent ?? "";
    expect(text).toContain("300");
    expect(text).not.toContain("360");
  });

  it("falls back to the chip for a refused call", () => {
    render(
      bubble([
        {
          id: "tc-1",
          name: "show_calculation",
          status: "success",
          resultContent: JSON.stringify({ ok: false, error: "dimensions differ" }),
        },
      ]),
    );
    expect(screen.queryByTestId("calculation-card")).not.toBeInTheDocument();
  });
});
