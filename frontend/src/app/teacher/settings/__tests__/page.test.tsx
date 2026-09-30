import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import { describe, expect, it } from "vitest";

import TeacherSettingsPage from "@/app/teacher/settings/page";

// 1.1.108 M2 — these tests assert the English copy; a teacher's default
// language is Danish, so render inside an English locale.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const r = rtlRender(wrap(ui), options);
  return { ...r, rerender: (next: ReactElement) => r.rerender(wrap(next)) };
}

describe("TeacherSettingsPage", () => {
  it("renders the settings title and a placeholder empty state", () => {
    render(<TeacherSettingsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
