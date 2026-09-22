/**
 * The spend refusal must name the account and offer a way out (1.1.124).
 *
 * Regression test for the Carl Winsløw incident: invited to the register under
 * a university address, silently auto-signed-in under a personal Gmail, refused
 * on every paid surface, with nothing on screen naming the second address. The
 * refusal message itself was fine — it was the missing identity that turned a
 * ten-second fix into a Firestore-plus-Cloud-Logging investigation.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const switchGoogleAccount = vi.fn();
let authCallback: ((user: { email: string } | null) => void) | null = null;

vi.mock("@/lib/firebase", () => ({
  switchGoogleAccount: (...args: unknown[]) => switchGoogleAccount(...args),
  subscribeToAuthState: (cb: (user: { email: string } | null) => void) => {
    authCallback = cb;
    cb({ email: "mh197678@gmail.com" });
    return () => {};
  },
}));

vi.mock("@/lib/localMode", () => ({
  isLocalMode: () => false,
  LOCAL_MODE_WORKSHOP_USER: { email: "workshop@example.com" },
}));

import { SpendDeniedNotice } from "@/components/teacher/SpendDeniedNotice";

beforeEach(() => {
  vi.clearAllMocks();
  authCallback = null;
});

describe("SpendDeniedNotice", () => {
  it("names the account that is actually signed in", async () => {
    render(<SpendDeniedNotice message="Uploading curriculum is for participants." />);

    expect(await screen.findByText("mh197678@gmail.com")).toBeInTheDocument();
    expect(
      screen.getByText(/Uploading curriculum is for participants\./),
    ).toBeInTheDocument();
  });

  it("offers a switch-account button that re-opens the Google chooser", async () => {
    const user = userEvent.setup();
    render(<SpendDeniedNotice />);

    await user.click(await screen.findByRole("button", { name: /Switch account/i }));
    await waitFor(() => expect(switchGoogleAccount).toHaveBeenCalledOnce());
  });

  it("still points a genuine visitor at the access request", async () => {
    render(<SpendDeniedNotice />);

    const link = await screen.findByRole("link", { name: /Join the programme/i });
    expect(link).toHaveAttribute("href", "/teacher-access");
  });

  it("is an alert — this one blocks the thing the teacher was trying to do", async () => {
    render(<SpendDeniedNotice />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("drops the identity line when the email is not readable", async () => {
    render(<SpendDeniedNotice />);
    expect(await screen.findByText("mh197678@gmail.com")).toBeInTheDocument();

    await act(async () => {
      authCallback?.(null);
    });

    // The address goes; the way out stays. A refusal with no escape hatch is
    // the state this whole component exists to prevent.
    await waitFor(() =>
      expect(screen.queryByText("mh197678@gmail.com")).toBeNull(),
    );
    expect(screen.getByRole("button", { name: /Switch account/i })).toBeInTheDocument();
  });
});
