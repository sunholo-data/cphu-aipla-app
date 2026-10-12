import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { AgreementCell, CalibrationRow, CalibrationSet } from "@/lib/teacherApi";
import { CalibrationSetPanel, toJsonl } from "@/components/teacher/research/CalibrationSetPanel";

function render(ui: ReactElement) {
  return rtlRender(<LocaleProvider locale="en">{ui}</LocaleProvider>);
}

function cell(over: Partial<AgreementCell> = {}): AgreementCell {
  return {
    n: 2,
    agree: 1,
    researcherHigher: 1,
    researcherLower: 0,
    unknown: 0,
    agreement: 0.5,
    confusion: { "partial->partial": 1, "partial->strong": 1 },
    ...over,
  };
}

function row(over: Partial<CalibrationRow> = {}): CalibrationRow {
  return {
    reviewId: "rev-1",
    runId: "s-1__fidelity:toulmin__fidelity-r3_fw2",
    sessionId: "s-1",
    frameworkId: "toulmin",
    construct: "data",
    aiBand: "partial",
    researcherBand: "strong",
    agrees: false,
    direction: "researcher_higher",
    aiRationale: "Asked for the measurements once.",
    aiCitations: [{ turn: 98, quote: "skarp observation", verified: true }],
    aiMoves: [],
    researcherEvidence: [98, 106],
    researcherRationale: "The tutor asked for the bounce heights twice.",
    rubricVersion: "fidelity-r3+fw2",
    promptVersion: "fidelity-r3",
    criteriaVersion: "2",
    model: "gemini-2.5-pro",
    modelSource: "judged-snapshot",
    judgedAt: null,
    reviewedAt: "2026-10-08T09:00:00+00:00",
    reviewerUid: "r-1",
    supersedes: null,
    ...over,
  };
}

function set(over: Partial<CalibrationSet> = {}): CalibrationSet {
  return {
    format: "aipla-calibration-r1",
    generatedAt: "2026-10-08T10:00:00+00:00",
    frameworkId: null,
    rows: [row(), row({ reviewId: "rev-2", researcherBand: "partial", agrees: true, direction: "agree", reviewerUid: "r-2" })],
    stats: {
      overall: cell(),
      byFramework: { toulmin: cell() },
      byConstruct: { toulmin: { data: cell(), warrant: cell({ n: 1, agree: 0, unknown: 1, agreement: null, researcherHigher: 0 }) } },
      reviewers: 2,
      multiRated: 1,
    },
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("calibration set (1.1.148)", () => {
  it("shows agreement per framework and construct, and a blank — not 0% — when nothing is comparable", async () => {
    vi.spyOn(teacherApi, "fetchCalibrationSet").mockResolvedValue(set());
    render(<CalibrationSetPanel />);
    expect(await screen.findByTestId("calibration-overall")).toHaveTextContent(
      "2 reviews by 2 researchers — the researcher agreed with the AI in 50%.",
    );
    expect(screen.getByText("1 construct was reviewed by more than one researcher — the sample for inter-rater agreement.")).toBeInTheDocument();
    const warrant = screen.getByText("warrant").closest("tr")!;
    expect(warrant).toHaveTextContent("—");
    expect(warrant).not.toHaveTextContent("0%");
  });

  it("downloads the rows as JSONL, one example per line", async () => {
    const data = set();
    vi.spyOn(teacherApi, "fetchCalibrationSet").mockResolvedValue(data);
    const created: Blob[] = [];
    const create = vi.fn((b: Blob) => {
      created.push(b);
      return "blob:cal";
    });
    Object.defineProperty(URL, "createObjectURL", { value: create, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    render(<CalibrationSetPanel />);
    await userEvent.click(await screen.findByRole("button", { name: /download the calibration set \(2 examples/i }));
    expect(create).toHaveBeenCalledTimes(1);
    const lines = toJsonl(data).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).researcherRationale).toBe("The tutor asked for the bounce heights twice.");
  });

  it("says when there is nothing yet, and when the read failed", async () => {
    vi.spyOn(teacherApi, "fetchCalibrationSet").mockResolvedValue(set({ rows: [] }));
    const { unmount } = render(<CalibrationSetPanel />);
    expect(await screen.findByText(/no researcher has reviewed a judgement yet/i)).toBeInTheDocument();
    unmount();
    vi.spyOn(teacherApi, "fetchCalibrationSet").mockRejectedValue(new Error("read failed: 403"));
    render(<CalibrationSetPanel />);
    expect(await screen.findByText(/a failed read, not an empty set/i)).toBeInTheDocument();
  });
});
