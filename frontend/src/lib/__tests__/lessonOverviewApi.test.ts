import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", () => ({ fetchWithTeacherAuth: vi.fn() }));

import { fetchWithTeacherAuth } from "@/lib/apiClient";
import { fetchClassLessons, fetchLesson, lessonDateFor, lessonHref, summariseLesson } from "@/lib/lessonOverviewApi";

const fetchSpy = vi.mocked(fetchWithTeacherAuth);

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => fetchSpy.mockReset());

describe("lessonOverviewApi", () => {
  it("lists a class's lessons with the TEACHER token", async () => {
    fetchSpy.mockResolvedValue(ok({ lessons: [{ activityId: "a" }] }));
    expect(await fetchClassLessons("c 1")).toEqual([{ activityId: "a" }]);
    expect(fetchSpy).toHaveBeenCalledWith("/api/proxy/api/insights/classes/c%201/lessons");
  });

  it("asks for one lesson, cached-only when told to", async () => {
    fetchSpy.mockResolvedValue(ok({ activityId: "act-1" }));
    await fetchLesson("c1", "act-1", "2026-10-20", { synthesis: "cached" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/proxy/api/insights/classes/c1/lessons/act-1?date=2026-10-20&synthesis=cached",
    );
  });

  it("summarise is a POST", async () => {
    fetchSpy.mockResolvedValue(ok({ requested: 1, summarised: 1, failed: 0, remaining: 0 }));
    await summariseLesson("c1", "act-1", "2026-10-20");
    expect(fetchSpy).toHaveBeenCalledWith("/api/proxy/api/insights/classes/c1/lessons/act-1/summarise?date=2026-10-20", {
      method: "POST",
    });
  });

  it("throws on a 404 with the status in the message", async () => {
    fetchSpy.mockResolvedValue(new Response("nope", { status: 404 }));
    await expect(fetchLesson("c1", "x", "2026-10-20")).rejects.toThrow(/ 404/);
  });

  it("files a lesson under the Copenhagen day", () => {
    expect(lessonDateFor("2026-10-19T23:30:00Z")).toBe("2026-10-20");
    expect(lessonDateFor("garbage")).toBeNull();
    expect(lessonHref("c1", "act-1", "2026-10-20")).toBe("/teacher/insights/lessons/c1/act-1?date=2026-10-20");
  });
});
