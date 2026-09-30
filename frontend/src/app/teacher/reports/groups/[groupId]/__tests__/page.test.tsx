import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const groupId = "bold-kazoo-87";

vi.mock("next/navigation", () => ({
  useParams: () => ({ groupId }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));

vi.mock("@/lib/teacherApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/teacherApi")>(
    "@/lib/teacherApi",
  );
  return {
    ...actual,
    fetchGroupLatestReport: vi.fn(),
    getGroupReportTimeline: vi.fn(),
  };
});

import TeacherGroupReportPage from "@/app/teacher/reports/groups/[groupId]/page";
import {
  NotFoundError,
  type SessionSummaryPayload,
  fetchGroupLatestReport,
  getGroupReportTimeline,
} from "@/lib/teacherApi";

// 1.1.108 — teacher screens follow the person's language, Danish by default.
// These tests assert the English copy, so they render inside an English
// context; the Danish default has its own assertion in teacherResearchLocale.test.tsx.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const result = rtlRender(wrap(ui), options);
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
}

const fetchReport = vi.mocked(fetchGroupLatestReport);
const fetchTimeline = vi.mocked(getGroupReportTimeline);

const LIVE_REPORT: SessionSummaryPayload = {
  sessionId: "sess-12345678",
  groupCode: groupId,
  activityId: "Boldkast projectile motion",
  startedAt: "2026-06-15T09:30:00Z",
  endedAt: "2026-06-15T09:48:00Z",
  durationSeconds: 1080, // 18 min
  messageCount: 14,
  simRunCount: 5,
  conversation: [
    { timestamp: "2026-06-15T09:31:00Z", role: "student", content: "Hej, hjælp med opgave 1" },
    { timestamp: "2026-06-15T09:32:00Z", role: "tutor", content: "Hvilken delopgave vil du starte med?" },
  ],
  narrative: null,
};

beforeEach(() => {
  // A FRESH in-memory localStorage per test. The page remembers "transcript
  // open" there, so a test that clicks "View full transcript" left the NEXT
  // test starting open ("Hide full transcript"). That only happened on Node 22
  // (CI), where jsdom's storage persists across tests; Node 26's own global
  // shadows it, so it passed locally — five dev deploys failed on it.
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  fetchReport.mockReset();
  fetchTimeline.mockReset();
  fetchTimeline.mockRejectedValue(new NotFoundError());
});

describe("/teacher/reports/groups/[groupId] — real session report", () => {
  it("renders activity name, session label, and summary metrics from live data", async () => {
    fetchReport.mockResolvedValueOnce(LIVE_REPORT);
    const { container } = render(<TeacherGroupReportPage />);

    await waitFor(() => {
      expect(screen.queryByText(/loading report/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText(LIVE_REPORT.activityId)).toBeInTheDocument();
    expect(container.textContent).toContain("2026-06-15 09:30");
    expect(screen.getByText(/18m/)).toBeInTheDocument(); // friendly "Group time" format (was "18 min")
    expect(screen.getByText(String(LIVE_REPORT.messageCount))).toBeInTheDocument();
    expect(screen.getByText(String(LIVE_REPORT.simRunCount))).toBeInTheDocument();
    // No mock-data badge should ever appear.
    expect(screen.queryByText(/mock data/i)).not.toBeInTheDocument();
  });

  it("collapses the transcript by default and reveals it on toggle (1.1.4)", async () => {
    fetchReport.mockResolvedValueOnce(LIVE_REPORT);
    render(<TeacherGroupReportPage />);

    await waitFor(() => {
      expect(screen.queryByText(/loading report/i)).not.toBeInTheDocument();
    });

    expect(
      screen.queryByText(LIVE_REPORT.conversation[0].content),
    ).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: /view full transcript/i }));

    for (const turn of LIVE_REPORT.conversation) {
      expect(screen.getByText(turn.content)).toBeInTheDocument();
    }
  });

  it("interleaves the work with the turns and retires the raw 80-char list (1.1.136)", async () => {
    const longValue = JSON.stringify({ docs: [{ title: "Rapport", text: "x".repeat(120) + " ENDE" }] });
    fetchReport.mockResolvedValue({
      ...LIVE_REPORT,
      workbenchEvents: [
        { timestamp: "2026-06-15T09:31:30Z", server: "writing", tool: "state", field: "state", value: longValue },
      ],
    });
    render(<TeacherGroupReportPage />);
    await waitFor(() => expect(screen.queryByText(/loading report/i)).not.toBeInTheDocument());
    // The old separate list is gone.
    expect(screen.queryByText(/^Workbench activity$/)).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: /view full transcript/i }));
    // Unlabelled (pre-1.1.136) row → derived label, placed between the turns.
    const card = await screen.findByText("Writing updated");
    const q = screen.getByText(LIVE_REPORT.conversation[0].content);
    const a = screen.getByText(LIVE_REPORT.conversation[1].content);
    expect(q.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Expands to the whole text — not cut at 80 characters.
    await userEvent.click(screen.getByRole("button", { name: /show what they had/i }));
    expect(screen.getByText(/ENDE$/)).toBeInTheDocument();
  });

  it("uses the labelled server timeline for this group's session when it can read it", async () => {
    fetchReport.mockResolvedValue(LIVE_REPORT);
    fetchTimeline.mockReset();
    fetchTimeline.mockResolvedValue({
      sessionId: LIVE_REPORT.sessionId,
      workStatus: "ok",
      items: [
        { kind: "turn", ts: "2026-06-15T09:31:00Z", turn_index: 0, role: "student", content: "Hej" } as never,
        {
          kind: "work",
          ts: "2026-06-15T09:31:10Z",
          server: "calculator",
          tool: "state",
          field: "state",
          value: null,
          label: "Calculated Fart = 10",
        },
      ],
    });
    render(<TeacherGroupReportPage />);
    await waitFor(() => expect(screen.queryByText(/loading report/i)).not.toBeInTheDocument());
    await userEvent.click(await screen.findByRole("button", { name: /view full transcript/i }));
    expect(await screen.findByText("Calculated Fart = 10")).toBeInTheDocument();
    expect(fetchTimeline).toHaveBeenCalledWith(groupId, LIVE_REPORT.sessionId);
  });

  it("says how long ago a past session was active — never 'NaNh ago' (recency read from the raw timestamp)", async () => {
    fetchReport.mockResolvedValueOnce(LIVE_REPORT); // last turn 2026-06-15, long past
    render(<TeacherGroupReportPage />);
    const line = await screen.findByText(/last active/i);
    expect(line.textContent).toMatch(/last active \d+h ago/i);
    expect(line.textContent).not.toMatch(/NaN/);
  });

  it("shows the live badge when the group was active a moment ago", async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    fetchReport.mockResolvedValueOnce({
      ...LIVE_REPORT,
      conversation: [{ timestamp: recent, role: "student", content: "Hej" }],
    });
    render(<TeacherGroupReportPage />);
    expect(await screen.findByText(/^live$/i)).toBeInTheDocument();
    expect(screen.queryByText(/last active/i)).not.toBeInTheDocument();
  });

  it("shows an honest empty state (no mock) when no session exists yet", async () => {
    fetchReport.mockRejectedValueOnce(new NotFoundError());
    render(<TeacherGroupReportPage />);

    expect(await screen.findByText(/no sessions yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/mock data/i)).not.toBeInTheDocument();
  });

  it("shows an error state when the load fails (non-404)", async () => {
    fetchReport.mockRejectedValueOnce(new Error("boom"));
    render(<TeacherGroupReportPage />);

    expect(await screen.findByText(/couldn.t load this report/i)).toBeInTheDocument();
  });
});
