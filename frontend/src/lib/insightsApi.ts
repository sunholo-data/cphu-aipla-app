/**
 * Typed wrappers around the `/api/insights/*` REST surface introduced
 * by M7. Kept in its own module rather than appended to `teacherApi.ts`
 * so the insights dashboard can be tree-shaken / replaced without
 * touching the broader teacher API.
 *
 * Every call goes through `/api/proxy/...` so the Next.js dev server
 * proxies to the FastAPI sidecar on port 1956. Auth is identical to
 * the rest of teacherApi (`fetchWithTeacherAuth`).
 */

import { fetchWithTeacherAuth as fetchWithAuth } from "@/lib/apiClient";

export type InsightsSince = "7d" | "30d" | "all";

export interface InsightsClassSummary {
  classId: string;
  name: string;
  activeGroups: number;
  totalMessages: number;
  lastActivity: string | null;
}

export interface InsightsSummaryPayload {
  since: string;
  until: string;
  classes: InsightsClassSummary[];
}

export interface InsightsKpis {
  activeGroups: number;
  totalMessages: number;
  activeActivities: number;
  simRuns: number;
  medianTimeOnTaskMin: number;
  lastActivity: string | null;
}

export interface InsightsQueryDebugEntry {
  name: string;
  sql: string;
  params: Record<string, unknown>;
}

export interface InsightsClassKpisPayload {
  classId: string;
  since: string;
  until: string;
  kpis: InsightsKpis;
  _debug: { queries: InsightsQueryDebugEntry[] };
}

export interface InsightsGroupRow {
  groupCode: string;
  messageCount: number;
  sessionCount: number;
}

export interface InsightsClassGroupsPayload {
  classId: string;
  groups: InsightsGroupRow[];
  _debug: { queries: InsightsQueryDebugEntry[] };
}

export interface InsightsActivityRow {
  skillId: string;
  activeGroups: number;
  simRuns: number;
}

export interface InsightsClassActivitiesPayload {
  classId: string;
  activities: InsightsActivityRow[];
  _debug: { queries: InsightsQueryDebugEntry[] };
}

export interface InsightsCompareRow {
  classId: string;
  name: string;
  activeGroups: number;
  messages: number;
  messagesPrior: number;
  messagesDelta: number;
  simRuns: number;
  lastActivity: string | null;
}

export interface InsightsComparePayload {
  since: string;
  until: string;
  rows: InsightsCompareRow[];
}

function _query(since: InsightsSince, until?: string): string {
  const params = new URLSearchParams({ since });
  if (until) params.set("until", until);
  return params.toString() ? `?${params.toString()}` : "";
}

