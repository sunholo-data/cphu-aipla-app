/**
 * /teacher/programme — PROGADMIN-1 (1.1.76).
 *
 * The load-bearing assertions are about PRIVILEGE, not layout:
 *  - neither claim  -> the access notice, and no fetch fires
 *  - researcher     -> the same tables a programme admin sees, minus buttons
 *  - uncapped row   -> an ALARM, never a blank cell
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TeacherProgrammePage from "@/app/teacher/programme/page";
import type { ProgrammeBudgetPayload, RegisterPayload, RequestsPayload } from "@/lib/programmeApi";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/teacher/programme",
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const fetchRegister = vi.fn();
const fetchAccessRequests = vi.fn();
const grantAccess = vi.fn();
const revokeAccess = vi.fn();
const fetchProgrammeBudget = vi.fn();
const setProgrammeBudget = vi.fn();

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

const BUDGET: ProgrammeBudgetPayload = {
  dailyBudgetUsd: null,
  action: "warn",
  updatedBy: "",
  updatedAt: "",
  spentTodayUsd: 3.2,
  ceilingUsd: 500,
  canWrite: false,
};

beforeEach(() => {
  fetchRegister.mockReset().mockResolvedValue(REGISTER);
  fetchAccessRequests.mockReset().mockResolvedValue(REQUESTS);
  grantAccess.mockReset().mockResolvedValue(REGISTER.grants[0]);
  revokeAccess.mockReset().mockResolvedValue({ email: "lb@toerring-gym.dk", revoked: true });
  fetchProgrammeBudget.mockReset().mockResolvedValue(BUDGET);
  setProgrammeBudget.mockReset().mockResolvedValue(BUDGET);
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
  it("shows the read-only subtitle for a researcher", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    expect(await screen.findByText(/read-only/i)).toBeInTheDocument();
  });

  it("drops the read-only subtitle for a programme admin", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument();
  });
});


describe("the write half (M2)", () => {
  it("gives a researcher no grant form, no cap input and no revoke button", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    // The read-only view IS the write view minus the buttons — so the absence
    // of every control is the assertion, not an incidental detail.
    expect(screen.queryByRole("button", { name: /grant access/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /revoke/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/monthly cap for/i)).not.toBeInTheDocument();
  });

  it("gives a programme admin the grant form and the controls", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    expect(screen.getByRole("button", { name: /grant access/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly cap for lb@toerring-gym.dk")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^revoke$/i }).length).toBeGreaterThan(0);
  });

  it("caps the grant form's input at the delegated ceiling", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
    // The <label> wraps a helper span too, so match on a fragment.
    const capInput = screen.getByLabelText(/Cap \(USD \/ month\)/i) as HTMLInputElement;
    expect(capInput.max).toBe("50");
  });

  it("requires a note on the grant form", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await screen.findByText("lb@toerring-gym.dk");
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
    expect(await screen.findByText(/Programme daily budget/i)).toBeInTheDocument();
    expect(screen.getByText("$3.20")).toBeInTheDocument();
  });

  it("says plainly when no budget is set rather than showing a bare zero", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    expect(await screen.findByText(/no budget set/i)).toBeInTheDocument();
  });

  it("gives a researcher no controls", async () => {
    isResearcher = true;
    render(<TeacherProgrammePage />);
    await screen.findByText(/Programme daily budget/i);
    expect(screen.queryByLabelText(/Programme daily budget in USD/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save budget/i })).not.toBeInTheDocument();
  });

  it("gives a programme admin the control, defaulting to warn", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
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
    await screen.findByText(/Programme daily budget/i);
    const input = screen.getByLabelText(/Programme daily budget in USD/i) as HTMLInputElement;
    expect(input.max).toBe("500");
  });

  it("saves a budget", async () => {
    isProgrammeAdmin = true;
    render(<TeacherProgrammePage />);
    await screen.findByText(/Programme daily budget/i);
    fireEvent.change(screen.getByLabelText(/Programme daily budget in USD/i), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /save budget/i }));
    await waitFor(() => expect(setProgrammeBudget).toHaveBeenCalledWith(40, "warn"));
  });

  it("renders an unreadable programme total as unreadable", async () => {
    isResearcher = true;
    fetchProgrammeBudget.mockResolvedValue({ ...BUDGET, spentTodayUsd: null });
    render(<TeacherProgrammePage />);
    expect(await screen.findByText("unreadable")).toBeInTheDocument();
  });
});
