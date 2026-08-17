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
import { BRANDING } from "@/lib/branding";

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

    it("tells them what to do when no email arrives, so the wait is not a dead end", async () => {
      vi.mocked(firebase.sendPasswordReset).mockResolvedValueOnce(undefined);
      openEmailForm();
      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: "never-created@vhim-gym.dk" },
      });
      fireEvent.click(screen.getByRole("button", { name: /forgot your password/i }));
      const status = await screen.findByRole("status");
      // The first-timer whose account was never created must not just wait.
      expect(status.textContent).toMatch(/nothing arrives/i);
      expect(status.textContent).toMatch(/may not be set up/i);
    });
  });

  /**
   * No silent failures: a teacher who cannot get in has no route to in-app help,
   * so every dead end has to name a human ON this page.
   */
  describe("no dead ends", () => {
    it("names the support contacts before anything has gone wrong", () => {
      render(<TeacherSignInPage />);
      expect(screen.getByText(/trouble signing in/i)).toBeDefined();
      // The two people in the room on pilot day, then M as escalation.
      expect(screen.getByRole("link", { name: /jbruun@ind\.ku\.dk/i })).toBeDefined();
      expect(screen.getByRole("link", { name: /aswin\.rangkuti@ind\.ku\.dk/i })).toBeDefined();
      expect(screen.getByRole("link", { name: /mark\.edmondson@ind\.ku\.dk/i })).toBeDefined();
    });

    it("renders every contact as a mailto so a stuck teacher can just click", () => {
      render(<TeacherSignInPage />);
      for (const c of BRANDING.pilotSupport.contacts) {
        const link = screen.getByRole("link", { name: new RegExp(c.email.replace(/\./g, "\\."), "i") });
        expect(link.getAttribute("href")).toBe(`mailto:${c.email}`);
      }
    });

    it("tells a first-time teacher their login may not exist, not just 'wrong password'", async () => {
      vi.mocked(firebase.signInWithEmail).mockRejectedValueOnce(
        Object.assign(new Error("bad"), { code: "auth/invalid-credential" }),
      );
      render(<TeacherSignInPage />);
      fireEvent.click(screen.getByRole("button", { name: /sign in with email/i }));
      fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "mn@sctknud-gym.dk" } });
      fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "guess" } });
      fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/may not exist yet/i);
      expect(alert.textContent).toMatch(/forgot your password/i);
      // The raw code stays visible for whoever receives the screenshot.
      expect(alert.textContent).toMatch(/auth\/invalid-credential/);
    });

    it("points a non-Google school at the email door when Google fails", async () => {
      vi.mocked(firebase.signInWithGoogle).mockRejectedValueOnce(new Error("popup-blocked"));
      vi.mocked(firebase.signInWithGoogleRedirect).mockRejectedValueOnce(
        Object.assign(new Error("nope"), { code: "auth/operation-not-supported" }),
      );
      render(<TeacherSignInPage />);
      fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/does not use Google/i);
      expect(alert.textContent).toMatch(/sign in with email/i);
      expect(alert.textContent).toMatch(/auth\/operation-not-supported/);
    });

    it("does not show a Firebase Console instruction to a teacher", async () => {
      vi.mocked(firebase.signInWithEmail).mockRejectedValueOnce(
        Object.assign(new Error("bad"), { code: "auth/operation-not-allowed" }),
      );
      render(<TeacherSignInPage />);
      fireEvent.click(screen.getByRole("button", { name: /sign in with email/i }));
      fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.dk" } });
      fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).not.toMatch(/firebase console/i);
      expect(alert.textContent).toMatch(/contact one of the people below/i);
    });

    it("keeps the raw code on an unrecognised failure instead of swallowing it", async () => {
      vi.mocked(firebase.signInWithEmail).mockRejectedValueOnce(
        Object.assign(new Error("boom"), { code: "auth/internal-error" }),
      );
      render(<TeacherSignInPage />);
      fireEvent.click(screen.getByRole("button", { name: /sign in with email/i }));
      fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.dk" } });
      fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/auth\/internal-error/);
      expect(alert.textContent).toMatch(/contact one of the people below/i);
    });
  });
});
