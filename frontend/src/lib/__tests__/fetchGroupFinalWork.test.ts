import { beforeEach, describe, expect, it, vi } from "vitest";

// 1.1.136 M2 — the teacher/researcher read of one group's final work. The four
// GETs are dual-audience; THIS caller must send the teacher (Firebase) token. A
// group token would land in the student branch, or 401 with no group session.
vi.mock("@/lib/apiClient", () => ({
  fetchWithTeacherAuth: vi.fn(),
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth, fetchWithTeacherAuth } from "@/lib/apiClient";
import { fetchGroupFinalWork } from "@/lib/teacherApi";

const teacherFetch = vi.mocked(fetchWithTeacherAuth);
const groupFetch = vi.mocked(fetchWithAuth);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  teacherFetch.mockReset();
  groupFetch.mockReset();
});

describe("fetchGroupFinalWork", () => {
  it("reads all four stores with the TEACHER token, narrowed to the class, and picks out the group", async () => {
    teacherFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/table")) return json({ groups: { "g-1": { "t1::0::h": "1.5" }, "g-2": { "t1::0::h": "9" } } });
      if (u.includes("/writing")) return json({ groups: { "g-1": { w1: { text: "hi" } } } });
      if (u.includes("/checklist-progress")) return json({ groups: { "g-2": { i1: { done: true } } } });
      return json({ groups: { "g-1": { n1: { status: "partial" } } } });
    });

    const work = await fetchGroupFinalWork("act-1", "g-1", "cls 7");

    expect(groupFetch).not.toHaveBeenCalled();
    const urls = teacherFetch.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      "/api/proxy/api/activities/act-1/table?classId=cls%207",
      "/api/proxy/api/activities/act-1/writing?classId=cls%207",
      "/api/proxy/api/activities/act-1/checklist-progress?classId=cls%207",
      "/api/proxy/api/activities/act-1/concept-progress?classId=cls%207",
    ]);
    expect(work.cells).toEqual({ "t1::0::h": "1.5" });
    expect(work.docs).toEqual({ w1: { text: "hi" } });
    // A group absent from a store saved nothing there: {} — not unreadable.
    expect(work.itemStates).toEqual({});
    expect(work.nodeStates).toEqual({ n1: { status: "partial" } });
  });

  it("omits classId when none is given (the researcher / activity-owner branch)", async () => {
    teacherFetch.mockResolvedValue(json({ groups: {} }));
    await fetchGroupFinalWork("act-1", "g-1");
    expect(String(teacherFetch.mock.calls[0][0])).toBe("/api/proxy/api/activities/act-1/table");
  });

  it("marks a store it could not read as null, never as empty", async () => {
    teacherFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/table")) return json({ detail: "activity not found" }, 404);
      if (u.includes("/writing")) throw new Error("network");
      if (u.includes("/checklist-progress")) return json({ itemStates: {} }); // a student-shaped answer
      return json({ groups: {} });
    });

    const work = await fetchGroupFinalWork("act-1", "g-1");
    expect(work.cells).toBeNull();
    expect(work.docs).toBeNull();
    expect(work.itemStates).toBeNull();
    expect(work.nodeStates).toEqual({});
  });
});
