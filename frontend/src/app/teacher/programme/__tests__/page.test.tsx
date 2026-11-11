/**
 * /teacher/programme — PROGADMIN-1 (1.1.76).
 *
 * The load-bearing assertions are about PRIVILEGE, not layout:
 *  - neither claim  -> the access notice, and no fetch fires
 *  - researcher     -> the same tables a programme admin sees, minus buttons
 *  - uncapped row   -> an ALARM, never a blank cell
 */

import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TeacherProgrammePage from "@/app/teacher/programme/page";
import type { ProgrammeBudgetPayload, RegisterPayload, RequestsPayload, RolesPayload } from "@/lib/programmeApi";

// 1.1.108 M2 — these tests assert the English copy; a teacher's default
// language is Danish, so render inside an English locale.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const r = rtlRender(wrap(ui), options);
  return { ...r, rerender: (next: ReactElement) => r.rerender(wrap(next)) };
}

// The tab lives in `?tab=` (UI sweep 2026-11-11), so the router is a small
// reactive stand-in: `replace` rewrites the query and re-renders its readers.
const nav = vi.hoisted(() => ({
  search: "",
  replaced: [] as string[],
  listeners: new Set<() => void>(),
}));
vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    useRouter: () => ({
      replace: (url: string) => {
        nav.replaced.push(url);
        nav.search = url.split("?")[1] ?? "";
        nav.listeners.forEach((l) => l());
      },
    }),
    usePathname: () => "/teacher/programme",
    useSearchParams: () => {
      const search = React.useSyncExternalStore(
        (cb: () => void) => {
          nav.listeners.add(cb);
          return () => nav.listeners.delete(cb);
        },
        () => nav.search,
      );
      return new URLSearchParams(search);
    },
  };
});

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const fetchRegister = vi.fn();
const fetchAccessRequests = vi.fn();
const grantAccess = vi.fn();
const revokeAccess = vi.fn();
const fetchProgrammeBudget = vi.fn();
const setProgrammeBudget = vi.fn();
const fetchRoles = vi.fn();
const fetchOnboarding = vi.fn();
const setTeacherFeature = vi.fn();

vi.mock("@/lib/programmeApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/programmeApi")>("@/lib/programmeApi");
  return {
    ...actual,
    fetchRegister: (...a: unknown[]) => fetchRegister(...a),
    fetchAccessRequests: (...a: unknown[]) => fetchAccessRequests(...a),
    grantAccess: (...a: unknown[]) => grantAccess(...a),
    revokeAccess: (...a: unknown[]) => revokeAccess(...a),
    fetchProgrammeBudget: (...a: unknown[]) => fetchProgrammeBudget(...a),
    setProgrammeBudget: (...a: unknown[]) => setProgrammeBudget(...a),
    fetchRoles: (...a: unknown[]) => fetchRoles(...a),
    fetchOnboarding: (...a: unknown[]) => fetchOnboarding(...a),
    setTeacherFeature: (...a: unknown[]) => setTeacherFeature(...a),
  };
});

let isResearcher = false;
let isProgrammeAdmin = false;
vi.mock("@/hooks/useIsResearcher", () => ({ useIsResearcher: () => isResearcher }));
vi.mock("@/hooks/useIsProgrammeAdmin", () => ({ useIsProgrammeAdmin: () => isProgrammeAdmin }));

const REGISTER: RegisterPayload = {
  count: 2,
  canWrite: false,
  grants: [
    {
      email: "lb@toerring-gym.dk",
      tier: "pilot",
      monthlyCapUsd: 25,
      grantedBy: "m@sunholo.com",
      grantedVia: "service-account",
      grantedAt: "2026-08-14T00:00:00Z",
      expiresAt: "2027-09-15T00:00:00Z",
      active: true,
      revoked: false,
      uid: "u1",
      note: "Teacher pilot",
      spentThisPeriodUsd: 12.4,
    },
    {
      email: "risky@ku.dk",
      tier: "pilot",
      monthlyCapUsd: -1,
      grantedBy: "m@sunholo.com",
      grantedVia: "",
      grantedAt: "2026-08-12T00:00:00Z",
      expiresAt: null,
      active: true,
      revoked: false,
      uid: "u2",
      note: "",
      spentThisPeriodUsd: null,
    },
  ],
};

const REQUESTS: RequestsPayload = {
  count: 1,
  canWrite: false,
  requests: [
    {
      uid: "r1",
      email: "asks@ku.dk",
      name: "A Teacher",
      institution: "UCPH",
      message: "please",
      status: "pending",
      requestedAt: "2026-09-01T00:00:00Z",
    },
  ],
};

