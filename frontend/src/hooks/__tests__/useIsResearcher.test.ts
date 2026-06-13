import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useIsResearcher } from "@/hooks/useIsResearcher";
import * as firebase from "@/lib/firebase";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useIsResearcher", () => {
  it("returns false until resolved and when not a researcher", async () => {
    vi.spyOn(firebase, "getIsResearcher").mockResolvedValue(false);
    vi.spyOn(firebase, "subscribeToAuthState").mockReturnValue(() => {});

    const { result } = renderHook(() => useIsResearcher());
    expect(result.current).toBe(false);
    // stays false after the async resolve
    await waitFor(() => expect(firebase.getIsResearcher).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("flips to true once the claim resolves", async () => {
    vi.spyOn(firebase, "getIsResearcher").mockResolvedValue(true);
    vi.spyOn(firebase, "subscribeToAuthState").mockReturnValue(() => {});

    const { result } = renderHook(() => useIsResearcher());
    await waitFor(() => expect(result.current).toBe(true));
  });
});
