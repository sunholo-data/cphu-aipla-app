import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock Next.js router
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

// Mock localMode
vi.mock("@/lib/localMode", () => ({
  isLocalMode: vi.fn(() => false),
  LOCAL_MODE_STUB_TOKEN: "local-mode-stub-token",
  LOCAL_MODE_WORKSHOP_USER: {
    uid: "workshop-user",
    email: "workshop@local",
    displayName: "Workshop User",
    photoURL: null,
  },
}));

// Mock firebase subscribeToAuthState
const mockUnsubscribe = vi.fn();
let capturedCallback: ((user: unknown) => void) | null = null;
vi.mock("@/lib/firebase", () => ({
  subscribeToAuthState: vi.fn((cb) => {
    capturedCallback = cb;
    return mockUnsubscribe;
  }),
  getIdToken: vi.fn(async () => null),
}));

import { isLocalMode } from "@/lib/localMode";
import { useTeacherAuth } from "@/hooks/useTeacherAuth";

describe("useTeacherAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallback = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in loading state", () => {
    const { result } = renderHook(() => useTeacherAuth());
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
  });

  it("resolves user when Firebase auth fires", async () => {
    const { result } = renderHook(() => useTeacherAuth());
    const fakeUser = { uid: "teacher-1", email: "t@example.com" };

    await vi.waitFor(() => expect(capturedCallback).not.toBeNull());
    capturedCallback!(fakeUser);

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.user).toEqual(fakeUser);
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects to /teacher/sign-in when no user and not LOCAL_MODE", async () => {
    vi.mocked(isLocalMode).mockReturnValue(false);
    const { result } = renderHook(() => useTeacherAuth());

    await vi.waitFor(() => expect(capturedCallback).not.toBeNull());
    capturedCallback!(null);

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(mockReplace).toHaveBeenCalledWith("/teacher/sign-in");
  });

  it("does NOT redirect in LOCAL_MODE even with no Firebase user", async () => {
    vi.mocked(isLocalMode).mockReturnValue(true);
    const { result } = renderHook(() => useTeacherAuth());

    await vi.waitFor(() => expect(capturedCallback).not.toBeNull());
    capturedCallback!(null);

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useTeacherAuth());
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
