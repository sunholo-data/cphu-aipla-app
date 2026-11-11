import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

const role = vi.hoisted(() => ({ isResearcher: false }));
vi.mock("@/hooks/useIsResearcher", () => ({ useIsResearcher: () => role.isResearcher }));

import TeacherSettingsPage from "@/app/teacher/settings/page";

// 1.1.108 M2 — these tests assert the English copy; a teacher's default
// language is Danish, so render inside an English locale.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const r = rtlRender(wrap(ui), options);
  return { ...r, rerender: (next: ReactElement) => r.rerender(wrap(next)) };
}

beforeEach(() => {
  role.isResearcher = false;
});

describe("TeacherSettingsPage", () => {
  it("renders the settings title and a placeholder empty state", () => {
    render(<TeacherSettingsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("is the same small page for a plain teacher: no lenses, no pointer to them", () => {
    render(<TeacherSettingsPage />);
    expect(screen.queryByTestId("lens-config-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lenses-moved")).not.toBeInTheDocument();
  });

  it("tells a researcher where the judge lenses went, and no longer renders them here", () => {
    // UI sweep 2026-11-11: the lenses moved to Tutors › Research tools, beside
    // the calibration of the same judges.
    role.isResearcher = true;
    render(<TeacherSettingsPage />);
    expect(screen.queryByTestId("lens-config-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("lenses-moved")).toHaveTextContent("The judge lenses have moved to Tutors › Research tools.");
    expect(screen.getByRole("link", { name: "Go to the research tools" })).toHaveAttribute(
      "href",
      "/teacher/research/frameworks?tab=research",
    );
  });
});
