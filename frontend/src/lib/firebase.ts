import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
  type Auth,
  getAuth,
  getIdTokenResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { type Firestore, getFirestore } from "firebase/firestore";
import {
  isAnonymousGroupAuthMode,
  readStoredGroupSessionRaw,
} from "@/lib/anonymousGroupAuth";
import {
  GROUP_REFRESH_SKEW_SECONDS,
  refreshGroupSession,
} from "@/lib/groupTokenClient";
import { isLocalMode, LOCAL_MODE_STUB_TOKEN } from "@/lib/localMode";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;

function isConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

export function getFirebaseApp(): FirebaseApp | null {
  // LOCAL_MODE: no Firebase init at all — LocalAuthProvider supplies a
  // deterministic identity. Returning null keeps existing `if (!app)`
  // branches working without further changes.
  if (isLocalMode()) return null;
  if (!isConfigured()) return null;
  if (appInstance) return appInstance;
  appInstance = getApps()[0] ?? initializeApp(firebaseConfig);
  return appInstance;
}

export function getFirebaseAuth(): Auth | null {
  if (authInstance) return authInstance;
  const app = getFirebaseApp();
  if (!app) return null;
  authInstance = getAuth(app);
  return authInstance;
}

export function subscribeToAuthState(
  callback: (user: User | null) => void,
): () => void {
  const auth = getFirebaseAuth();
  if (!auth) {
    // Not configured (e.g. build time or missing env). Report signed-out.
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

/**
 * Subscribe to Firebase ID-TOKEN changes — fires on sign-in, sign-out, AND the
 * silent ~hourly token rotation (Firebase proactively refreshes ~5min before
 * expiry while a listener is active). `subscribeToAuthState` (onAuthStateChanged)
 * does NOT fire on rotation, so long-lived holders of a token (the AG-UI stream's
 * HttpAgent, which bakes the token into its headers) go stale after ~1h and the
 * next request 401s "Token expired". Use this to keep such a token fresh.
 *
 * The callback receives a freshly-minted token string (or null when signed out),
 * so callers don't need to re-fetch.
 */
export function subscribeToIdToken(onToken: (token: string | null) => void): () => void {
  const auth = getFirebaseAuth();
  if (!auth) {
    onToken(null);
    return () => {};
  }
  return onIdTokenChanged(auth, async (user) => {
    onToken(user ? await user.getIdToken() : null);
  });
}

export async function getIdToken(): Promise<string | null> {
  // Anonymous group-ID mode (sprint 2.11): token lives in sessionStorage,
  // written by AnonymousGroupAuthProvider. If a session exists, use it —
  // this covers students who have joined a group (including in LOCAL_MODE).
  // If no session exists, fall through: LOCAL_MODE can still supply the
  // workshop stub for teacher routes that don't require a group session.
  if (isAnonymousGroupAuthMode()) {
    // Read WITHOUT the expiry purge so an at/near-expiry token can still be
    // refreshed (the refresh endpoint accepts an expired-but-valid-signature
    // token). If it's safely in-window, use it as-is; otherwise refresh first
    // so no request goes out with a dead token (returns null only when the
    // code is terminally revoked/expired).
    const session = readStoredGroupSessionRaw();
    if (session?.token) {
      if (session.expires_at > Date.now() / 1000 + GROUP_REFRESH_SKEW_SECONDS) {
        return session.token;
      }
      const refreshed = await refreshGroupSession();
      return refreshed?.token ?? null;
    }
  }
  // LOCAL_MODE: every request sends the well-known stub token so the
  // backend's auth/local_mode_stub.py grants it. fetchWithAuth wires this
  // into the Authorization header on every /api/proxy/* request.
  if (isLocalMode()) return LOCAL_MODE_STUB_TOKEN;
  const auth = getFirebaseAuth();
  if (!auth?.currentUser) return null;
  return auth.currentUser.getIdToken();
}

/**
 * Sign in with Google. Prefers a popup; on Safari (which blocks third-party
 * storage the popup flow relies on unless the user clicks very recently), the
 * caller can fall back to `signInWithGoogleRedirect`. We do NOT try to detect
 * Safari automatically — popup failure is caught by the caller and re-tried
 * via redirect on that code path.
 */
export async function signInWithGoogle(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("firebase not configured");
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

export async function signInWithGoogleRedirect(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("firebase not configured");
  const provider = new GoogleAuthProvider();
  await signInWithRedirect(auth, provider);
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("firebase not configured");
  await signInWithEmailAndPassword(auth, email, password);
}

/**
 * Send a password-reset email so a teacher can recover their own password.
 *
 * Teachers at schools with no Google identity sign in with email/password
 * (their account is minted by `aiplatform users invite-password`). Without this
 * they had no way back in after forgetting it — an admin had to mint a fresh
 * link, which is not a thing anyone should have to wait on mid-lesson.
 *
 * Deliberately resolves even when the address has no account: the caller shows
 * the same message either way, so this cannot be used to ask "does this teacher
 * have an account?". Firebase's own email-enumeration protection does the same,
 * but the guarantee should not depend on a console setting.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("firebase not configured");
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    if (code === "auth/user-not-found" || code === "auth/invalid-email") return;
    throw err;
  }
}

/**
 * Get the ID token for a teacher (Firebase OAuth user).
 *
 * Unlike the shared `getIdToken()`, this function never falls through to
 * the anonymous-group sessionStorage token — teacher API calls must carry
 * a Firebase token regardless of the student auth mode the app is running in.
 */
export async function getTeacherIdToken(): Promise<string | null> {
  if (isLocalMode()) return LOCAL_MODE_STUB_TOKEN;
  const auth = getFirebaseAuth();
  if (!auth?.currentUser) return null;
  return auth.currentUser.getIdToken();
}

export async function signOut(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) return;
  await fbSignOut(auth);
}

/**
 * Whether the signed-in teacher carries the `role:researcher` custom
 * claim (sprint 1.1.5). Researchers get the cross-class Research view.
 *
 * LOCAL_MODE has no real Firebase user, so it mirrors the backend's
 * `LOCAL_MODE_RESEARCHER` switch via `NEXT_PUBLIC_LOCAL_MODE_RESEARCHER`
 * for dev. Returns false when not configured or signed out.
 */
export async function getIsResearcher(): Promise<boolean> {
  if (isLocalMode()) {
    const raw = (process.env.NEXT_PUBLIC_LOCAL_MODE_RESEARCHER ?? "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  }
  const auth = getFirebaseAuth();
  if (!auth?.currentUser) return false;
  const result = await getIdTokenResult(auth.currentUser);
  return result.claims.role === "researcher";
}

export function getFirestoreDb(): Firestore | null {
  const app = getFirebaseApp();
  if (!app) return null;
  return getFirestore(app);
}

export function firestoreTimestampToIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const d = (value as { toDate: () => Date }).toDate?.();
    return d instanceof Date ? d.toISOString() : null;
  }
  return null;
}

export type { User };