const ROLES: RolesPayload = {
  count: 2,
  canWrite: false,
  people: [
    { uid: "u-sh", email: "sh@example.com", roles: ["researcher"], accessTier: "visitor", grant: null },
    {
      uid: "u-jb",
      email: "jb@ind.ku.dk",
      roles: ["researcher", "programme-admin"],
      accessTier: "pilot",
      grant: { tier: "pilot", monthlyCapUsd: 100, active: true, expiresAt: "2027-09-15T00:00:00Z" },
    },
  ],
};

const BUDGET: ProgrammeBudgetPayload = {
  dailyBudgetUsd: null,
  action: "warn",
  updatedBy: "",
  updatedAt: "",
  spentTodayUsd: 3.2,
  ceilingUsd: 500,
  canWrite: false,
};

/** The daily budget is one button until opened (UI sweep 2026-11-11). */
async function openBudget() {
  fireEvent.click(await screen.findByRole("button", { name: /^Daily budget:/ }));
}

/** The standalone grant form is behind one button for programme admins. */
async function openAddTeacher() {
  fireEvent.click(await screen.findByRole("button", { name: /Add a teacher who has not asked/i }));
}

beforeEach(() => {
  nav.search = "";
  nav.replaced = [];
  fetchRegister.mockReset().mockResolvedValue(REGISTER);
  // 1.1.124 — stage per email. Default: unreadable, so the column shows "—".
  fetchOnboarding.mockReset().mockRejectedValue(new Error("no stages"));
  fetchAccessRequests.mockReset().mockResolvedValue(REQUESTS);
  grantAccess.mockReset().mockResolvedValue(REGISTER.grants[0]);
  revokeAccess.mockReset().mockResolvedValue({ email: "lb@toerring-gym.dk", revoked: true });
  fetchProgrammeBudget.mockReset().mockResolvedValue(BUDGET);
  setProgrammeBudget.mockReset().mockResolvedValue(BUDGET);
  fetchRoles.mockReset().mockResolvedValue(ROLES);
  isResearcher = false;
  isProgrammeAdmin = false;
});

describe("the gate", () => {
  it("shows an access notice and fires no fetch without either claim", async () => {
    render(<TeacherProgrammePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /available to programme administrators and researchers/i,
    );
    expect(fetchRegister).not.toHaveBeenCalled();
    expect(fetchAccessRequests).not.toHaveBeenCalled();
  });

  it("loads the register for a researcher", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    expect(await screen.findByText("lb@toerring-gym.dk")).toBeInTheDocument();
    expect(fetchRegister).toHaveBeenCalled();
  });

  it("loads the register for a programme admin who is not a researcher", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    expect(await screen.findByText("lb@toerring-gym.dk")).toBeInTheDocument();
  });
});

describe("the Sim workshop switch", () => {
  it("lets a researcher (not only a programme admin) switch it on for a teacher", async () => {
    isResearcher = true;
    setTeacherFeature.mockReset().mockResolvedValue({ email: "lb@toerring-gym.dk", features: { simWorkshop: true } });
    render(<TeacherProgrammePage />);
    const box = await screen.findByRole("checkbox", { name: "Sim workshop for lb@toerring-gym.dk" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(setTeacherFeature).toHaveBeenCalledWith("lb@toerring-gym.dk", "simWorkshop", true));
    expect(box).toBeChecked();
  });

  it("puts the box back and says so when the save fails", async () => {
    isResearcher = true;
    setTeacherFeature.mockReset().mockRejectedValue(new Error("500"));
    render(<TeacherProgrammePage />);
    const box = await screen.findByRole("checkbox", { name: "Sim workshop for lb@toerring-gym.dk" });
    fireEvent.click(box);
    expect(await screen.findByText("Not saved — try again")).toBeInTheDocument();
    expect(box).not.toBeChecked();
  });
});

describe("the register", () => {
  it("renders an uncapped row as an alarm, not a blank", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    // A cap of 0/-1 disables the per-teacher gate outright. An empty cell here
    // would be the interface lying by omission.
    expect(await screen.findByText("UNCAPPED")).toBeInTheDocument();
  });

  it("labels a pre-1.1.76 row (no grantedVia) as service account", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    await waitFor(() => expect(screen.getAllByText("service account").length).toBe(2));
  });

  it("says nobody is notified about the queue", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    expect(await screen.findByText(/Nobody is notified when someone asks for access/i)).toBeInTheDocument();
  });
});

