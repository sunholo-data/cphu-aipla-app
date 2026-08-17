import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({
  verifyResetCode: vi.fn(),
  confirmResetPassword: vi.fn(),
  applyEmailActionCode: vi.fn(),
}));

const replace = vi.fn();
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => search,
}));

import * as firebase from "@/lib/firebase";
import AuthActionPage from "@/app/(site)/auth/action/page";
import { BRANDING } from "@/lib/branding";

function renderWith(params: Record<string, string>) {
  search = new URLSearchParams(params);
  return render(<AuthActionPage />);
}

describe("AuthActionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search = new URLSearchParams();
  });

  describe("resetPassword", () => {
    it("names the account the link belongs to", async () => {
      // Several pilot teachers have two granted addresses, so "which account is
      // this?" is a real question rather than decoration.
      vi.mocked(firebase.verifyResetCode).mockResolvedValueOnce("lu@o365.favrskov-gym.dk");
      renderWith({ mode: "resetPassword", oobCode: "good-code" });
      await waitFor(() => expect(screen.getByText(/lu@o365\.favrskov-gym\.dk/)).toBeDefined());
      expect(firebase.verifyResetCode).toHaveBeenCalledWith("good-code");
    });

    it("sets the password and offers the way back to sign-in", async () => {
      vi.mocked(firebase.verifyResetCode).mockResolvedValueOnce("mn@sctknud-gym.dk");
      vi.mocked(firebase.confirmResetPassword).mockResolvedValueOnce(undefined);
      renderWith({ mode: "resetPassword", oobCode: "good-code" });
      await screen.findByText(/mn@sctknud-gym\.dk/);

      fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: "fysik-2026" } });
      fireEvent.change(screen.getByLabelText(/repeat password/i), { target: { value: "fysik-2026" } });
      fireEvent.click(screen.getByRole("button", { name: /set password/i }));

      await waitFor(() =>
        expect(firebase.confirmResetPassword).toHaveBeenCalledWith("good-code", "fysik-2026"),
      );
      expect((await screen.findByRole("status")).textContent).toMatch(/you can now sign in/i);
    });

    it("refuses mismatched passwords without calling Firebase", async () => {
      vi.mocked(firebase.verifyResetCode).mockResolvedValueOnce("a@b.dk");
      renderWith({ mode: "resetPassword", oobCode: "good-code" });
      await screen.findByText(/a@b\.dk/);

      fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: "abcdefgh" } });
      fireEvent.change(screen.getByLabelText(/repeat password/i), { target: { value: "different" } });
      fireEvent.click(screen.getByRole("button", { name: /set password/i }));

      expect((await screen.findByRole("alert")).textContent).toMatch(/do not match/i);
      expect(firebase.confirmResetPassword).not.toHaveBeenCalled();
    });

    it("refuses a too-short password without calling Firebase", async () => {
      vi.mocked(firebase.verifyResetCode).mockResolvedValueOnce("a@b.dk");
      renderWith({ mode: "resetPassword", oobCode: "good-code" });
      await screen.findByText(/a@b\.dk/);

      fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: "short" } });
      fireEvent.change(screen.getByLabelText(/repeat password/i), { target: { value: "short" } });
      fireEvent.click(screen.getByRole("button", { name: /set password/i }));

      expect((await screen.findByRole("alert")).textContent).toMatch(/at least 8/i);
      expect(firebase.confirmResetPassword).not.toHaveBeenCalled();
    });
  });

  /**
   * A teacher following a stale link is the likeliest failure on pilot day, and
   * they have no idea what "auth/expired-action-code" means. Every dead end must
   * say what to do and name someone.
   */
  describe("dead links", () => {
    it("explains an expired code and how to get a fresh one", async () => {
      vi.mocked(firebase.verifyResetCode).mockRejectedValueOnce(
        Object.assign(new Error("x"), { code: "auth/expired-action-code" }),
      );
      renderWith({ mode: "resetPassword", oobCode: "stale" });
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/expired/i);
      expect(alert.textContent).toMatch(/forgot your password/i);
      expect(alert.textContent).toMatch(/auth\/expired-action-code/);
      expect(screen.getByRole("link", { name: /jbruun@ind\.ku\.dk/i })).toBeDefined();
    });

    it("explains an already-used code", async () => {
      vi.mocked(firebase.verifyResetCode).mockRejectedValueOnce(
        Object.assign(new Error("x"), { code: "auth/invalid-action-code" }),
      );
      renderWith({ mode: "resetPassword", oobCode: "used" });
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/no longer valid/i);
      expect(alert.textContent).toMatch(/auth\/invalid-action-code/);
    });

    it("handles a link with no oobCode at all", async () => {
      renderWith({ mode: "resetPassword" });
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/missing its security code/i);
      expect(firebase.verifyResetCode).not.toHaveBeenCalled();
    });

    it("names every support contact on a dead link", async () => {
      vi.mocked(firebase.verifyResetCode).mockRejectedValueOnce(
        Object.assign(new Error("x"), { code: "auth/invalid-action-code" }),
      );
      renderWith({ mode: "resetPassword", oobCode: "used" });
      await screen.findByRole("alert");
      for (const c of BRANDING.pilotSupport.contacts) {
        const re = new RegExp(c.email.replace(/\./g, "\\."), "i");
        expect(screen.getByRole("link", { name: re })).toBeDefined();
      }
    });
  });

  /**
   * callbackUri is ONE setting for every action type, so pointing it here routes
   * verifyEmail and recoverEmail to this page too. Neither is sent today; an
   * unhandled mode would blank-page a link the platform itself sent.
   */
  describe("other action modes", () => {
    it("applies a verifyEmail code", async () => {
      vi.mocked(firebase.applyEmailActionCode).mockResolvedValueOnce(undefined);
      renderWith({ mode: "verifyEmail", oobCode: "v-code" });
      await waitFor(() => expect(firebase.applyEmailActionCode).toHaveBeenCalledWith("v-code"));
      expect((await screen.findByRole("status")).textContent).toMatch(/done/i);
    });

    it("applies a recoverEmail code", async () => {
      vi.mocked(firebase.applyEmailActionCode).mockResolvedValueOnce(undefined);
      renderWith({ mode: "recoverEmail", oobCode: "r-code" });
      await waitFor(() => expect(firebase.applyEmailActionCode).toHaveBeenCalledWith("r-code"));
    });

    it("does not blank-page an unknown mode", async () => {
      renderWith({ mode: "somethingElse", oobCode: "x" });
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/unsupported link type/i);
      expect(alert.textContent).toMatch(/somethingElse/);
    });
  });
});
