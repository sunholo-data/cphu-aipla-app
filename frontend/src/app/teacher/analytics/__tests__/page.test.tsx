/**
 * Page-level tests for /teacher/analytics (sprint
 * ANALYTICS-CHAT-AND-INSIGHTS, M6).
 *
 * The chat island is exercised in `_AnalyticsChat.test.tsx`. These
 * tests cover the page shell: class loading, scope dropdowns,
 * conditional rendering of empty state vs island.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TeacherAnalyticsPage from "@/app/teacher/analytics/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/teacher/analytics",
}));

const listClasses = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/teacherApi", () => ({
  listClasses: () => listClasses(),
}));

vi.mock("@/lib/firebase", () => ({
  subscribeToAuthState: vi.fn(() => () => undefined),
  getIsResearcher: vi.fn(async () => false),
}));

vi.mock("@/lib/localMode", () => ({
  isLocalMode: vi.fn().mockReturnValue(true),
  LOCAL_MODE_WORKSHOP_USER: { uid: "local-teacher", displayName: "Local Teacher" },
}));

// The chat island is exercised in its own test file; stub it here so
// page tests don't need to set up AG-UI.
vi.mock("@/app/teacher/analytics/_AnalyticsChat", () => ({
  AnalyticsChat: ({
    classId,
    className,
    timeScope,
  }: {
    classId: string;
    className: string;
    timeScope: string;
  }) => (
    <div
      data-testid="chat-stub"
      data-class-id={classId}
      data-class-name={className}
      data-time-scope={timeScope}
    />
  ),
}));

describe("/teacher/analytics — page shell", () => {
  it("renders the breadcrumb + Insights title (Ask-the-data view)", () => {
    listClasses.mockResolvedValueOnce([]);
    render(<TeacherAnalyticsPage />);
    expect(screen.getByText("Insights", { selector: "h1" })).toBeInTheDocument();
    // "Ask the data" appears as the subtitle + the active sub-nav tab.
    expect(screen.getAllByText("Ask the data").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("renders the chat island and forwards class + scope as props", async () => {
    listClasses.mockResolvedValueOnce([
      { classId: "c1", name: "9A Physics", ownerUid: "u" },
      { classId: "c2", name: "9B Physics", ownerUid: "u" },
    ]);
    render(<TeacherAnalyticsPage />);

    const stub = await screen.findByTestId("chat-stub");
    expect(stub).toHaveAttribute("data-class-id", "c1");
    expect(stub).toHaveAttribute("data-class-name", "9A Physics");
    expect(stub).toHaveAttribute("data-time-scope", "All time");
  });

  it("renders the chat stub with empty classId when class list is empty", async () => {
    listClasses.mockResolvedValueOnce([]);
    render(<TeacherAnalyticsPage />);
    const stub = await waitFor(() => screen.getByTestId("chat-stub"));
    expect(stub).toHaveAttribute("data-class-id", "");
  });
});
