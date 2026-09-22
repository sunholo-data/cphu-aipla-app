/**
 * The Google sign-in provider must always ask which account (1.1.124).
 *
 * Regression test for the silent auto-select: with exactly one Google session
 * in the browser, a bare `GoogleAuthProvider` signs straight through, so a
 * teacher invited under one address lands in the app under another and has no
 * way inside the product to correct it. Both entry points — popup and the
 * Safari redirect fallback — must carry `prompt=select_account`, because a
 * teacher on Safari reaches the redirect path and would otherwise keep the bug.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const setCustomParameters = vi.fn();
const signInWithPopup = vi.fn();
const signInWithRedirect = vi.fn();

vi.mock("firebase/app", () => ({
  getApps: () => [{}],
  initializeApp: () => ({}),
}));

vi.mock("firebase/firestore", () => ({ getFirestore: () => ({}) }));

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {
    setCustomParameters = setCustomParameters;
  },
  getAuth: () => ({}),
  signInWithPopup,
  signInWithRedirect,
  applyActionCode: vi.fn(),
  confirmPasswordReset: vi.fn(),
  getIdTokenResult: vi.fn(),
  onAuthStateChanged: vi.fn(),
  onIdTokenChanged: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  verifyPasswordResetCode: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "test-project";
  vi.resetModules();
});

describe("Google sign-in always offers the account chooser", () => {
  it("sets prompt=select_account on the popup flow", async () => {
    const { signInWithGoogle } = await import("@/lib/firebase");
    await signInWithGoogle();

    expect(setCustomParameters).toHaveBeenCalledWith({
      prompt: "select_account",
    });
    expect(signInWithPopup).toHaveBeenCalledOnce();
  });

  it("sets prompt=select_account on the redirect fallback too", async () => {
    const { signInWithGoogleRedirect } = await import("@/lib/firebase");
    await signInWithGoogleRedirect();

    expect(setCustomParameters).toHaveBeenCalledWith({
      prompt: "select_account",
    });
    expect(signInWithRedirect).toHaveBeenCalledOnce();
  });
});