describe("the read-only half", () => {
  it("tells a researcher what is theirs, without calling the page read-only", async () => {
    // A researcher CAN switch the Sim workshop per teacher, so "(read-only)"
    // was wrong; the subtitle says who sets what instead.
    isResearcher = true;
    render(<TeacherProgrammePage />);
    expect(await screen.findByText(/researchers can switch the Sim workshop on/i)).toBeInTheDocument();
    expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument();
  });

  it("gives a programme admin the plain subtitle", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    expect(screen.queryByText(/researchers can switch/i)).not.toBeInTheDocument();
  });
});


describe("the write half (M2)", () => {
  it("gives a researcher no grant form, no cap input and no revoke button", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    // The read-only view IS the write view minus the buttons — so the absence
    // of every control is the assertion, not an incidental detail.
    expect(screen.queryByRole("button", { name: /grant access/i, hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add a teacher/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /revoke/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/monthly cap for/i)).not.toBeInTheDocument();
  });

  it("gives a programme admin the grant form and the controls", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    // The standalone form (for someone who never asked) is one click away,
    // so the register is the first thing on the page.
    expect(screen.queryByRole("button", { name: /^grant access$/i })).not.toBeInTheDocument();
    await openAddTeacher();
    expect(screen.getByRole("button", { name: /^grant access$/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly cap for lb@toerring-gym.dk")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^revoke$/i }).length).toBeGreaterThan(0);
  });

  it("keeps the grant email out of password managers and spellcheck", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await openAddTeacher();
    const email = screen.getByRole("textbox", { name: /^Email/ });
    expect(email).toHaveAttribute("name", "email");
    expect(email).toHaveAttribute("autocomplete", "off");
    expect(email).toHaveAttribute("spellcheck", "false");
  });

  it("caps the grant form's input at the delegated ceiling", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    await openAddTeacher();
    // The <label> wraps a helper span too, so match on a fragment.
    const capInput = screen.getByLabelText(/Cap \(USD \/ month\)/i) as HTMLInputElement;
    expect(capInput.max).toBe("50");
  });

  it("requires a note on the grant form", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    await openAddTeacher();
    // "Why is this person on the register" is the thing nobody remembers in
    // six weeks, so the field is required rather than encouraged.
    const note = screen.getByLabelText(/why \(required\)/i) as HTMLInputElement;
    expect(note.required).toBe(true);
  });

  it("saves a changed cap through the idempotent grant call", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    const capInput = screen.getByLabelText("Monthly cap for lb@toerring-gym.dk");
    fireEvent.change(capInput, { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(grantAccess).toHaveBeenCalled());
    // The note must ride along, or editing a cap would silently erase the
    // reason the row exists.
    expect(grantAccess.mock.calls[0][0]).toMatchObject({
      email: "lb@toerring-gym.dk",
      monthlyCapUsd: 40,
      note: "Teacher pilot",
    });
  });

  it("does not offer Save until the cap actually changes", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });

  it("takes two clicks to revoke", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    fireEvent.click(screen.getAllByRole("button", { name: /^revoke$/i })[0]);
    expect(revokeAccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(revokeAccess).toHaveBeenCalledWith("lb@toerring-gym.dk"));
  });

  it("says so when a revoke fails, instead of nothing", async () => {
    // Was try/finally with no catch: a failed revoke was silent.
    isProgrammeAdmin = true;
    revokeAccess.mockRejectedValue(new Error("500"));
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    fireEvent.click(screen.getAllByRole("button", { name: /^revoke$/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(await screen.findByText("Not revoked — try again.")).toBeInTheDocument();
    expect(fetchRegister).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's named bound when a grant is refused", async () => {
    isProgrammeAdmin = true;
    grantAccess.mockRejectedValue(new Error("$5000.00/month exceeds the delegated ceiling of $50.00."));
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    const capInput = screen.getByLabelText("Monthly cap for lb@toerring-gym.dk");
    fireEvent.change(capInput, { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    // The person is expected to work within the bound, so the bound must reach
    // them rather than a generic failure.
    expect(await screen.findByText(/exceeds the delegated ceiling of \$50/i)).toBeInTheDocument();
  });
});

describe("spend beside the cap", () => {
  it("shows spend this period next to the cap it bounds", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    expect(await screen.findByText(/\$12\.40 this period/)).toBeInTheDocument();
  });

  it("renders an unreadable total as unreadable, never as $0.00", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    // A failed read must not produce the reassuring answer.
    expect(await screen.findByText(/unreadable this period/)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00 this period/)).not.toBeInTheDocument();
  });
});


