import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/firebase", () => ({
  signInWithGoogle: vi.fn(),
  signInWithGoogleRedirect: vi.fn(),
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
});
