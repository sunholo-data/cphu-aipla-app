import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the two auth helpers so we can assert WHICH token each call uses.
const fetchWithAuth = vi.fn();
const fetchWithTeacherAuth = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a),
  fetchWithTeacherAuth: (...a: unknown[]) => fetchWithTeacherAuth(...a),
}));

import { browseCurriculum, deleteCurriculumDoc, fetchCurriculumContent } from "@/lib/curriculumApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.clearAllMocks());

describe("curriculumApi auth selection", () => {
  it("student content reads use the anonymous-GROUP token, not teacher auth", async () => {
    // Regression: the workbench viewer 401'd because content used the teacher
    // token (a student has no Firebase identity). It must use fetchWithAuth.
    fetchWithAuth.mockResolvedValue(
      jsonResponse({ docId: "d1", title: "T", available: true, text: "x", chars: 1 }),
    );
    await fetchCurriculumContent("d1", "act-1", { as: "student" });

    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(fetchWithTeacherAuth).not.toHaveBeenCalled();
    expect(fetchWithAuth.mock.calls[0][0]).toContain(
      "/api/proxy/api/curriculum/d1/content?activityId=act-1",
    );
  });

  it("teacher content reads (default) use the Firebase teacher token", async () => {
    fetchWithTeacherAuth.mockResolvedValue(
      jsonResponse({ docId: "d1", title: "T", available: true, text: "x", chars: 1 }),
    );
    await fetchCurriculumContent("d1");

    expect(fetchWithTeacherAuth).toHaveBeenCalledTimes(1);
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("browse is teacher-only (teacher token)", async () => {
    fetchWithTeacherAuth.mockResolvedValue(jsonResponse({ docs: [] }));
    await browseCurriculum();

    expect(fetchWithTeacherAuth).toHaveBeenCalledTimes(1);
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
});

describe("deleteCurriculumDoc (M6)", () => {
  it("DELETEs with the teacher token", async () => {
    fetchWithTeacherAuth.mockResolvedValue(new Response(null, { status: 204 }));
    await deleteCurriculumDoc("d1");

    expect(fetchWithTeacherAuth).toHaveBeenCalledWith(
      "/api/proxy/api/curriculum/d1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("tolerates 404 (already gone) without throwing", async () => {
    fetchWithTeacherAuth.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(deleteCurriculumDoc("d1")).resolves.toBeUndefined();
  });

  it("throws on a real failure (e.g. 403 — not your doc)", async () => {
    fetchWithTeacherAuth.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(deleteCurriculumDoc("d1")).rejects.toThrow();
  });
});
