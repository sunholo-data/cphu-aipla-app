import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithAuth = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
vi.mock("@/lib/apiClient", () => ({ fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a) }));

import { useSimSnapshotPush } from "../useSimSnapshotPush";

function sentBody(): Record<string, unknown> {
  const init = fetchWithAuth.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string);
}

describe("useSimSnapshotPush — what a push was (1.1.136 M0)", () => {
  beforeEach(() => fetchWithAuth.mockClear());

  it("sends logLabel and activityId without making the push a card", () => {
    const { result } = renderHook(() => useSimSnapshotPush<{ n: number }>("sess-1", "table"));
    void result.current({ n: 1 }, "table.commit", null, { logLabel: "Table shared (3 cells)", activityId: "act-7" });
    const body = sentBody();
    expect(body.logLabel).toBe("Table shared (3 cells)");
    expect(body.activityId).toBe("act-7");
    // No card label: a per-cell push must not restore as a card or bump.
    expect(body).not.toHaveProperty("label");
  });

  it("clips labels to the backend's caps so a long title never 422s the push", () => {
    const { result } = renderHook(() => useSimSnapshotPush<{ n: number }>("sess-1", "table"));
    void result.current({ n: 1 }, "table.commit", "x".repeat(300), { logLabel: "y".repeat(300) });
    const body = sentBody();
    expect((body.label as string).length).toBe(200);
    expect((body.logLabel as string).length).toBe(200);
  });

  it("omits both fields for a caller that passes no meta (old callers keep working)", () => {
    const { result } = renderHook(() => useSimSnapshotPush<{ n: number }>("sess-1", "boldkast"));
    void result.current({ n: 1 }, "boldkast.launch", "Launched");
    const body = sentBody();
    expect(body.label).toBe("Launched");
    expect(body).not.toHaveProperty("logLabel");
    expect(body).not.toHaveProperty("activityId");
  });
});
