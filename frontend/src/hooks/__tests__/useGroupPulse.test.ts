import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { useGroupPulse } from "@/hooks/useGroupPulse";

function mockPulse(body: { revision?: number; turnInFlight?: boolean; activeDevices?: number }) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useGroupPulse", () => {
  it("does not poll when disabled", () => {
    const { result } = renderHook(() => useGroupPulse("act-1", { enabled: false }));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current).toEqual({ revision: 0, turnInFlight: false, activeDevices: 0 });
  });

  it("polls the pulse endpoint with the activityId + a device token and reflects the response", async () => {
    mockPulse({ revision: 3, turnInFlight: true, activeDevices: 2 });

    // Large interval so only the immediate first tick fires during the test.
    const { result } = renderHook(() =>
      useGroupPulse("act-1", { enabled: true, intervalMs: 100000 }),
    );

    await waitFor(() => expect(result.current.revision).toBe(3));
    expect(result.current.turnInFlight).toBe(true);
    expect(result.current.activeDevices).toBe(2);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/proxy/api/auth/group/pulse?");
    expect(url).toContain("activityId=act-1");
    expect(url).toMatch(/device=.+/); // a per-tab presence token rides every poll
  });

  it("still sends a device token when there is no activityId (group-level session)", async () => {
    mockPulse({ revision: 0, turnInFlight: false, activeDevices: 0 });

    renderHook(() => useGroupPulse(null, { enabled: true, intervalMs: 100000 }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/proxy/api/auth/group/pulse?");
    expect(url).not.toContain("activityId=");
    expect(url).toMatch(/device=.+/);
  });

  it("keeps the last known pulse on a transient fetch error", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() =>
      useGroupPulse("act-1", { enabled: true, intervalMs: 100000 }),
    );
    // Never throws; stays at IDLE.
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current).toEqual({ revision: 0, turnInFlight: false, activeDevices: 0 });
  });
});
