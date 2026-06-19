import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BudgetPanel } from "@/components/teacher/BudgetPanel";
import * as costApi from "@/lib/costApi";
import type { ClassSpendPayload } from "@/lib/costApi";

function payload(overrides: Partial<ClassSpendPayload> = {}): ClassSpendPayload {
  return {
    currency: "EUR",
    class_id: "c-1",
    period: "this_month",
    total_eur: 4.2,
    token_in: 1000,
    token_out: 500,
    projected_eur: 8.4,
    by_activity: [
      { skill_id: "boldkast", eur: 2.5 },
      { skill_id: "kinebot", eur: 1.7 },
    ],
    by_group: [{ group_id: "g-1", eur: 4.2 }],
    by_model: [{ model: "claude-sonnet-4-6", eur: 4.2 }],
    voice_eur: 0,
    by_voice_kind: [],
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("BudgetPanel", () => {
  it("renders total spend, projection and top activities", async () => {
    vi.spyOn(costApi, "fetchClassSpend").mockResolvedValue(payload());
    render(<BudgetPanel classId="c-1" />);

    await waitFor(() =>
      expect(screen.getByText(/projected €8.40 at current usage rate/)).toBeInTheDocument(),
    );
    // Total (€4.20) appears as the headline and again as the single group's spend.
    expect(screen.getAllByText("€4.20").length).toBeGreaterThan(0);
    expect(screen.getByText("boldkast")).toBeInTheDocument();
    expect(screen.getByText("kinebot")).toBeInTheDocument();
  });

  it("shows a no-spend message when total is zero", async () => {
    vi.spyOn(costApi, "fetchClassSpend").mockResolvedValue(
      payload({ total_eur: 0, projected_eur: 0, by_activity: [], by_group: [], by_model: [] }),
    );
    render(<BudgetPanel classId="c-1" />);
    await waitFor(() => expect(screen.getByText(/no spend recorded/i)).toBeInTheDocument());
  });

  it("surfaces an error", async () => {
    vi.spyOn(costApi, "fetchClassSpend").mockRejectedValue(new Error("boom"));
    render(<BudgetPanel classId="c-1" />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/boom/));
  });

  it("shows the voice cost line when voice_eur > 0 (1.1.9)", async () => {
    vi.spyOn(costApi, "fetchClassSpend").mockResolvedValue(
      payload({
        voice_eur: 0.12,
        by_voice_kind: [
          { kind: "stt", eur: 0.1 },
          { kind: "tts", eur: 0.02 },
        ],
      }),
    );
    render(<BudgetPanel classId="c-1" />);
    const line = await screen.findByTestId("voice-cost-line");
    expect(line).toHaveTextContent("Includes voice €0.12");
    expect(line).toHaveTextContent("STT €0.10");
    expect(line).toHaveTextContent("TTS €0.02");
  });

  it("omits the voice line when there is no voice cost", async () => {
    vi.spyOn(costApi, "fetchClassSpend").mockResolvedValue(payload());
    render(<BudgetPanel classId="c-1" />);
    await waitFor(() => expect(screen.getByText("boldkast")).toBeInTheDocument());
    expect(screen.queryByTestId("voice-cost-line")).not.toBeInTheDocument();
  });
});