describe("the programme daily budget (M3)", () => {
  it("shows today's programme spend to a researcher", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    await openBudget();
    expect(await screen.findByText(/Programme daily budget/i)).toBeInTheDocument();
    expect(screen.getByText("$3.20")).toBeInTheDocument();
  });

  it("says plainly when no budget is set rather than showing a bare zero", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    await openBudget();
    expect(await screen.findByText(/no budget set/i)).toBeInTheDocument();
  });

  it("gives a researcher no controls", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    await openBudget();
    await screen.findByText(/Programme daily budget/i);
    expect(screen.queryByLabelText(/Programme daily budget in USD/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save budget/i })).not.toBeInTheDocument();
  });

  it("gives a programme admin the control, defaulting to warn", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await openBudget();
    await screen.findByText(/Programme daily budget/i);
    expect(screen.getByLabelText(/Programme daily budget in USD/i)).toBeInTheDocument();
    const select = screen.getByLabelText(/Action when the budget is reached/i) as HTMLSelectElement;
    // warn-first: a programme-wide block is a very large blast radius for a
    // knob someone is still calibrating.
    expect(select.value).toBe("warn");
  });

  it("bounds the input by the ceiling it sits under", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await openBudget();
    await screen.findByText(/Programme daily budget/i);
    const input = screen.getByLabelText(/Programme daily budget in USD/i) as HTMLInputElement;
    expect(input.max).toBe("500");
  });

  it("saves a budget", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await openBudget();
    await screen.findByText(/Programme daily budget/i);
    fireEvent.change(screen.getByLabelText(/Programme daily budget in USD/i), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /save budget/i }));
    await waitFor(() => expect(setProgrammeBudget).toHaveBeenCalledWith(40, "warn"));
  });

  it("renders an unreadable programme total as unreadable", async () => {
    isResearcher = true;
    fetchProgrammeBudget.mockResolvedValue({ ...BUDGET, spentTodayUsd: null });
    render(<TeacherProgrammePage />);
    await openBudget();
    expect(await screen.findByText("unreadable")).toBeInTheDocument();
  });

  it("collapses to one button that already carries the answer", async () => {
    isResearcher = true;
    fetchProgrammeBudget.mockResolvedValue({ ...BUDGET, dailyBudgetUsd: 20, spentTodayUsd: 4.1 });
    render(<TeacherProgrammePage />);
    const toggle = await screen.findByRole("button", { name: /^Daily budget:/ });
    expect(toggle).toHaveTextContent("Daily budget: $4.10 of $20.00");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Programme daily budget/i)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Programme daily budget/i)).toBeInTheDocument();
  });

  it("says the budget could not be read, with a retry, rather than showing nothing", async () => {
    // _BudgetPanel returned null before reaching its own error, so a failed
    // read and "no budget panel at all" looked the same.
    isResearcher = true;
    fetchProgrammeBudget.mockReset().mockRejectedValueOnce(new Error("500")).mockResolvedValueOnce(BUDGET);
    render(<TeacherProgrammePage />);
    const alert = await screen.findByText("The programme daily budget could not be loaded");
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Daily budget:/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /^Daily budget:/ })).toBeInTheDocument();
    expect(fetchProgrammeBudget).toHaveBeenCalledTimes(2);
  });
});

