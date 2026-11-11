import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/** 1.1.125 M0 — Settings, Tutors and Sign out behind the account (UI sweep 2026-11-11). */
describe("AccountMenu", () => {
  it("opens to Tutors (first), Settings and Sign out; sign out calls through", async () => {
    const onSignOut = vi.fn();
    render(<AccountMenu label="jb@ind.ku.dk" avatar={<span>JB</span>} onSignOut={onSignOut} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const items = screen.getAllByRole("menuitem");
    // "Tilgange"/"Approaches" was renamed Tutors and leads the menu.
    expect(items[0]).toHaveTextContent("Tutors");
    expect(items[0]).toHaveAttribute("href", "/teacher/research/frameworks");
    expect(screen.queryByRole("menuitem", { name: /approaches/i })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /settings/i })).toHaveAttribute("href", "/teacher/settings");
    await userEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("announces the signed-in identity and closes on Escape", async () => {
    render(<AccountMenu label="jb@ind.ku.dk" avatar={<span>JB</span>} onSignOut={() => {}} />);
    expect(screen.getByText("Signed in as jb@ind.ku.dk")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("offers the language as a DA | EN radio pair inside the menu", async () => {
    render(<AccountMenu label="jb@ind.ku.dk" avatar={<span>JB</span>} onSignOut={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const radios = screen.getAllByRole("menuitemradio");
    expect(radios.map((r) => r.textContent)).toEqual(["da", "en"]);
  });

  // The header "Forsker" pill moved here: a role line in the menu, and a marker
  // on the trigger so the role stays visible on every page.
  it("shows no role for a plain teacher", async () => {
    render(<AccountMenu label="t@ku.dk" avatar={<span>T</span>} onSignOut={() => {}} />);
    expect(screen.queryByTestId("account-role-marker")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.queryByTestId("account-role")).not.toBeInTheDocument();
  });

  it("shows 'Role: researcher' in the menu and a marker on the trigger for a researcher", async () => {
    render(<AccountMenu label="r@ku.dk" avatar={<span>R</span>} onSignOut={() => {}} isResearcher />);
    expect(screen.getByTestId("account-role-marker")).toBeInTheDocument();
    expect(screen.getByText(/Signed in as r@ku.dk\. Role: researcher/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByTestId("account-role")).toHaveTextContent("Role: researcher");
  });

  it("names the programme-admin role too", async () => {
    render(<AccountMenu label="p@ku.dk" avatar={<span>P</span>} onSignOut={() => {}} isProgrammeAdmin />);
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByTestId("account-role")).toHaveTextContent("Role: programme admin");
  });

  it("speaks Danish by default: Tutorer, Rolle: forsker", async () => {
    rtlRender(<AccountMenu label="r@ku.dk" avatar={<span>R</span>} onSignOut={() => {}} isResearcher />);
    await userEvent.click(screen.getByRole("button", { name: /kontomenu/i }));
    expect(screen.getAllByRole("menuitem")[0]).toHaveTextContent("Tutorer");
    expect(screen.getByTestId("account-role")).toHaveTextContent("Rolle: forsker");
  });
});
