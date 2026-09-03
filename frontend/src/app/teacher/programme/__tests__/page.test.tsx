/**
 * /teacher/programme — PROGADMIN-1 (1.1.76).
 *
 * The load-bearing assertions are about PRIVILEGE, not layout:
 *  - neither claim  -> the access notice, and no fetch fires
 *  - researcher     -> the same tables a programme admin sees, minus buttons
 *  - uncapped row   -> an ALARM, never a blank cell
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TeacherProgrammePage from "@/app/teacher/programme/page";
import type { RegisterPayload, RequestsPayload } from "@/lib/programmeApi";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/teacher/programme",
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const fetchRegister = vi.fn();
const fetchAccessRequests = vi.fn();

vi.mock("@/lib/programmeApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/programmeApi")>("@/lib/programmeApi");
  return {
    ...actual,
    fetchRegister: (...a: unknown[]) => fetchRegister(...a),
    fetchAccessRequests: (...a: unknown[]) => fetchAccessRequests(...a),
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

beforeEach(() => {
  fetchRegister.mockReset().mockResolvedValue(REGISTER);
  fetchAccessRequests.mockReset().mockResolvedValue(REQUESTS);
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
