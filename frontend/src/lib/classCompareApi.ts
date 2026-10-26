/**
 * Compare one element across every group of a class (1.1.99 M1).
 *
 * Teacher auth: `fetchWithTeacherAuth` — this is a teacher/researcher surface;
 * the backend refuses a group token with 403. Both reads are class-scoped
 * (`analytics.auth.assert_can_read_class`: the class owner, or a researcher).
 */
import { fetchWithTeacherAuth } from "@/lib/apiClient";
import { readJson } from "@/lib/apiResponse";
import type { ChartElement, ChecklistItem, TableElement, WritingElement } from "@/lib/elementTypes";

export type CompareKind = "table" | "chart" | "writing" | "checklist";

export interface ComparableElement {
  kind: CompareKind;
  id: string;
  title: string;
}

export interface ComparableActivity {
  activityId: string;
  title: string;
  elements: ComparableElement[];
}

/** One group's state for the compared element. `data` is null when the group
 *  has not touched it — an honest "nothing yet", distinct from a failed read
 *  (which rejects the whole call). Shape by kind: table/chart → a cell map,
 *  writing → `{text, words?, updatedAt?}`, checklist → item states. */
export interface CompareGroup {
  groupCode: string;
  revoked: boolean;
  updatedAt: string | null;
  data: Record<string, unknown> | null;
}

export interface CompareResult {
  classId: string;
  activityId: string;
  activityTitle: string;
  kind: CompareKind;
  elementId: string;
  elements: {
    table?: TableElement[];
    chart?: ChartElement[];
    writing?: WritingElement[];
    checklist?: ChecklistItem[];
  };
  groups: CompareGroup[];
}

const base = (classId: string) => `/api/proxy/api/classes/${encodeURIComponent(classId)}/compare`;

/** The picker: the class's activities and the elements each can compare. */
export async function fetchComparableElements(classId: string): Promise<ComparableActivity[]> {
  const resp = await fetchWithTeacherAuth(`${base(classId)}/elements`);
  const body = await readJson<{ activities: ComparableActivity[] }>(resp, "compare elements");
  return body.activities ?? [];
}

/** One element, every group of the class — one request. */
export async function fetchClassCompare(
  classId: string,
  activityId: string,
  kind: CompareKind,
  elementId: string,
): Promise<CompareResult> {
  const q = new URLSearchParams({ activityId, kind, elementId });
  const resp = await fetchWithTeacherAuth(`${base(classId)}?${q.toString()}`);
  return readJson<CompareResult>(resp, "compare groups");
}
