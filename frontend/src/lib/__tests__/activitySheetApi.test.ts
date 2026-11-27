import { beforeEach, describe, expect, it, vi } from "vitest";

// 1.1.165 — the sheet has two audiences, and each must send its own token.
const fetchWithAuth = vi.fn();
const fetchWithTeacherAuth = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a),
  fetchWithTeacherAuth: (...a: unknown[]) => fetchWithTeacherAuth(...a),
}));

import {
  type ActivitySheets,
  SheetWordUnavailableError,
  activitySheetFilename,
  downloadClassActivitySheetWord,
  downloadMyActivitySheetWord,
  getClassActivitySheets,
  getMyActivitySheet,
} from "@/lib/activitySheetApi";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sheets: ActivitySheets = { title: "Boldkast", language: "da", sheets: [{ code: "a-1", markdown: "# Boldkast" }] };

beforeEach(() => {
  fetchWithAuth.mockReset();
  fetchWithTeacherAuth.mockReset();
});

describe("activitySheetApi", () => {
  it("teacher sheets go with the TEACHER token and carry the page origin", async () => {
    fetchWithTeacherAuth.mockResolvedValue(json(sheets));
    await expect(getClassActivitySheets("c 1", "act-1")).resolves.toEqual(sheets);
    expect(fetchWithAuth).not.toHaveBeenCalled();
    const url = fetchWithTeacherAuth.mock.calls[0][0] as string;
    expect(url).toBe(
      `/api/proxy/api/classes/c%201/activities/act-1/sheet?format=md&origin=${encodeURIComponent(window.location.origin)}`,
    );
  });

  it("a student's sheet goes with the GROUP token", async () => {
    fetchWithAuth.mockResolvedValue(json(sheets));
    await getMyActivitySheet("act-1");
    expect(fetchWithTeacherAuth).not.toHaveBeenCalled();
    expect(fetchWithAuth.mock.calls[0][0]).toMatch(/^\/api\/proxy\/api\/activity-configs\/active\/act-1\/sheet\?format=md&origin=/);
  });

  it("Word downloads ask for docx and turn a 503 into 'unavailable'", async () => {
    fetchWithTeacherAuth.mockResolvedValue(new Response("x", { status: 503 }));
    await expect(downloadClassActivitySheetWord("c1", "act-1")).rejects.toBeInstanceOf(SheetWordUnavailableError);
    expect(fetchWithTeacherAuth.mock.calls[0][0]).toContain("format=docx");

    // A string body, not a Blob: on Node 22 (CI) jsdom's Blob is not one the
    // native Response can stream ("object.stream is not a function").
    fetchWithAuth.mockResolvedValue(new Response("PK", { status: 200 }));
    const blob = await downloadMyActivitySheetWord("act-1");
    expect(await blob.text()).toBe("PK");
  });

  it("other failures are plain errors, not 'unavailable'", async () => {
    fetchWithAuth.mockResolvedValue(new Response("x", { status: 404 }));
    const err = await downloadMyActivitySheetWord("act-1").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SheetWordUnavailableError);
  });

  it("names the file like the server does", () => {
    expect(activitySheetFilename({ ...sheets, title: "Boldkast: Æbler & Får" })).toBe(
      "aktivitetsark-boldkast-aebler-far.docx",
    );
    expect(activitySheetFilename({ ...sheets, language: "en", title: "" })).toBe("activity-sheet-activity.docx");
  });
});
