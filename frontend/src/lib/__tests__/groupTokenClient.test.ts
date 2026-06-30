/**
 * groupTokenClient.refreshGroupSession — the reactive recovery primitive for
 * the anonymous-group (student) token (log triage 2026-06-30 fix).
 *
 * Contract under test:
 *   - no stored token / not anon mode → null, no network call
 *   - 200 → persist new token, carry client-only fields forward, notify
 *   - 401 → terminal: clear storage, notify null, return null
 *   - 5xx / network → keep existing token (transient)
 *   - concurrent calls share ONE round-trip (in-flight dedup)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { ANON_GROUP_TOKEN_STORAGE_KEY } from "@/lib/anonymousGroupAuth";
import { onGroupSessionChange, refreshGroupSession } from "@/lib/groupTokenClient";

const EXPIRED = {
  token: "old.jwt",
  uid: "anon-PHYS7K2N",
  expires_at: Date.now() / 1000 - 100,
  group_code: "ABCD-1234",
  class_id: "cls-1",
  skill_ids: ["s1"],
};

function seed(session: unknown): void {
  sessionStorage.setItem(ANON_GROUP_TOKEN_STORAGE_KEY, JSON.stringify(session));
}
function stored(): { token?: string } | null {
  const raw = sessionStorage.getItem(ANON_GROUP_TOKEN_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { token?: string }) : null;
}
function jsonResp(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  sessionStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "anonymous_group_id");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("refreshGroupSession", () => {
  it("returns null without a network call when nothing is stored", async () => {
    expect(await refreshGroupSession()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null without a network call outside anonymous-group mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", "firebase");
    seed(EXPIRED);
    expect(await refreshGroupSession()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on 200 persists the fresh token, carries client-only fields forward, and notifies", async () => {
    seed(EXPIRED);
    const fresh = { token: "new.jwt", uid: "anon-PHYS7K2N", expires_at: Date.now() / 1000 + 28800 };
    fetchMock.mockResolvedValueOnce(jsonResp(200, fresh));
    const seen: Array<{ token?: string } | null> = [];
    const off = onGroupSessionChange((s) => seen.push(s));

    const res = await refreshGroupSession();
    off();

    expect(res?.token).toBe("new.jwt");
    expect(res?.group_code).toBe("ABCD-1234"); // carried forward (refresh omits it)
    expect(res?.class_id).toBe("cls-1");
    expect(stored()?.token).toBe("new.jwt");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.token).toBe("new.jwt");
  });

  it("on 401 is terminal — clears storage, notifies null, returns null", async () => {
    seed(EXPIRED);
    fetchMock.mockResolvedValueOnce(jsonResp(401, { detail: "group revoked" }));
    const seen: Array<unknown> = [];
    const off = onGroupSessionChange((s) => seen.push(s));

    const res = await refreshGroupSession();
    off();

    expect(res).toBeNull();
    expect(stored()).toBeNull();
    expect(seen).toEqual([null]);
  });

  it("on a transient 5xx keeps the existing token", async () => {
    seed(EXPIRED);
    fetchMock.mockResolvedValueOnce(jsonResp(503, { detail: "busy" }));
    const res = await refreshGroupSession();
    expect(res?.token).toBe("old.jwt");
    expect(stored()?.token).toBe("old.jwt");
  });

  it("dedups concurrent callers into one network round-trip", async () => {
    seed(EXPIRED);
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));

    const a = refreshGroupSession();
    const b = refreshGroupSession();
    resolve(jsonResp(200, { token: "new.jwt", uid: "anon-PHYS7K2N", expires_at: Date.now() / 1000 + 28800 }));
    const [ra, rb] = await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ra?.token).toBe("new.jwt");
    expect(rb?.token).toBe("new.jwt");
  });
});
