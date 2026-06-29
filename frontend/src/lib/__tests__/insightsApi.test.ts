/**
 * Characterization (golden-master) tests for `@/lib/insightsApi`.
 *
 * Pins the CURRENT behavior of the `/api/insights/*` client:
 *   (1) the exact URL/path each KPI/trend/summary/compare/groups/activities
 *       call builds, including the `_query` param assembly (since/until/scope),
 *   (2) the snake_case -> camelCase mapping each call applies,
 *   (3) the `_debug.queries` passthrough on the per-class payloads, and
 *   (4) the `_ok` error helper (default error message + status + sliced body).
 *
 * Transport: insightsApi imports `fetchWithTeacherAuth as fetchWithAuth`.
 * We mock `@/lib/apiClient` and assert on the args it was called with.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchWithTeacherAuth = vi.fn();
const fetchWithAuth = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithTeacherAuth: (...a: unknown[]) => fetchWithTeacherAuth(...a),
  fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a),
}));

import * as api from "@/lib/insightsApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status });
}

function mockResp(body: unknown, status = 200) {
  fetchWithTeacherAuth.mockResolvedValueOnce(jsonResponse(body, status));
}

function lastUrl(): string {
  const calls = fetchWithTeacherAuth.mock.calls;
  return calls[calls.length - 1][0] as string;
}

const DEBUG = {
  queries: [{ name: "q1", sql: "SELECT 1", params: { a: 1 } }],
};

afterEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// transport — insights is teacher-only
// ---------------------------------------------------------------------------
describe("insightsApi — transport", () => {
  it("uses fetchWithTeacherAuth (never the group helper)", async () => {
    mockResp({ since: "s", until: "u", classes: [] });
    await api.fetchInsightsSummary();
    expect(fetchWithTeacherAuth).toHaveBeenCalledTimes(1);
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// _query param assembly — observed via fetchInsightsSummary's URL
// ---------------------------------------------------------------------------
describe("insightsApi — _query param assembly", () => {
  it("default since='7d', no until, scope='own' -> ?since=7d (scope omitted)", async () => {
    mockResp({ since: "s", until: "u", classes: [] });
    await api.fetchInsightsSummary();
    expect(lastUrl()).toBe("/api/proxy/api/insights/summary?since=7d");
  });

  it("explicit since='30d' is reflected", async () => {
    mockResp({ since: "s", until: "u", classes: [] });
    await api.fetchInsightsSummary("30d");
    expect(lastUrl()).toBe("/api/proxy/api/insights/summary?since=30d");
  });

  it("until appends &until=<value> (URL-encoded by URLSearchParams)", async () => {
    mockResp({ since: "s", until: "u", classes: [] });
    await api.fetchInsightsSummary("7d", "2026-06-29T00:00:00Z");
    expect(lastUrl()).toBe(
      "/api/proxy/api/insights/summary?since=7d&until=2026-06-29T00%3A00%3A00Z",
    );
  });

  it("scope='own' (the default) is NOT sent — preserves existing cache-key shape", async () => {
    mockResp({ since: "s", until: "u", classes: [] });
    await api.fetchInsightsSummary("7d", undefined, "own");
    expect(lastUrl()).toBe("/api/proxy/api/insights/summary?since=7d");
  });

  it("scope='all' IS sent as &scope=all", async () => {
    mockResp({ since: "s", until: "u", classes: [] });
    await api.fetchInsightsSummary("7d", undefined, "all");
    expect(lastUrl()).toBe("/api/proxy/api/insights/summary?since=7d&scope=all");
  });

  it("all three params together: since + until + scope (in that order)", async () => {
    mockResp({ since: "s", until: "u", classes: [] });
    await api.fetchInsightsSummary("30d", "2026-06-01", "all");
    expect(lastUrl()).toBe(
      "/api/proxy/api/insights/summary?since=30d&until=2026-06-01&scope=all",
    );
  });
});

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------
describe("insightsApi — fetchInsightsSummary", () => {
  it("maps snake_case class rows -> camelCase", async () => {
    mockResp({
      since: "S",
      until: "U",
      classes: [
        {
          class_id: "c1",
          name: "Physics",
          owner_uid: "o1",
          ownerLabel: "Alice",
          active_groups: 2,
          total_messages: 10,
          last_activity: "t",
        },
      ],
    });
    const r = await api.fetchInsightsSummary();
    expect(r).toEqual({
      since: "S",
      until: "U",
      classes: [
        {
          classId: "c1",
          name: "Physics",
          ownerUid: "o1",
          ownerLabel: "Alice",
          activeGroups: 2,
          totalMessages: 10,
          lastActivity: "t",
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------
describe("insightsApi — fetchInsightsCompare", () => {
  it("GET /api/insights/compare with the same _query assembly", async () => {
    mockResp({ since: "S", until: "U", rows: [] });
    await api.fetchInsightsCompare("30d", undefined, "all");
    expect(lastUrl()).toBe(
      "/api/proxy/api/insights/compare?since=30d&scope=all",
    );
  });

  it("maps the compare rows snake_case -> camelCase", async () => {
    mockResp({
      since: "S",
      until: "U",
      rows: [
        {
          class_id: "c1",
          name: "Physics",
          owner_uid: "o1",
          ownerLabel: "Alice",
          active_groups: 2,
          messages: 10,
          messages_prior: 7,
          messages_delta: 3,
          sim_runs: 4,
          last_activity: "t",
        },
      ],
    });
    const r = await api.fetchInsightsCompare();
    expect(r).toEqual({
      since: "S",
      until: "U",
      rows: [
        {
          classId: "c1",
          name: "Physics",
          ownerUid: "o1",
          ownerLabel: "Alice",
          activeGroups: 2,
          messages: 10,
          messagesPrior: 7,
          messagesDelta: 3,
          simRuns: 4,
          lastActivity: "t",
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// class KPIs — note: per-class calls do NOT accept a scope arg (only since/until)
// ---------------------------------------------------------------------------
describe("insightsApi — fetchInsightsClassKpis", () => {
  it("GET /classes/{id}/kpis?since=7d by default, classId encoded", async () => {
    mockResp({
      class_id: "c 1",
      since: "S",
      until: "U",
      kpis: {
        active_groups: 1,
        total_messages: 2,
        active_activities: 3,
        sim_runs: 4,
        median_time_on_task_min: 5,
        last_activity: "t",
      },
      _debug: DEBUG,
    });
    await api.fetchInsightsClassKpis("c 1");
    expect(lastUrl()).toBe(
      "/api/proxy/api/insights/classes/c%201/kpis?since=7d",
    );
  });

  it("passes since + until (no scope on per-class calls)", async () => {
    mockResp({
      class_id: "c1",
      since: "S",
      until: "U",
      kpis: {
        active_groups: 0,
        total_messages: 0,
        active_activities: 0,
        sim_runs: 0,
        median_time_on_task_min: 0,
        last_activity: null,
      },
      _debug: { queries: [] },
    });
    await api.fetchInsightsClassKpis("c1", "30d", "2026-06-01");
    expect(lastUrl()).toBe(
      "/api/proxy/api/insights/classes/c1/kpis?since=30d&until=2026-06-01",
    );
  });

  it("maps the kpis block and passes _debug through unchanged", async () => {
    mockResp({
      class_id: "c1",
      since: "S",
      until: "U",
      kpis: {
        active_groups: 1,
        total_messages: 2,
        active_activities: 3,
        sim_runs: 4,
        median_time_on_task_min: 5,
        last_activity: "t",
      },
      _debug: DEBUG,
    });
    const r = await api.fetchInsightsClassKpis("c1");
    expect(r).toEqual({
      classId: "c1",
      since: "S",
      until: "U",
      kpis: {
        activeGroups: 1,
        totalMessages: 2,
        activeActivities: 3,
        simRuns: 4,
        medianTimeOnTaskMin: 5,
        lastActivity: "t",
      },
      _debug: DEBUG,
    });
    // _debug is passed straight through by the mapper (no per-field remap),
    // so it arrives structurally identical to what the backend sent.
    expect(r._debug).toEqual(DEBUG);
    expect(r._debug.queries[0].sql).toBe("SELECT 1");
  });
});

// ---------------------------------------------------------------------------
// class groups
// ---------------------------------------------------------------------------
describe("insightsApi — fetchInsightsClassGroups", () => {
  it("GET /classes/{id}/groups + maps rows + _debug passthrough", async () => {
    mockResp({
      class_id: "c1",
      groups: [{ group_code: "g1", message_count: 5, session_count: 2 }],
      _debug: DEBUG,
    });
    const r = await api.fetchInsightsClassGroups("c1", "30d");
    expect(lastUrl()).toBe(
      "/api/proxy/api/insights/classes/c1/groups?since=30d",
    );
    expect(r).toEqual({
      classId: "c1",
      groups: [{ groupCode: "g1", messageCount: 5, sessionCount: 2 }],
      _debug: DEBUG,
    });
  });
});

// ---------------------------------------------------------------------------
// class trend
// ---------------------------------------------------------------------------
describe("insightsApi — fetchInsightsClassTrend", () => {
  it("GET /classes/{id}/trend + maps per_day -> perDay + _debug passthrough", async () => {
    mockResp({
      class_id: "c1",
      per_day: [
        { day: "2026-06-28", count: 3 },
        { day: "2026-06-29", count: 7 },
      ],
      _debug: DEBUG,
    });
    const r = await api.fetchInsightsClassTrend("c1");
    expect(lastUrl()).toBe(
      "/api/proxy/api/insights/classes/c1/trend?since=7d",
    );
    expect(r).toEqual({
      classId: "c1",
      perDay: [
        { day: "2026-06-28", count: 3 },
        { day: "2026-06-29", count: 7 },
      ],
      _debug: DEBUG,
    });
  });
});

// ---------------------------------------------------------------------------
// class activities
// ---------------------------------------------------------------------------
describe("insightsApi — fetchInsightsClassActivities", () => {
  it("GET /classes/{id}/activities + maps rows + _debug passthrough", async () => {
    mockResp({
      class_id: "c1",
      activities: [{ skill_id: "sk1", active_groups: 2, sim_runs: 9 }],
      _debug: DEBUG,
    });
    const r = await api.fetchInsightsClassActivities("c1", "all");
    expect(lastUrl()).toBe(
      "/api/proxy/api/insights/classes/c1/activities?since=all",
    );
    expect(r).toEqual({
      classId: "c1",
      activities: [{ skillId: "sk1", activeGroups: 2, simRuns: 9 }],
      _debug: DEBUG,
    });
  });
});

// ---------------------------------------------------------------------------
// _ok error helper — exercised through any call
// ---------------------------------------------------------------------------
describe("insightsApi — _ok error helper", () => {
  it("throws '<what> failed (<status>): <body>' on a non-ok response", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("kaboom", 500));
    await expect(api.fetchInsightsSummary()).rejects.toThrow(
      "fetch insights summary failed (500): kaboom",
    );
  });

  it("each call carries its own `what` label", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("x", 503));
    await expect(api.fetchInsightsClassKpis("c1")).rejects.toThrow(
      "fetch insights class kpis failed (503): x",
    );

    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("x", 403));
    await expect(api.fetchInsightsCompare()).rejects.toThrow(
      "fetch insights compare failed (403): x",
    );

    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("x", 404));
    await expect(api.fetchInsightsClassGroups("c1")).rejects.toThrow(
      "fetch insights class groups failed (404): x",
    );

    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("x", 404));
    await expect(api.fetchInsightsClassTrend("c1")).rejects.toThrow(
      "fetch insights class trend failed (404): x",
    );

    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("x", 404));
    await expect(api.fetchInsightsClassActivities("c1")).rejects.toThrow(
      "fetch insights class activities failed (404): x",
    );
  });

  it("slices the error body to 200 chars", async () => {
    const big = "y".repeat(500);
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse(big, 500));
    let msg = "";
    try {
      await api.fetchInsightsSummary();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBe(
      `fetch insights summary failed (500): ${"y".repeat(200)}`,
    );
  });

  it("404 is a PLAIN Error (insights has no NotFoundError mapping)", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("", 404));
    const err = await api.fetchInsightsSummary().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("Error");
  });
});
