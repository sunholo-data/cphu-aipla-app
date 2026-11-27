/** The one-page activity sheet (1.1.165).
 *
 *  Two audiences, two tokens, so this lives in `src/lib` and names the caller in
 *  each function: the TEACHER's whole-class sheets go with the Firebase teacher
 *  token, a STUDENT group's own sheet with the group token. Never let one
 *  function serve both (CLAUDE.md, "Anonymous-Group Auth").
 *
 *  `origin` is the page's own origin, so the join link printed on the sheet is
 *  the address the teacher is actually using (aipla.ku.dk, aipla-test.ku.dk,
 *  or a dev URL). The server accepts it only as a bare origin.
 */

import { fetchWithAuth, fetchWithTeacherAuth } from "@/lib/apiClient";

export interface ActivitySheetPage {
  /** The group's join code; null on the single blank sheet of a class with no codes. */
  code: string | null;
  markdown: string;
}

export interface ActivitySheets {
  title: string;
  language: "da" | "en";
  sheets: ActivitySheetPage[];
}

/** Word could not be made (AILANG Parse down or unconfigured). Print still works. */
export class SheetWordUnavailableError extends Error {
  constructor() {
    super("activity sheet: Word unavailable");
    this.name = "SheetWordUnavailableError";
  }
}

function originParam(): string {
  return typeof window === "undefined" ? "" : `origin=${encodeURIComponent(window.location.origin)}`;
}

function classSheetPath(classId: string, activityId: string, format: "md" | "docx"): string {
  return (
    `/api/proxy/api/classes/${encodeURIComponent(classId)}/activities/${encodeURIComponent(activityId)}` +
    `/sheet?format=${format}&${originParam()}`
  );
}

function mySheetPath(activityId: string, format: "md" | "docx"): string {
  return `/api/proxy/api/activity-configs/active/${encodeURIComponent(activityId)}/sheet?format=${format}&${originParam()}`;
}

async function readWord(resp: Response): Promise<Blob> {
  if (resp.status === 503) throw new SheetWordUnavailableError();
  if (!resp.ok) throw new Error(`activity sheet download failed (${resp.status})`);
  return resp.blob();
}

/** Teacher: one sheet per live group of the class. */
export async function getClassActivitySheets(classId: string, activityId: string): Promise<ActivitySheets> {
  const resp = await fetchWithTeacherAuth(classSheetPath(classId, activityId, "md"));
  if (!resp.ok) throw new Error(`activity sheet fetch failed (${resp.status})`);
  return (await resp.json()) as ActivitySheets;
}

/** Teacher: the same sheets as one Word file, a page per group. */
export async function downloadClassActivitySheetWord(classId: string, activityId: string): Promise<Blob> {
  return readWord(await fetchWithTeacherAuth(classSheetPath(classId, activityId, "docx")));
}

/** Student: this group's own sheet. */
export async function getMyActivitySheet(activityId: string): Promise<ActivitySheets> {
  const resp = await fetchWithAuth(mySheetPath(activityId, "md"));
  if (!resp.ok) throw new Error(`activity sheet fetch failed (${resp.status})`);
  return (await resp.json()) as ActivitySheets;
}

/** Student: this group's own sheet as Word. */
export async function downloadMyActivitySheetWord(activityId: string): Promise<Blob> {
  return readWord(await fetchWithAuth(mySheetPath(activityId, "docx")));
}

/** The filename the download is saved under, matching the server's. */
export function activitySheetFilename(sheets: ActivitySheets): string {
  const stem =
    sheets.title
      .toLowerCase()
      .replace(/æ/g, "ae")
      .replace(/ø/g, "o")
      .replace(/å/g, "a")
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "activity";
  return `${sheets.language === "da" ? "aktivitetsark" : "activity-sheet"}-${stem}.docx`;
}
