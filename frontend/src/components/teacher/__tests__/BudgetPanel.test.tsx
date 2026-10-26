import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BudgetPanel } from "@/components/teacher/BudgetPanel";
import * as costApi from "@/lib/costApi";
import type { ClassSpendPayload } from "@/lib/costApi";

// 1.1.108 M2 — these tests assert the English copy; a teacher's default
// language is Danish, so render inside an English locale.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const r = rtlRender(wrap(ui), options);
  return { ...r, rerender: (next: ReactElement) => r.rerender(wrap(next)) };
}

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
    expect(line).toHaveTextContent("Includes voice €0.120");
    expect(line).toHaveTextContent("STT €0.100");
    expect(line).toHaveTextContent("TTS €0.020");
  });

  it("lists each lesson day with its cost, replies and groups", async () => {
    vi.spyOn(costApi, "fetchClassSpend").mockResolvedValue(
      payload({
        by_day: [
          { day: "2026-10-20", eur: 0.1367, replies: 60, groups: 4 },
          { day: "2026-10-05", eur: 0.5006, replies: 255, groups: 9 },
        ],
      }),
    );
    render(<BudgetPanel classId="c-1" />);
    const list = await screen.findByTestId("spend-by-day");
    const rows = list.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector("time")).toHaveAttribute("dateTime", "2026-10-20");
    expect(rows[0]).toHaveTextContent("Tue 20 Oct");
    expect(rows[0]).toHaveTextContent("60 replies · 4 groups");
    expect(rows[0]).toHaveTextContent("€0.137");
    expect(rows[1]).toHaveTextContent("€0.501");
  });

  it("names activities by title, falling back to the id", async () => {
    vi.spyOn(costApi, "fetchClassSpend").mockResolvedValue(
      payload({
        by_activity: [
          { activity_id: "act-1", skill_id: "uuid-1", title: "Den hoppende bold", eur: 2.5 },
          { activity_id: null, skill_id: "kinebot", title: null, eur: 1.7 },
        ],
      }),
    );
    render(<BudgetPanel classId="c-1" />);
    expect(await screen.findByText("Den hoppende bold")).toBeInTheDocument();
    expect(screen.getByText("kinebot")).toBeInTheDocument();
    expect(screen.queryByText("uuid-1")).not.toBeInTheDocument();
  });

  it("omits the voice line when there is no voice cost", async () => {
    vi.spyOn(costApi, "fetchClassSpend").mockResolvedValue(payload());
    render(<BudgetPanel classId="c-1" />);
    await waitFor(() => expect(screen.getByText("boldkast")).toBeInTheDocument());
    expect(screen.queryByTestId("voice-cost-line")).not.toBeInTheDocument();
  });
});
