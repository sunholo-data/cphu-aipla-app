import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import { describe, expect, it, vi } from "vitest";

import { AccountMenu } from "@/components/teacher/ui/AccountMenu";

// 1.1.108 M2 — these tests assert the English copy; a teacher's default
// language is Danish, so render inside an English locale.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const r = rtlRender(wrap(ui), options);
  return { ...r, rerender: (next: ReactElement) => r.rerender(wrap(next)) };
}

/** 1.1.125 M0 — Settings, Approaches and Sign out behind the account. */
describe("AccountMenu", () => {
  it("opens to Settings, Approaches and Sign out; sign out calls through", () => {
    const onSignOut = vi.fn();
    render(<AccountMenu label="jb@ind.ku.dk" avatar={<span>JB</span>} onSignOut={onSignOut} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menuitem", { name: /settings/i })).toHaveAttribute("href", "/teacher/settings");
    expect(screen.getByRole("menuitem", { name: /approaches/i })).toHaveAttribute("href", "/teacher/research/frameworks");
    fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("announces the signed-in identity and closes on Escape", () => {
    render(<AccountMenu label="jb@ind.ku.dk" avatar={<span>JB</span>} onSignOut={() => {}} />);
    expect(screen.getByText("Signed in as jb@ind.ku.dk")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
