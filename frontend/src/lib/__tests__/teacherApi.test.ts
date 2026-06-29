/**
 * Characterization (golden-master) tests for `@/lib/teacherApi`.
 *
 * This client is mocked in 16 page-test files but has no direct test of its
 * own logic. The refactor target is to dedupe its fetch/error boilerplate, so
 * we pin the contract first: for every exported function we assert
 *   (1) the exact URL/path it builds (query params + id interpolation),
 *   (2) the HTTP verb (incl. POST-vs-PATCH and the act-/legacy id branches),
 *   (3) the request body shape (the JSON sent), and
 *   (4) error mapping (404 -> NotFoundError, 409 -> ConflictError, default).
 *
 * These tests pin CURRENT behavior exactly, even where it looks surprising.
 * They do not modify any source.
 *
 * Transport: teacherApi imports `fetchWithTeacherAuth as fetchWithAuth` from
 * `@/lib/apiClient`. We mock that module and assert on the args the transport
 * was called with. No real server is involved.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchWithTeacherAuth = vi.fn();
const fetchWithAuth = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  // teacherApi only imports `fetchWithTeacherAuth` (aliased to fetchWithAuth
  // internally). We still expose both so the mock matches the real module.
  fetchWithTeacherAuth: (...a: unknown[]) => fetchWithTeacherAuth(...a),
  fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a),
}));

import * as api from "@/lib/teacherApi";
import { NotFoundError, ConflictError } from "@/lib/teacherApi";

/** Build a JSON 200 Response (the happy path for readJson). */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build a Response with a plain-text body (used for error-mapping cases). */
function textResponse(text: string, status: number): Response {
  return new Response(text, { status });
}

/** The single transport teacherApi uses. */
function mockResp(body: unknown, status = 200) {
  fetchWithTeacherAuth.mockResolvedValueOnce(jsonResponse(body, status));
}

/** First arg (URL) of the most recent transport call. */
function lastUrl(): string {
  const calls = fetchWithTeacherAuth.mock.calls;
  return calls[calls.length - 1][0] as string;
}

/** Second arg (init) of the most recent transport call. */
function lastInit(): RequestInit | undefined {
  const calls = fetchWithTeacherAuth.mock.calls;
  return calls[calls.length - 1][1] as RequestInit | undefined;
}

afterEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Transport selection — teacherApi always uses the teacher (Firebase) token.
// ---------------------------------------------------------------------------
describe("teacherApi — transport", () => {
  it("every call goes through fetchWithTeacherAuth (never the group helper)", async () => {
    mockResp({ activityId: "a", classId: "c", teacherUid: "t" });
    await api.fetchMyActivityConfig("c", "a");
    expect(fetchWithTeacherAuth).toHaveBeenCalledTimes(1);
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// activity-configs (legacy per-class config store)
// ---------------------------------------------------------------------------
describe("teacherApi — activity-configs", () => {
  it("fetchMyActivityConfig: GET /mine/{classId}/{activityId}, both encoded", async () => {
    mockResp({ activityId: "a b", classId: "c/d" });
    await api.fetchMyActivityConfig("c/d", "a b");
    expect(lastUrl()).toBe(
      "/api/proxy/api/activity-configs/mine/c%2Fd/a%20b",
    );
    // No init -> default GET.
    expect(lastInit()).toBeUndefined();
  });

  it("saveActivityConfig: POST /api/activity-configs with the full body", async () => {
    mockResp({ activityId: "a" });
    const body = {
      activityId: "a",
      classId: "c",
      title: "T",
      teachingGoal: "g",
      language: "da" as const,
    };
    await api.saveActivityConfig(body as never);
    expect(lastUrl()).toBe("/api/proxy/api/activity-configs");
    const init = lastInit()!;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("listMyActivities: GET with no query when classId omitted", async () => {
    mockResp([]);
    await api.listMyActivities();
    expect(lastUrl()).toBe("/api/proxy/api/activity-configs");
  });

  it("listMyActivities: GET ?classId=<encoded> when classId given", async () => {
    mockResp([]);
    await api.listMyActivities("c/1");
    expect(lastUrl()).toBe("/api/proxy/api/activity-configs?classId=c%2F1");
  });
});

// ---------------------------------------------------------------------------
// activities (ALS-1 class-independent act- store) — POST create vs PATCH edit
// ---------------------------------------------------------------------------
describe("teacherApi — activities (act- store)", () => {
  it("createActivity: POST /api/activities with the body (no id in path)", async () => {
    mockResp({ activityId: "act-1" });
    const body = {
      skillId: "concept-dialogue",
      classId: "c1",
      teachingGoal: "g",
      language: "en" as const,
    };
    await api.createActivity(body as never);
    expect(lastUrl()).toBe("/api/proxy/api/activities");
    const init = lastInit()!;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("fetchActivity: GET /api/activities/{id} (encoded), no init", async () => {
    mockResp({ activityId: "act-1" });
    await api.fetchActivity("act 1");
    expect(lastUrl()).toBe("/api/proxy/api/activities/act%201");
    expect(lastInit()).toBeUndefined();
  });

  it("updateActivity: PATCH (NOT POST) /api/activities/{id} with the body", async () => {
    mockResp({ activityId: "act-1" });
    const body = { skillId: "s", teachingGoal: "g", language: "da" as const };
    await api.updateActivity("act/1", body as never);
    expect(lastUrl()).toBe("/api/proxy/api/activities/act%2F1");
    const init = lastInit()!;
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("listActivities: default scope='own' -> ?owner=me", async () => {
    mockResp([]);
    await api.listActivities();
    expect(lastUrl()).toBe("/api/proxy/api/activities?owner=me");
  });

  it("listActivities: scope='all' -> ?scope=all (researcher view)", async () => {
    mockResp([]);
    await api.listActivities("all");
    expect(lastUrl()).toBe("/api/proxy/api/activities?scope=all");
  });

  it("listSharedCatalogue: GET /api/activities?published=true", async () => {
    mockResp([]);
    await api.listSharedCatalogue();
    expect(lastUrl()).toBe("/api/proxy/api/activities?published=true");
  });

  it("setActivityVisibility: POST /{id}/visibility with {visibility}", async () => {
    mockResp({ activityId: "act-1" });
    await api.setActivityVisibility("act-1", "published");
    expect(lastUrl()).toBe("/api/proxy/api/activities/act-1/visibility");
    const init = lastInit()!;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ visibility: "published" });
  });

  it("adoptActivity: POST /{id}/adopt with NO body and NO Content-Type header", async () => {
    mockResp({ activityId: "act-2" });
    await api.adoptActivity("act-1");
    expect(lastUrl()).toBe("/api/proxy/api/activities/act-1/adopt");
    const init = lastInit()!;
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it("duplicateActivity: POST /{id}/duplicate with NO body", async () => {
    mockResp({ activityId: "act-2" });
    await api.duplicateActivity("act 1");
    expect(lastUrl()).toBe("/api/proxy/api/activities/act%201/duplicate");
    const init = lastInit()!;
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("deleteActivity: DELETE /api/activities/{id}, returns void on ok", async () => {
    mockResp({}, 200);
    await expect(api.deleteActivity("act-1")).resolves.toBeUndefined();
    expect(lastUrl()).toBe("/api/proxy/api/activities/act-1");
    expect(lastInit()!.method).toBe("DELETE");
  });

  it("deleteActivity: treats 204 as success (no throw)", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.deleteActivity("act-1")).resolves.toBeUndefined();
  });

  it("deleteActivity: throws plain Error on a non-ok, non-204 status", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("nope", 500));
    await expect(api.deleteActivity("act-1")).rejects.toThrow(
      "delete activity: 500",
    );
  });
});

// ---------------------------------------------------------------------------
// classes/{id}/activities — assign/unassign
// ---------------------------------------------------------------------------
describe("teacherApi — class activities & bootstrap", () => {
  it("patchClassActivities: PATCH /classes/{id}/activities with add/remove body", async () => {
    mockResp({ classId: "c1" });
    await api.patchClassActivities("c1", { add: ["act-1"], remove: ["act-2"] });
    expect(lastUrl()).toBe("/api/proxy/api/classes/c1/activities");
    const init = lastInit()!;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      add: ["act-1"],
      remove: ["act-2"],
    });
  });

  it("bootstrapTeacher: POST /api/teacher/bootstrap with NO body", async () => {
    mockResp({ seeded: true });
    const r = await api.bootstrapTeacher();
    expect(lastUrl()).toBe("/api/proxy/api/teacher/bootstrap");
    expect(lastInit()!.method).toBe("POST");
    expect(lastInit()!.body).toBeUndefined();
    expect(r).toEqual({ seeded: true });
  });
});

// ---------------------------------------------------------------------------
// artefacts & personas — note these UNWRAP the envelope ({ artefacts }, { personas }).
// ---------------------------------------------------------------------------
describe("teacherApi — artefacts & personas", () => {
  it("listArtefacts: GET /api/artefacts?status=live, unwraps .artefacts", async () => {
    mockResp({ artefacts: [{ id: "art-1" }] });
    const r = await api.listArtefacts();
    expect(lastUrl()).toBe("/api/proxy/api/artefacts?status=live");
    expect(r).toEqual([{ id: "art-1" }]);
  });

  it("fetchPersonaList: GET /api/personas, unwraps .personas", async () => {
    mockResp({ personas: [{ id: "p1" }] });
    const r = await api.fetchPersonaList();
    expect(lastUrl()).toBe("/api/proxy/api/personas");
    expect(r).toEqual([{ id: "p1" }]);
  });

  it("fetchPersonaCatalogue: GET /api/personas, defaults missing fields", async () => {
    // Only personas present -> defaultId null, interactionStyles [].
    mockResp({ personas: [{ id: "p1" }] });
    const r = await api.fetchPersonaCatalogue();
    expect(lastUrl()).toBe("/api/proxy/api/personas");
    expect(r).toEqual({
      personas: [{ id: "p1" }],
      defaultId: null,
      interactionStyles: [],
    });
  });

  it("fetchPersonaCatalogue: passes through defaultId + interactionStyles", async () => {
    mockResp({
      personas: [{ id: "p1" }],
      defaultId: "p1",
      interactionStyles: [{ id: "socratic", prompt: "x", injected: false }],
    });
    const r = await api.fetchPersonaCatalogue();
    expect(r.defaultId).toBe("p1");
    expect(r.interactionStyles).toEqual([
      { id: "socratic", prompt: "x", injected: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// reports/groups — query-param assembly (session_id + refresh)
// ---------------------------------------------------------------------------
describe("teacherApi — group report", () => {
  it("fetchGroupLatestReport: GET /reports/groups/{code} with no query by default", async () => {
    mockResp({ sessionId: "s1" });
    await api.fetchGroupLatestReport("ABC");
    expect(lastUrl()).toBe("/api/proxy/api/reports/groups/ABC");
  });

  it("fetchGroupLatestReport: adds ?session_id=<id> when given", async () => {
    mockResp({ sessionId: "s1" });
    await api.fetchGroupLatestReport("AB C", "sess-9");
    expect(lastUrl()).toBe(
      "/api/proxy/api/reports/groups/AB%20C?session_id=sess-9",
    );
  });

  it("fetchGroupLatestReport: adds ?refresh=1 when opts.refresh, and both params together", async () => {
    mockResp({ sessionId: "s1" });
    await api.fetchGroupLatestReport("ABC", "sess-9", { refresh: true });
    expect(lastUrl()).toBe(
      "/api/proxy/api/reports/groups/ABC?session_id=sess-9&refresh=1",
    );
  });

  it("fetchGroupLatestReport: refresh alone (no session_id) -> ?refresh=1", async () => {
    mockResp({ sessionId: "s1" });
    await api.fetchGroupLatestReport("ABC", null, { refresh: true });
    expect(lastUrl()).toBe("/api/proxy/api/reports/groups/ABC?refresh=1");
  });
});

// ---------------------------------------------------------------------------
// classes/* CRUD
// ---------------------------------------------------------------------------
describe("teacherApi — classes CRUD", () => {
  it("listClasses: default scope -> GET /api/classes (no query), unwraps .classes", async () => {
    mockResp({ classes: [{ classId: "c1" }] });
    const r = await api.listClasses();
    expect(lastUrl()).toBe("/api/proxy/api/classes");
    expect(r).toEqual([{ classId: "c1" }]);
  });

  it("listClasses: scope='all' -> GET /api/classes?scope=all", async () => {
    mockResp({ classes: [] });
    await api.listClasses("all");
    expect(lastUrl()).toBe("/api/proxy/api/classes?scope=all");
  });

  it("createClass: POST /api/classes with the body", async () => {
    mockResp({ classId: "c1" });
    await api.createClass({ name: "Physics", description: "d" });
    expect(lastUrl()).toBe("/api/proxy/api/classes");
    const init = lastInit()!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Physics",
      description: "d",
    });
  });

  it("getClass: GET /api/classes/{id} (encoded), no init", async () => {
    mockResp({ classId: "c 1" });
    await api.getClass("c 1");
    expect(lastUrl()).toBe("/api/proxy/api/classes/c%201");
    expect(lastInit()).toBeUndefined();
  });

  it("patchClass: PATCH /api/classes/{id} with name/description", async () => {
    mockResp({ classId: "c1" });
    await api.patchClass("c1", { name: "X", description: null });
    expect(lastUrl()).toBe("/api/proxy/api/classes/c1");
    const init = lastInit()!;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "X",
      description: null,
    });
  });

  it("deleteClass: DELETE /api/classes/{id}", async () => {
    mockResp({ revoked: true, classId: "c1" });
    const r = await api.deleteClass("c1");
    expect(lastUrl()).toBe("/api/proxy/api/classes/c1");
    expect(lastInit()!.method).toBe("DELETE");
    expect(r).toEqual({ revoked: true, classId: "c1" });
  });
});

// ---------------------------------------------------------------------------
// voice / persona / capabilities — all PUT under /api/voice/class/{id}/...
// ---------------------------------------------------------------------------
describe("teacherApi — class voice / persona / capabilities", () => {
  it("setClassVoiceSettings: PUT /voice/class/{id}/settings with the body", async () => {
    mockResp({ ok: true });
    const body = { language: "da", voice: "v", provider: "p" };
    await api.setClassVoiceSettings("c1", body);
    expect(lastUrl()).toBe("/api/proxy/api/voice/class/c1/settings");
    const init = lastInit()!;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("setClassCapabilities: PUT /voice/class/{id}/capabilities with passed flags", async () => {
    mockResp({ ok: true });
    await api.setClassCapabilities("c1", { voiceInputEnabled: true });
    expect(lastUrl()).toBe("/api/proxy/api/voice/class/c1/capabilities");
    const init = lastInit()!;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ voiceInputEnabled: true });
  });

  it("setClassPersona: PUT /voice/class/{id}/persona with {personaId}", async () => {
    mockResp({ ok: true });
    await api.setClassPersona("c1", "p-9");
    expect(lastUrl()).toBe("/api/proxy/api/voice/class/c1/persona");
    const init = lastInit()!;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ personaId: "p-9" });
  });

  it("setClassPersona: null personaId serialises to {personaId: null}", async () => {
    mockResp({ ok: true });
    await api.setClassPersona("c1", null);
    expect(JSON.parse(lastInit()!.body as string)).toEqual({ personaId: null });
  });

  it("fetchVoiceList: GET /voice/voices with no query by default", async () => {
    mockResp({ languages: [], voices: {} });
    await api.fetchVoiceList();
    expect(lastUrl()).toBe("/api/proxy/api/voice/voices");
  });

  it("fetchVoiceList: GET /voice/voices?lang=<encoded> when lang given", async () => {
    mockResp({ languages: [], voices: {} });
    await api.fetchVoiceList("da DK");
    expect(lastUrl()).toBe("/api/proxy/api/voice/voices?lang=da%20DK");
  });
});

// ---------------------------------------------------------------------------
// lessons / groups
// ---------------------------------------------------------------------------
describe("teacherApi — lessons & group codes", () => {
  it("patchLessons: PATCH /classes/{id}/lessons with add/remove", async () => {
    mockResp({ classId: "c1" });
    await api.patchLessons("c1", { add: ["s1"], remove: ["s2"] });
    expect(lastUrl()).toBe("/api/proxy/api/classes/c1/lessons");
    const init = lastInit()!;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      add: ["s1"],
      remove: ["s2"],
    });
  });

  it("mintGroupCodes: POST /classes/{id}/groups with default count=1", async () => {
    mockResp({ classId: "c1", codes: ["abc"] });
    await api.mintGroupCodes("c1");
    expect(lastUrl()).toBe("/api/proxy/api/classes/c1/groups");
    const init = lastInit()!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ count: 1 });
  });

  it("mintGroupCodes: POST with explicit count", async () => {
    mockResp({ classId: "c1", codes: ["a", "b", "c"] });
    await api.mintGroupCodes("c1", 3);
    expect(JSON.parse(lastInit()!.body as string)).toEqual({ count: 3 });
  });

  it("revokeGroupCode: DELETE /classes/{id}/groups/{code}, both encoded", async () => {
    mockResp({ revoked: true, code: "x/y", classId: "c1" });
    await api.revokeGroupCode("c 1", "x/y");
    expect(lastUrl()).toBe("/api/proxy/api/classes/c%201/groups/x%2Fy");
    expect(lastInit()!.method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
// skills catalogue — bespoke error handling (not readJson), and field projection
// ---------------------------------------------------------------------------
describe("teacherApi — skills catalogue", () => {
  it("isTeacherOnlySkill: true only when type='tagged' AND tags include role:teacher", () => {
    expect(
      api.isTeacherOnlySkill({
        accessControl: { type: "tagged", tags: ["role:teacher"] },
      } as never),
    ).toBe(true);
    expect(
      api.isTeacherOnlySkill({
        accessControl: { type: "tagged", tags: ["role:student"] },
      } as never),
    ).toBe(false);
    expect(
      api.isTeacherOnlySkill({
        accessControl: { type: "public", tags: ["role:teacher"] },
      } as never),
    ).toBe(false);
    expect(api.isTeacherOnlySkill({ accessControl: null } as never)).toBe(false);
    expect(api.isTeacherOnlySkill({} as never)).toBe(false);
  });

  it("listAccessibleSkills: GET /api/skills and projects to the picker shape", async () => {
    mockResp([
      {
        skillId: "s1",
        name: "raw-name",
        ownerId: "o1",
        // displayName/description/avatar omitted -> defaults applied.
      },
    ]);
    const r = await api.listAccessibleSkills();
    expect(lastUrl()).toBe("/api/proxy/api/skills");
    expect(r).toEqual([
      {
        skillId: "s1",
        name: "raw-name",
        slug: null,
        displayName: "raw-name", // falls back to name
        description: "", // default
        avatar: "", // default
        ownerId: "o1",
        accessControl: null,
      },
    ]);
  });

  it("listAccessibleSkills: throws plain Error (NOT NotFoundError) on a 404", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("", 404));
    await expect(api.listAccessibleSkills()).rejects.toThrow("list skills: 404");
    // It does NOT route through readJson, so a 404 is a generic Error here.
    await expect(api.listAccessibleSkills()).rejects.not.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// recent sessions & reset — bespoke handling (empty array on !ok; throw on reset)
// ---------------------------------------------------------------------------
describe("teacherApi — recent sessions & reset", () => {
  it("listClassRecentSessions: GET /recent-sessions?page_size=<n> (default 20)", async () => {
    mockResp({ sessions: [] });
    await api.listClassRecentSessions("c1");
    expect(lastUrl()).toBe(
      "/api/proxy/api/classes/c1/recent-sessions?page_size=20",
    );
  });

  it("listClassRecentSessions: passes explicit pageSize", async () => {
    mockResp({ sessions: [] });
    await api.listClassRecentSessions("c1", 50);
    expect(lastUrl()).toBe(
      "/api/proxy/api/classes/c1/recent-sessions?page_size=50",
    );
  });

  it("listClassRecentSessions: returns [] (no throw) when the response is !ok", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("err", 500));
    await expect(api.listClassRecentSessions("c1")).resolves.toEqual([]);
  });

  it("listClassRecentSessions: maps the session rows through", async () => {
    mockResp({
      sessions: [
        {
          sessionId: "s1",
          ownerUid: "o1",
          skillId: "sk1",
          groupCode: "g1",
          lastMessageAt: "t",
          turnCount: 3,
          title: "T",
        },
      ],
    });
    const r = await api.listClassRecentSessions("c1");
    expect(r).toEqual([
      {
        sessionId: "s1",
        ownerUid: "o1",
        skillId: "sk1",
        groupCode: "g1",
        lastMessageAt: "t",
        turnCount: 3,
        title: "T",
      },
    ]);
  });

  it("resetGroupSession: POST /classes/{id}/groups/{code}/reset-session", async () => {
    mockResp({}, 200);
    await api.resetGroupSession("c1", "g1");
    expect(lastUrl()).toBe(
      "/api/proxy/api/classes/c1/groups/g1/reset-session",
    );
    expect(lastInit()!.method).toBe("POST");
  });

  it("resetGroupSession: throws with status + body when !ok", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("boom", 503));
    await expect(api.resetGroupSession("c1", "g1")).rejects.toThrow(
      "reset session failed (503): boom",
    );
  });
});

// ---------------------------------------------------------------------------
// live dashboard — bespoke handling (no readJson; throws on !ok)
// ---------------------------------------------------------------------------
describe("teacherApi — live dashboard", () => {
  it("listClassLive: GET /classes/{id}/live, returns raw JSON", async () => {
    const payload = { calls: [], groups: [], summary: null, generatedAt: "t" };
    mockResp(payload);
    const r = await api.listClassLive("c1");
    expect(lastUrl()).toBe("/api/proxy/api/classes/c1/live");
    expect(r).toEqual(payload);
  });

  it("listClassLive: throws on !ok", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("", 500));
    await expect(api.listClassLive("c1")).rejects.toThrow(
      "live fetch failed (500)",
    );
  });

  it("ackClassSignal: POST /classes/{id}/signals/{groupId}/ack, both encoded", async () => {
    mockResp({}, 200);
    await api.ackClassSignal("c 1", "g/2");
    expect(lastUrl()).toBe(
      "/api/proxy/api/classes/c%201/signals/g%2F2/ack",
    );
    expect(lastInit()!.method).toBe("POST");
  });

  it("ackClassSignal: throws on !ok", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("", 404));
    await expect(api.ackClassSignal("c1", "g1")).rejects.toThrow(
      "ack failed (404)",
    );
  });
});

// ---------------------------------------------------------------------------
// readJson error mapping — the shared helper that almost every method uses.
// Tested once thoroughly against a representative caller (fetchActivity).
// ---------------------------------------------------------------------------
describe("teacherApi — readJson error mapping", () => {
  it("404 -> NotFoundError carrying the per-call message", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("", 404));
    await expect(api.fetchActivity("act-1")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("", 404));
    await expect(api.fetchActivity("act-1")).rejects.toThrow("load activity");
  });

  it("409 -> ConflictError carrying the backend's `detail`", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(
      jsonResponse({ detail: "already exists" }, 409),
    );
    await expect(api.createActivity({} as never)).rejects.toBeInstanceOf(
      ConflictError,
    );
    fetchWithTeacherAuth.mockResolvedValueOnce(
      jsonResponse({ detail: "already exists" }, 409),
    );
    await expect(api.createActivity({} as never)).rejects.toThrow(
      "already exists",
    );
  });

  it("409 with no usable `detail` -> ConflictError with the fallback message", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(jsonResponse({}, 409));
    await expect(api.createActivity({} as never)).rejects.toThrow(
      "create activity",
    );
  });

  it("409 with a non-JSON body -> ConflictError with the fallback message", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("not json", 409));
    await expect(api.saveActivityConfig({} as never)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("other non-ok statuses -> plain Error '<msg>: <status> <body slice>'", async () => {
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse("server boom", 500));
    await expect(api.fetchActivity("act-1")).rejects.toThrow(
      "load activity: 500 server boom",
    );
  });

  it("non-ok body is sliced to 200 chars", async () => {
    const big = "x".repeat(500);
    fetchWithTeacherAuth.mockResolvedValueOnce(textResponse(big, 500));
    let msg = "";
    try {
      await api.fetchActivity("act-1");
    } catch (e) {
      msg = (e as Error).message;
    }
    // "load activity: 500 " + 200 x's
    expect(msg).toBe(`load activity: 500 ${"x".repeat(200)}`);
  });

  it("200 -> resolves with the parsed JSON body", async () => {
    mockResp({ activityId: "act-1", ownerUid: "o1" });
    const r = await api.fetchActivity("act-1");
    expect(r).toEqual({ activityId: "act-1", ownerUid: "o1" });
  });
});
