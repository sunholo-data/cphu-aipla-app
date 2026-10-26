/**
 * /teacher/insights/cost — the smart-tier share line (1.1.142 M4).
 *
 * The backend folds tutor turns into a share answered by the smart model, split
 * by WHY (fail-over / image escalation / activity opt-in / not recorded), with a
 * configurable warning threshold. The page shows the line and, only above the
 * threshold, a visible warning — no alerting infrastructure.
 */
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";
import type { CostInsightsPayload } from "@/lib/costApi";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/hooks/useIsResearcher", () => ({ useIsResearcher: () => true }));
vi.mock("@/components/teacher/insights/InsightsTabs", () => ({ InsightsTabs: () => null }));

const mockFetch = vi.fn<(period: string) => Promise<CostInsightsPayload>>();
vi.mock("@/lib/costApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/costApi")>();
  return { ...actual, fetchCostInsights: (p: string) => mockFetch(p) };
});

import TeacherCostInsightsPage from "../page";

function render(ui: ReactElement) {
  return rtlRender(<LocaleProvider locale="en">{ui}</LocaleProvider>);
}

function payload(smart_tier?: CostInsightsPayload["smart_tier"]): CostInsightsPayload {
  return {
    currency: "EUR",
    period: "this_month",
    total_eur: 1.23,
    by_cohort: [],
    by_model: [],
    per_class: [],
    voice_eur: 0,
    voice_units: 0,
    by_voice_kind: [],
    smart_tier,
  };
}

afterEach(() => mockFetch.mockReset());

describe("cost page — smart-tier share", () => {
  it("shows the share and the split by route, with no warning under the threshold", async () => {
    mockFetch.mockResolvedValue(
      payload({
        turns: 100,
        smart_turns: 12,
        share: 0.12,
        by_route: { failover: 2, escalation: 8, opt_in: 2, unattributed: 0 },
        threshold: 0.25,
        over_threshold: false,
      }),
    );
    render(<TeacherCostInsightsPage />);

    await waitFor(() => expect(screen.getByText("Tutor turns on the smart model")).toBeInTheDocument());
    expect(screen.getByText(/12% of tutor turns \(12 of 100\)/)).toBeInTheDocument();
    const escalationRow = screen.getByText("Escalation (the student sent an image)").closest("tr");
    expect(escalationRow).toHaveTextContent("8");
    expect(screen.getByText("Fail-over (the default model failed)")).toBeInTheDocument();
    expect(screen.getByText("Opt-in (the activity is set to the smart model)")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("raises a visible warning line above the threshold", async () => {
    mockFetch.mockResolvedValue(
      payload({
        turns: 10,
        smart_turns: 4,
        share: 0.4,
        by_route: { failover: 0, escalation: 0, opt_in: 4, unattributed: 0 },
        threshold: 0.25,
        over_threshold: true,
      }),
    );
    render(<TeacherCostInsightsPage />);

    const warning = await screen.findByRole("status");
    expect(warning).toHaveTextContent("40%");
    expect(warning).toHaveTextContent("25%");
  });

  it("renders without the line on a backend that does not send it", async () => {
    mockFetch.mockResolvedValue(payload(undefined));
    render(<TeacherCostInsightsPage />);

    await waitFor(() => expect(screen.getByText("By cohort")).toBeInTheDocument());
    expect(screen.queryByText("Tutor turns on the smart model")).not.toBeInTheDocument();
  });
});
