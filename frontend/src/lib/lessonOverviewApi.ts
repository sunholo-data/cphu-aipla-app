/**
 * The class's lessons, after the fact (1.1.139 M1/M2).
 *
 * Typed wrappers for `/api/insights/classes/{id}/lessons*`. Teacher surface,
 * so every call sends the Firebase teacher token (`fetchWithTeacherAuth`).
 * Its own module so the lesson surface can change without touching the KPI
 * client (`insightsApi.ts`).
 */

import { fetchWithTeacherAuth } from "@/lib/apiClient";
import { readJson } from "@/lib/apiResponse";

export type LessonConceptStatus = "discussed" | "struggled" | "demonstrated";

export interface LessonSummaryRow {
  activityId: string;
  activityTitle: string;
  /** Copenhagen calendar day, YYYY-MM-DD. */
  date: string;
  groups: number;
  sessions: number;
  turns: number;
  startedAt: string | null;
  lastAt: string | null;
}

export interface LessonConceptGroup {
  groupCode: string;
  status: LessonConceptStatus;
  /** The tutor's evidence summary (never a student quote), when recorded. */
  evidence: string | null;
}

export interface LessonConcept {
  key: string;
  label: string;
  nodeId: string | null;
  /** True when the concept is a node of the activity's concept map. */
  mapped: boolean;
  counts: Record<LessonConceptStatus, number>;
  groups: LessonConceptGroup[];
}

export interface LessonApproachCoverage {
  groups: number;
  assessed?: number;
  tooShort?: number;
  abstained?: number;
  notJudged?: number;
  otherApproach?: number;
}

export interface LessonApproach {
  state: "assessed" | "not_assessed" | "no_framework";
  frameworkId: string | null;
  frameworkLabel?: string | null;
  coverage: LessonApproachCoverage;
  groupSummaries?: { groupCode: string; summary: string; drift: string[] }[];
  /** Researcher only: construct → band → number of groups. */
  bands?: Record<string, Record<string, number>>;
  overallBands?: Record<string, number>;
}

export interface LessonGroupRow {
  groupCode: string;
  latestSessionId: string;
  sessionIds: string[];
  turns: number;
  summarised: boolean;
  conceptsExtracted: boolean;
  nextTime: string | null;
  approachSummary: string | null;
  struggledCount: number;
  topConcept: string | null;
  flags: ("struggle" | "drift")[];
}

export interface LessonSynthesis {
  approach: string;
  nextTime: string;
  model: string | null;
  generatedAt: string | null;
  stale: boolean;
}

export interface LessonDetail {
  classId: string;
  activityId: string;
  activityTitle: string;
  date: string;
  hasConceptMap: boolean;
  concepts: LessonConcept[];
  approach: LessonApproach;
  nextTime: { groups: { groupCode: string; text: string }[] };
  groups: LessonGroupRow[];
  coverage: {
    groups: number;
    sessions: number;
    summarised: number;
    conceptsExtracted: number;
    pendingSessions: number;
    unsummarisable: number;
  };
  pendingSessionIds: string[];
  synthesis: LessonSynthesis | null;
}

export interface SummariseLessonResult {
  requested: number;
  summarised: number;
  failed: number;
  remaining: number;
}

function base(classId: string): string {
  return `/api/proxy/api/insights/classes/${encodeURIComponent(classId)}/lessons`;
}

/** The class's lessons, newest first. */
export async function fetchClassLessons(classId: string): Promise<LessonSummaryRow[]> {
  const resp = await fetchWithTeacherAuth(base(classId));
  const body = await readJson<{ lessons: LessonSummaryRow[] }>(resp, "fetch class lessons");
  return body.lessons;
}

/** One lesson. `synthesis: "cached"` never makes a model call (the class
 *  page's card); the default may make one, cached server-side. */
export async function fetchLesson(
  classId: string,
  activityId: string,
  date: string,
  opts: { synthesis?: "generate" | "cached" } = {},
): Promise<LessonDetail> {
  const q = new URLSearchParams({ date, synthesis: opts.synthesis ?? "generate" });
  const resp = await fetchWithTeacherAuth(`${base(classId)}/${encodeURIComponent(activityId)}?${q.toString()}`);
  return readJson<LessonDetail>(resp, "fetch lesson");
}

/** The teacher's explicit "summarise the remaining groups" (capped server-side). */
export async function summariseLesson(
  classId: string,
  activityId: string,
  date: string,
): Promise<SummariseLessonResult> {
  const q = new URLSearchParams({ date });
  const resp = await fetchWithTeacherAuth(
    `${base(classId)}/${encodeURIComponent(activityId)}/summarise?${q.toString()}`,
    { method: "POST" },
  );
  return readJson<SummariseLessonResult>(resp, "summarise lesson");
}

/** The lesson day for a timestamp: the Copenhagen calendar date, exactly as
 *  the backend files lessons (`insights/lessons.py` LESSON_TZ). */
export function lessonDateFor(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Where a lesson lives. One builder, so the breadcrumb and the links agree. */
export function lessonHref(classId: string, activityId: string, date: string): string {
  return `/teacher/insights/lessons/${encodeURIComponent(classId)}/${encodeURIComponent(activityId)}?date=${encodeURIComponent(date)}`;
}