async function _ok<T>(resp: Response, what: string): Promise<T> {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${what} failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

// The backend returns snake_case JSON. The dashboard surface wants
// camelCase props, so we map here once rather than scatter the names
// across components.

function _mapSummary(json: {
  since: string;
  until: string;
  classes: Array<{ class_id: string; name: string; active_groups: number; total_messages: number; last_activity: string | null }>;
}): InsightsSummaryPayload {
  return {
    since: json.since,
    until: json.until,
    classes: json.classes.map((c) => ({
      classId: c.class_id,
      name: c.name,
      activeGroups: c.active_groups,
      totalMessages: c.total_messages,
      lastActivity: c.last_activity,
    })),
  };
}

function _mapKpis(json: {
  class_id: string;
  since: string;
  until: string;
  kpis: {
    active_groups: number;
    total_messages: number;
    active_activities: number;
    sim_runs: number;
    median_time_on_task_min: number;
    last_activity: string | null;
  };
  _debug: { queries: InsightsQueryDebugEntry[] };
}): InsightsClassKpisPayload {
  return {
    classId: json.class_id,
    since: json.since,
    until: json.until,
    kpis: {
      activeGroups: json.kpis.active_groups,
      totalMessages: json.kpis.total_messages,
      activeActivities: json.kpis.active_activities,
      simRuns: json.kpis.sim_runs,
      medianTimeOnTaskMin: json.kpis.median_time_on_task_min,
      lastActivity: json.kpis.last_activity,
    },
    _debug: json._debug,
  };
}

function _mapCompare(json: {
  since: string;
  until: string;
  rows: Array<{
    class_id: string;
    name: string;
    active_groups: number;
    messages: number;
    messages_prior: number;
    messages_delta: number;
    sim_runs: number;
    last_activity: string | null;
  }>;
}): InsightsComparePayload {
  return {
    since: json.since,
    until: json.until,
    rows: json.rows.map((r) => ({
      classId: r.class_id,
      name: r.name,
      activeGroups: r.active_groups,
      messages: r.messages,
      messagesPrior: r.messages_prior,
      messagesDelta: r.messages_delta,
      simRuns: r.sim_runs,
      lastActivity: r.last_activity,
    })),
  };
}

export async function fetchInsightsSummary(
  since: InsightsSince = "7d",
  until?: string,
): Promise<InsightsSummaryPayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/insights/summary${_query(since, until)}`);
  const json = await _ok<Parameters<typeof _mapSummary>[0]>(resp, "fetch insights summary");
  return _mapSummary(json);
}

export async function fetchInsightsCompare(
  since: InsightsSince = "7d",
  until?: string,
): Promise<InsightsComparePayload> {
  const resp = await fetchWithAuth(`/api/proxy/api/insights/compare${_query(since, until)}`);
  const json = await _ok<Parameters<typeof _mapCompare>[0]>(resp, "fetch insights compare");
  return _mapCompare(json);
}

export async function fetchInsightsClassKpis(
  classId: string,
  since: InsightsSince = "7d",
  until?: string,
): Promise<InsightsClassKpisPayload> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/insights/classes/${encodeURIComponent(classId)}/kpis${_query(since, until)}`,
  );
  const json = await _ok<Parameters<typeof _mapKpis>[0]>(resp, "fetch insights class kpis");
  return _mapKpis(json);
}

export async function fetchInsightsClassGroups(
  classId: string,
  since: InsightsSince = "7d",
  until?: string,
): Promise<InsightsClassGroupsPayload> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/insights/classes/${encodeURIComponent(classId)}/groups${_query(since, until)}`,
  );
  const json = await _ok<{
    class_id: string;
    groups: Array<{ group_code: string; message_count: number; session_count: number }>;
    _debug: { queries: InsightsQueryDebugEntry[] };
  }>(resp, "fetch insights class groups");
  return {
    classId: json.class_id,
    groups: json.groups.map((g) => ({
      groupCode: g.group_code,
      messageCount: g.message_count,
      sessionCount: g.session_count,
    })),
    _debug: json._debug,
  };
}

export interface InsightsTrendPoint {
  day: string;
  count: number;
}

export interface InsightsClassTrendPayload {
  classId: string;
  perDay: InsightsTrendPoint[];
  _debug: { queries: InsightsQueryDebugEntry[] };
}

export async function fetchInsightsClassTrend(
  classId: string,
  since: InsightsSince = "7d",
  until?: string,
): Promise<InsightsClassTrendPayload> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/insights/classes/${encodeURIComponent(classId)}/trend${_query(since, until)}`,
  );
  const json = await _ok<{
    class_id: string;
    per_day: Array<{ day: string; count: number }>;
    _debug: { queries: InsightsQueryDebugEntry[] };
  }>(resp, "fetch insights class trend");
  return {
    classId: json.class_id,
    perDay: json.per_day,
    _debug: json._debug,
  };
}

export async function fetchInsightsClassActivities(
  classId: string,
  since: InsightsSince = "7d",
  until?: string,
): Promise<InsightsClassActivitiesPayload> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/insights/classes/${encodeURIComponent(classId)}/activities${_query(since, until)}`,
  );
  const json = await _ok<{
    class_id: string;
    activities: Array<{ skill_id: string; active_groups: number; sim_runs: number }>;
    _debug: { queries: InsightsQueryDebugEntry[] };
  }>(resp, "fetch insights class activities");
  return {
    classId: json.class_id,
    activities: json.activities.map((a) => ({
      skillId: a.skill_id,
      activeGroups: a.active_groups,
      simRuns: a.sim_runs,
    })),
    _debug: json._debug,
  };
}
