import { afterEach, describe, expect, it, vi } from "vitest";

const fetchWithAuth = vi.fn();
const fetchWithTeacherAuth = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a),
  fetchWithTeacherAuth: (...a: unknown[]) => fetchWithTeacherAuth(...a),
}));

import { DocumentApiError, listMyDocuments, uploadDocument } from "@/lib/documentApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.clearAllMocks());

describe("uploadDocument — the wire contract the workbench depends on", () => {
  // The backend route declares `skill_id` as a multipart FORM field
  // (tools/documents/upload.py). This test and
  // backend/tests/api_tests/test_upload_reaches_the_workbench_list.py pin the
  // SAME field name from both ends. For four months the route read it as a
  // query param instead, every upload stored skillId="" and the workbench —
  // which lists by skillId — could never show a file it had just uploaded
  // (busy-garden-11, 2026-09-15).
  it("sends skill_id as a multipart form field, never on the query string", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({ docId: "new1", status: "parsed" }));
    const file = new File(["%PDF"], "Doc4_compressed.pdf", { type: "application/pdf" });

    await uploadDocument(file, "act-84ba348b7d561024", "student");

    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    const [url, init] = fetchWithAuth.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/api/documents/upload");
    expect(url).not.toContain("?");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("skill_id")).toBe("act-84ba348b7d561024");
    expect(body.get("file")).toBe(file);
    // The browser must set the multipart boundary itself.
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });

  it("lists by the same skillId the upload carried", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({ documents: [] }));
    await listMyDocuments("act-84ba348b7d561024", "student");
    expect(fetchWithAuth.mock.calls[0][0]).toBe(
      "/api/proxy/api/documents?skillId=act-84ba348b7d561024",
    );
  });

  it("surfaces the parse status — a stored-but-unreadable file is not a success", async () => {
    // prod 2026-09-16: the route answered 200 + status:"failed" for every .docx
    // (expired AILANG Parse key); the old client kept only docId, so the
    // student saw a spinner stop and nothing else.
    fetchWithAuth.mockResolvedValue(
      jsonResponse({ docId: "d1", status: "failed", error: "AILANG Parse rejected the API key" }),
    );
    const out = await uploadDocument(new File(["x"], "essay.docx"), "act-1");
    expect(out).toMatchObject({ docId: "d1", name: "essay.docx", status: "failed" });
    expect(out.error).toContain("rejected the API key");
  });

  it("throws the backend's own reason on a non-2xx", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse({ detail: "File type '.exe' is not supported." }, 400));
    await expect(uploadDocument(new File(["x"], "a.exe"), "act-1")).rejects.toMatchObject({
      name: "DocumentApiError",
      status: 400,
      message: "File type '.exe' is not supported.",
    } satisfies Partial<DocumentApiError>);
  });

  it("uses the teacher token for the builder preview", async () => {
    fetchWithTeacherAuth.mockResolvedValue(jsonResponse({ docId: "d1", status: "parsed" }));
    await uploadDocument(new File(["x"], "a.pdf"), "act-1", "teacher");
    expect(fetchWithTeacherAuth).toHaveBeenCalledTimes(1);
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
});