describe("granting from a request (UI sweep 2026-11-11)", () => {
  it("opens the grant form pre-filled from the request — nobody retypes the email", async () => {
    isProgrammeAdmin = true;
    nav.search = "tab=requests";
    render(<TeacherProgrammePage />);
    // ?tab=requests opens the queue, so the "ask" mail can link straight to it.
    expect(await screen.findByRole("tab", { name: /^Requests/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(await screen.findByRole("button", { name: "Grant access to asks@ku.dk" }));
    const dialog = await screen.findByRole("dialog", { name: "Grant asks@ku.dk access" });
    expect(within(dialog).getByRole("textbox", { name: /^Email/ })).toHaveValue("asks@ku.dk");
    expect(within(dialog).getByLabelText(/why \(required\)/i)).toHaveValue("Asked in the app: UCPH — please");

    fireEvent.click(within(dialog).getByRole("button", { name: /^grant access$/i }));
    await waitFor(() =>
      expect(grantAccess).toHaveBeenCalledWith(
        expect.objectContaining({ email: "asks@ku.dk", note: "Asked in the app: UCPH — please", tier: "pilot" }),
      ),
    );
    // Closes, says what happened, and re-reads (the server closes the request).
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(/can now spend/i);
    expect(fetchRegister).toHaveBeenCalledTimes(2);
  });

  it("offers Grant… only to a programme admin, and only on pending requests", async () => {
    isResearcher = true;
    nav.search = "tab=requests";
    render(<TeacherProgrammePage />);
    await screen.findByText("asks@ku.dk");
    expect(screen.queryByRole("button", { name: /Grant access to/ })).not.toBeInTheDocument();
  });

  it("shows the asked date as a date, not an ISO string", async () => {
    isResearcher = true;
    nav.search = "tab=requests";
    render(<TeacherProgrammePage />);
    await screen.findByText("asks@ku.dk");
    expect(screen.queryByText("2026-09-01T00:00:00Z")).not.toBeInTheDocument();
    // en-GB medium; older ICU data says "Sep", newer "Sept".
    expect(screen.getByText(/^1 Sept? 2026$/)).toBeInTheDocument();
  });
});

describe("the thinned register (UI sweep 2026-11-11)", () => {
  it("shows five columns and keeps tier, expiry, granted-by and note in a row detail", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Email", "Getting started", "Cap / month", "Sim workshop", "Actions"]);

    const toggle = screen.getByRole("button", { name: "Show details for lb@toerring-gym.dk" });
    const detail = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(detail).not.toBeVisible();
    fireEvent.click(toggle);
    expect(detail).toBeVisible();
    expect(detail).toHaveTextContent("pilot");
    expect(detail).toHaveTextContent(/15 Sept? 2027/);
    expect(detail).toHaveTextContent("m@sunholo.com");
    expect(detail).toHaveTextContent("Teacher pilot");
  });

  it("switches tabs through the URL", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    fireEvent.click(screen.getByRole("tab", { name: /^Requests/ }));
    expect(nav.replaced.at(-1)).toBe("/teacher/programme?tab=requests");
    fireEvent.click(screen.getByRole("tab", { name: /^Register/ }));
    expect(nav.replaced.at(-1)).toBe("/teacher/programme");
  });
});

describe("the roles tab (2026-09-11)", () => {
  // A role is a claim; a spend grant is a register row. A researcher with no
  // grant used to be invisible on this page — the tab exists to show her.
  it("lists role holders and says in words who has no spend grant", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    fireEvent.click(screen.getByRole("tab", { name: /^Roles/ }));

    const sh = (await screen.findByText("sh@example.com")).closest("tr")!;
    expect(sh).toHaveTextContent("researcher");
    expect(sh).toHaveTextContent(/none — visitor/);

    const jb = screen.getByText("jb@ind.ku.dk").closest("tr")!;
    expect(jb).toHaveTextContent("programme admin");
    expect(jb).toHaveTextContent(/\$100\.00\/month/);
    expect(jb).not.toHaveTextContent(/visitor/);
  });

  it("fires no roles fetch without either claim", async () => {
    render(<TeacherProgrammePage />);
    await screen.findByRole("alert");
    expect(fetchRoles).not.toHaveBeenCalled();
  });
});

describe("the stage column (1.1.124 M0)", () => {
  it("shows each teacher's stage with the next step, and sorts stuck-longest first", async () => {
    isResearcher = true;
    fetchOnboarding.mockResolvedValue({
      count: 2,
      teachers: [
        { email: "risky@ku.dk", uid: "u2", tier: "pilot", grantedAt: "", classes: 1, stage: "demo_only", since: null, days: 9, nextStep: "Create the class" },
        { email: "lb@toerring-gym.dk", uid: "u1", tier: "pilot", grantedAt: "", classes: 2, stage: "live", since: null, days: 0, nextStep: null },
      ],
    });
    render(<TeacherProgrammePage />);
    const chips = await screen.findAllByTestId("stage-chip");
    expect(chips.map((c) => c.textContent)).toEqual(expect.arrayContaining(["Demo only — 9 days", "Live"]));
    expect(screen.getByText("Next: Create the class")).toBeInTheDocument();

    // Register order first (lb is first in REGISTER); sort flips the stuck one to the top.
    const emailsBefore = screen.getAllByTestId("stage-cell").map((td) => td.closest("tr")?.textContent?.includes("risky") ? "risky" : "lb");
    expect(emailsBefore[0]).toBe("lb");
    fireEvent.click(screen.getByRole("button", { name: /stuck longest first/i }));
    const emailsAfter = screen.getAllByTestId("stage-cell").map((td) => td.closest("tr")?.textContent?.includes("risky") ? "risky" : "lb");
    expect(emailsAfter[0]).toBe("risky");
  });

  it("shows a dash, never a guessed stage, when the stages cannot be read", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    expect(screen.queryAllByTestId("stage-chip")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /stuck longest first/i })).not.toBeInTheDocument();
  });
});
