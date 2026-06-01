import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TeacherAnalyticsPage from "@/app/teacher/analytics/page";
import {
  MOCK_ANALYTICS_ANSWER,
  MOCK_ANALYTICS_QUESTION,
  MOCK_ANALYTICS_SUGGESTIONS,
} from "@/app/teacher/_mock-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/teacherApi", () => ({
  listClasses: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/firebase", () => ({
  subscribeToAuthState: vi.fn(() => () => undefined),
}));

vi.mock("@/lib/localMode", () => ({
  isLocalMode: vi.fn().mockReturnValue(true),
  LOCAL_MODE_WORKSHOP_USER: { uid: "local-teacher", displayName: "Local Teacher" },
}));

describe("/teacher/analytics — analytics chat surface", () => {
  it("renders the hardcoded question and answer", () => {
    render(<TeacherAnalyticsPage />);
    expect(screen.getByText(MOCK_ANALYTICS_QUESTION)).toBeInTheDocument();
    expect(screen.getByText(MOCK_ANALYTICS_ANSWER)).toBeInTheDocument();
  });

  it("renders each suggested question", () => {
    render(<TeacherAnalyticsPage />);
    for (const q of MOCK_ANALYTICS_SUGGESTIONS) {
      expect(screen.getByText(q)).toBeInTheDocument();
    }
  });

  it("renders the Ask input but disabled (Phase 1 is non-interactive)", () => {
    render(<TeacherAnalyticsPage />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input).toBeDisabled();
  });
});
