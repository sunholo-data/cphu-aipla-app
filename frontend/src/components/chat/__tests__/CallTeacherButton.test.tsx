import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const raiseHand = vi.fn();
const lowerHand = vi.fn();
const getGroupSignal = vi.fn();

vi.mock("@/lib/signalApi", () => ({
  raiseHand: (...a: unknown[]) => raiseHand(...a),
  lowerHand: (...a: unknown[]) => lowerHand(...a),
  getGroupSignal: (...a: unknown[]) => getGroupSignal(...a),
}));

const isAnonymousGroupAuthMode = vi.fn();
const readStoredGroupSession = vi.fn();
vi.mock("@/lib/anonymousGroupAuth", () => ({
  isAnonymousGroupAuthMode: () => isAnonymousGroupAuthMode(),
  readStoredGroupSession: () => readStoredGroupSession(),
}));

import { CallTeacherButton } from "../CallTeacherButton";

const RESTING = { raised: false, raisedHandAt: null, clearedAt: null, clearedBy: "", activityTitle: "" };
const RAISED = { raised: true, raisedHandAt: "t1", clearedAt: null, clearedBy: "", activityTitle: "" };
const ACKED = { raised: false, raisedHandAt: null, clearedAt: "t2", clearedBy: "teacher-1", activityTitle: "" };
const LOWERED = { raised: false, raisedHandAt: null, clearedAt: "t2", clearedBy: "student", activityTitle: "" };

beforeEach(() => {
  raiseHand.mockReset().mockResolvedValue(RAISED);
  lowerHand.mockReset().mockResolvedValue(LOWERED);
  getGroupSignal.mockReset().mockResolvedValue(RESTING);
  isAnonymousGroupAuthMode.mockReset().mockReturnValue(false);
  readStoredGroupSession.mockReset().mockReturnValue({ token: "x" });
});

describe("CallTeacherButton", () => {
  it("starts resting and raises the hand on click", async () => {
    render(<CallTeacherButton pollMs={1_000_000} />);
    const btn = screen.getByTestId("call-teacher-button");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    await waitFor(() => expect(raiseHand).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("call-teacher-button")).toHaveAttribute("aria-pressed", "true"));
  });

  it("lowers the hand on a second click", async () => {
    render(<CallTeacherButton pollMs={1_000_000} />);
    const btn = screen.getByTestId("call-teacher-button");
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(btn);
    await waitFor(() => expect(lowerHand).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("call-teacher-button")).toHaveAttribute("aria-pressed", "false"));
  });

  it("shows acknowledged when a teacher clears the raised hand", async () => {
    // First poll: hand is up. Subsequent polls: cleared by a teacher.
    getGroupSignal.mockReset().mockResolvedValueOnce(RAISED).mockResolvedValue(ACKED);
    render(<CallTeacherButton pollMs={20} />);
    await waitFor(() => expect(screen.getByText(/på vej/i)).toBeInTheDocument());
  });

  it("passes the activity title through when raising", async () => {
    render(<CallTeacherButton pollMs={1_000_000} activityTitle="Energibevarelse" />);
    fireEvent.click(screen.getByTestId("call-teacher-button"));
    await waitFor(() => expect(raiseHand).toHaveBeenCalledWith("Energibevarelse"));
  });

  it("stops polling after a terminal auth failure (no 401 storm)", async () => {
    // fetchWithAuth already tried to refresh; a surfaced error + a now-empty
    // stored session means the code is terminally revoked/expired.
    isAnonymousGroupAuthMode.mockReturnValue(true);
    readStoredGroupSession.mockReturnValue(null);
    getGroupSignal.mockReset().mockRejectedValue(new Error("get signal failed: 401"));

    render(<CallTeacherButton pollMs={50} />);

    // The immediate poll rejects and stops the interval before the first tick.
    await waitFor(() => expect(getGroupSignal).toHaveBeenCalledTimes(1));
    // Five intervals' worth of time elapses with no further polls.
    await new Promise((r) => setTimeout(r, 250));
    expect(getGroupSignal).toHaveBeenCalledTimes(1);
  });

  it("keeps polling on a transient error (session still present)", async () => {
    isAnonymousGroupAuthMode.mockReturnValue(true);
    readStoredGroupSession.mockReturnValue({ token: "still-here" });
    getGroupSignal.mockReset().mockRejectedValue(new Error("get signal failed: 503"));

    render(<CallTeacherButton pollMs={30} />);

    // Polling continues — a transient failure must not stop the loop.
    await waitFor(() => expect(getGroupSignal.mock.calls.length).toBeGreaterThan(1));
  });
});
