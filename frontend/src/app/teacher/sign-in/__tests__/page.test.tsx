import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/firebase", () => ({
  signInWithGoogle: vi.fn(),
  signInWithGoogleRedirect: vi.fn(),
  signInWithEmail: vi.fn(),
  sendPasswordReset: vi.fn(),
  subscribeToAuthState: vi.fn((cb: (u: null) => void) => { cb(null); return vi.fn(); }),
  getIdToken: vi.fn(async () => null),
}));

vi.mock("@/lib/localMode", () => ({
  isLocalMode: vi.fn(() => false),
  LOCAL_MODE_STUB_TOKEN: "local-mode-stub-token",
  LOCAL_MODE_WORKSHOP_USER: { uid: "wu", email: "w@local", displayName: "W", photoURL: null },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import * as firebase from "@/lib/firebase";
import TeacherSignInPage from "@/app/teacher/sign-in/page";

describe("TeacherSignInPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a sign-in button", () => {
    render(<TeacherSignInPage />);
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeDefined();
  });

  it("calls signInWithGoogle on button click", async () => {
    vi.mocked(firebase.signInWithGoogle).mockResolvedValueOnce(undefined);
    render(<TeacherSignInPage />);
    fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    await waitFor(() => expect(firebase.signInWithGoogle).toHaveBeenCalledOnce());
  });

  it("falls back to redirect when popup throws", async () => {
    vi.mocked(firebase.signInWithGoogle).mockRejectedValueOnce(new Error("popup-blocked"));
    vi.mocked(firebase.signInWithGoogleRedirect).mockResolvedValueOnce(undefined);
    render(<TeacherSignInPage />);
    fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    await waitFor(() => expect(firebase.signInWithGoogleRedirect).toHaveBeenCalledOnce());
  });

  it("shows an error message when both popup and redirect fail", async () => {
    vi.mocked(firebase.signInWithGoogle).mockRejectedValueOnce(new Error("popup-blocked"));
    vi.mocked(firebase.signInWithGoogleRedirect).mockRejectedValueOnce(
      new Error("auth/network-request-failed"),
    );
    render(<TeacherSignInPage />);
    fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  });

  /**
   * Teachers at non-Google schools sign in with a password, so recovering it
   * without an admin minting a fresh link is the difference between a teacher
   * getting into their own lesson and waiting on someone.
   */
  describe("password reset", () => {
    function openEmailForm() {
      render(<TeacherSignInPage />);
      fireEvent.click(screen.getByRole("button", { name: /sign in with email/i }));
    }

    it("is reachable with the password box still empty", () => {
      openEmailForm();
      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: "lu@o365.favrskov-gym.dk" },
      });
      const reset = screen.getByRole("button", { name: /forgot your password/i });
      expect((reset as HTMLButtonElement).disabled).toBe(false);
    });

    it("stays disabled until an email is typed", () => {
      openEmailForm();
      const reset = screen.getByRole("button", { name: /forgot your password/i });
      expect((reset as HTMLButtonElement).disabled).toBe(true);
    });

    it("sends the reset and confirms without revealing whether the account exists", async () => {
      vi.mocked(firebase.sendPasswordReset).mockResolvedValueOnce(undefined);
      openEmailForm();
      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: "lu@o365.favrskov-gym.dk" },
      });
      fireEvent.click(screen.getByRole("button", { name: /forgot your password/i }));

      await waitFor(() =>
        expect(firebase.sendPasswordReset).toHaveBeenCalledWith("lu@o365.favrskov-gym.dk"),
      );
      const status = await screen.findByRole("status");
      // "If <email> has an account" — never "we sent you an email" / "no such user".
      expect(status.textContent).toMatch(/if .*has an account/i);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("mentions the spam folder, because Firebase mail lands there", async () => {
      vi.mocked(firebase.sendPasswordReset).mockResolvedValueOnce(undefined);
      openEmailForm();
      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: "lu@o365.favrskov-gym.dk" },
      });
      fireEvent.click(screen.getByRole("button", { name: /forgot your password/i }));
      const status = await screen.findByRole("status");
      expect(status.textContent).toMatch(/spam/i);
    });

    it("surfaces a real send failure as an error", async () => {
      vi.mocked(firebase.sendPasswordReset).mockRejectedValueOnce(
        new Error("auth/too-many-requests"),
      );
      openEmailForm();
      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: "lu@o365.favrskov-gym.dk" },
      });
      fireEvent.click(screen.getByRole("button", { name: /forgot your password/i }));
      await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    });
  });
});
