/**
 * fetchWithAuth — reactive group-token recovery (log triage 2026-06-30 fix).
 *
 * On a 401 in anonymous-group mode, fetchWithAuth must refresh the group token
 * and retry ONCE. It must NOT retry on success, on a terminal refresh (no new
 * token), outside anon mode, or when the refresh hands back the same token.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getIdToken = vi.fn();
const getTeacherIdToken = vi.fn();
vi.mock("@/lib/firebase", () => ({
  getIdToken: () => getIdToken(),
  getTeacherIdToken: () => getTeacherIdToken(),
}));

const refreshGroupSession = vi.fn();
vi.mock("@/lib/groupTokenClient", () => ({
  refreshGroupSession: () => refreshGroupSession(),
}));

const isAnonymousGroupAuthMode = vi.fn();
vi.mock("@/lib/anonymousGroupAuth", () => ({
  isAnonymousGroupAuthMode: () => isAnonymousGroupAuthMode(),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { fetchWithAuth } from "@/lib/apiClient";

function resp(status: number) {
  return { status, ok: status >= 200 && status < 300 } as Response;
}
function authHeaderOf(callIndex: number): string | null {
  const init = fetchMock.mock.calls[callIndex][1] as RequestInit;
  return new Headers(init.headers).get("Authorization");
}

beforeEach(() => {
  getIdToken.mockReset().mockResolvedValue("tok-1");
  refreshGroupSession.mockReset();
  isAnonymousGroupAuthMode.mockReset().mockReturnValue(true);
  fetchMock.mockReset();
});

describe("fetchWithAuth reactive recovery", () => {
  it("returns a 2xx untouched and never refreshes", async () => {
    fetchMock.mockResolvedValueOnce(resp(200));
    const r = await fetchWithAuth("/api/proxy/api/skills");
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshGroupSession).not.toHaveBeenCalled();
    expect(authHeaderOf(0)).toBe("Bearer tok-1");
  });

  it("on 401 refreshes and retries once with the fresh token", async () => {
    fetchMock.mockResolvedValueOnce(resp(401)).mockResolvedValueOnce(resp(200));
    refreshGroupSession.mockResolvedValueOnce({ token: "tok-2" });

    const r = await fetchWithAuth("/api/proxy/api/skills");

    expect(refreshGroupSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeaderOf(1)).toBe("Bearer tok-2");
    expect(r.status).toBe(200);
  });

  it("surfaces the 401 when the refresh is terminal (no new token)", async () => {
    fetchMock.mockResolvedValueOnce(resp(401));
    refreshGroupSession.mockResolvedValueOnce(null);

    const r = await fetchWithAuth("/api/proxy/api/skills");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(401);
  });

  it("does not retry a 401 outside anonymous-group mode", async () => {
    isAnonymousGroupAuthMode.mockReturnValue(false);
    fetchMock.mockResolvedValueOnce(resp(401));

    const r = await fetchWithAuth("/api/proxy/api/skills");

    expect(refreshGroupSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(401);
  });

  it("does not retry when the refresh returns the same (stale) token", async () => {
    fetchMock.mockResolvedValueOnce(resp(401));
    refreshGroupSession.mockResolvedValueOnce({ token: "tok-1" });

    const r = await fetchWithAuth("/api/proxy/api/skills");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(401);
  });
});
