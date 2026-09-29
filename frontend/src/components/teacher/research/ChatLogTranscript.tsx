"use client";

import { useState } from "react";
import {
  Bot,
  Calculator,
  ChevronRight,
  FileText,
  GraduationCap,
  ListChecks,
  PenLine,
  Settings2,
  SlidersHorizontal,
  Table2,
  type LucideIcon,
} from "lucide-react";

import type { ChatLogTimelineItem, ChatLogTurn, ChatLogWorkEvent } from "@/lib/teacherApi";

/** UI copy, lifted out of JSX (1.1.108 M4) so a translator can reach it. */
const copy = {
  loading: "Loading transcript…",
  failed: "Could not read this transcript.",
  empty: "No turns recorded for this conversation.",
  synthetic: "System opened the conversation",
  student: "Student",
  tutor: "Tutor",
  unknownRole: "Unattributed",
  workUnreadable:
    "The workbench log could not be read, so this shows the conversation only — it does NOT mean the group did no work.",
  times: (n: number) => `×${n}`,
  showState: "Show what they had",
  hideState: "Hide",
  stateTitle: "State at this point",
  untitledTable: "Table",
  untitledText: "Text",
  noResult: "no result yet",
  // Fallback labels for rows logged before 1.1.136 (2026-09-29), which carry
  // no label of their own. Derived from the element, never guessed further.
  fallback: {
    table: "Data table updated",
    writing: "Writing updated",
    calculator: "Calculator used",
    progress: "Checklist updated",
    chart: "Chart updated",
    documents: (tool: string) => `Document: ${tool}`,
    other: (server: string, field: string) => (field ? `${server} · ${field}` : server),
  },
} as const;

/** Consecutive events from one element closer than this fold into one card. */
export const BURST_WINDOW_MS = 30_000;

export interface ChatLogTranscriptProps {
  items: ChatLogTimelineItem[] | null;
  status: "loading" | "ok" | "error";
  /** "unreadable" → say so; an empty work log must not read as "no work". */
  workStatus?: "ok" | "unreadable";
}

function roleLabel(turn: ChatLogTurn): string {
  if (turn.role === "student") return copy.student;
  if (turn.role === "tutor") return copy.tutor;
  return copy.unknownRole;
}

const ICONS: Record<string, LucideIcon> = {
  table: Table2,
  writing: PenLine,
  calculator: Calculator,
  progress: ListChecks,
  documents: FileText,
};

/** The card text for a work event: its own label, else one derived from the
 *  element (rows before 1.1.136 M0 carry none). */
export function workLabel(ev: ChatLogWorkEvent): string {
  if (ev.label && ev.label.trim()) return ev.label.trim();
  const server = ev.server ?? "";
  switch (server) {
    case "table":
    case "writing":
    case "calculator":
    case "progress":
    case "chart":
      return copy.fallback[server];
    case "documents":
      return copy.fallback.documents(ev.tool ?? "");
    default:
      return copy.fallback.other(server || "?", ev.field ?? "");
  }
}

/** A run of work events from one element, folded into one card. */
export interface WorkBurst {
  kind: "burst";
  events: ChatLogWorkEvent[];
}

export type TimelineRow = ({ kind: "turn" } & ChatLogTurn) | WorkBurst;

function msOf(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const n = Date.parse(ts);
  return Number.isNaN(n) ? null : n;
}

/**
 * Fold consecutive work events of the same element within {@link BURST_WINDOW_MS}
 * into one burst. A table pushes on every cell commit, so twelve cells typed in
 * a row would otherwise be twelve cards between two turns. Never folds across a
 * turn, and never across a different element.
 */
export function collapseWork(items: ChatLogTimelineItem[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const item of items) {
    if (item.kind === "turn") {
      rows.push(item);
      continue;
    }
    const { kind: _kind, ...ev } = item;
    const prev = rows[rows.length - 1];
    if (prev && prev.kind === "burst") {
      const last = prev.events[prev.events.length - 1];
      const a = msOf(last.ts);
      const b = msOf(ev.ts);
      const sameElement = last.server === ev.server && last.tool === ev.tool;
      if (sameElement && a !== null && b !== null && b - a <= BURST_WINDOW_MS) {
        prev.events.push(ev);
        continue;
      }
    }
    rows.push({ kind: "burst", events: [ev] });
  }
  return rows;
}

/**
 * Build a timeline from the group report's own payload — the fallback when the
 * labelled server timeline cannot be read (a session still in flight, a live
 * session-state report with no BigQuery rows yet). Turns keep their order; work
 * is slotted between them by time. No labels here, so cards use the derived
 * fallback — which is what the report showed before, minus the 80-char cut.
 */
export function timelineFromSummary(
  conversation: { timestamp: string; role: string; content: string }[],
  workbenchEvents: { timestamp: string; server: string; tool: string; field: string; value: string }[] = [],
): ChatLogTimelineItem[] {
  const work = [...workbenchEvents].sort((a, b) => (msOf(a.timestamp) ?? 0) - (msOf(b.timestamp) ?? 0));
  const items: ChatLogTimelineItem[] = [];
  let wi = 0;
  const pushWork = (w: (typeof work)[number]) =>
    items.push({ kind: "work", ts: w.timestamp, server: w.server, tool: w.tool, field: w.field, value: w.value, label: null });
  conversation.forEach((t, i) => {
    const at = msOf(t.timestamp);
    while (wi < work.length && at !== null && (msOf(work[wi].timestamp) ?? Infinity) < at) pushWork(work[wi++]);
    items.push({
      kind: "turn",
      ts: t.timestamp,
      turn_index: i,
      role: t.role,
      content: t.content,
      is_synthetic: t.content === "[session_start]",
      model: null,
      framework_id: null,
      tutor_id: null,
      persona_id: null,
      class_id: null,
      activity_id: null,
      interaction_style: null,
      teaching_source: null,
      group_id: null,
      skill_id: null,
      revision: null,
      app_version: null,
    });
  });
  work.slice(wi).forEach(pushWork);
  return items;
}

type Parsed =
  | { shape: "tables"; tables: { title: string; columns: { id: string; label: string; unit?: string }[]; data: Record<string, string>[] }[] }
  | { shape: "docs"; docs: { title: string; text: string; truncated?: boolean }[] }
  | { shape: "calculators"; calculators: { title: string; formula: string; inputs: { label: string; value: string; unit: string }[]; result: string | null }[] }
  | { shape: "checklist"; items: { id: string; label: string }[]; done: string[] }
  | { shape: "raw"; text: string };

/** Read an event's snapshot back into something a person can look at. Each
 *  commit carries the element's whole state, so the LAST event of a burst is
 *  the state at that moment. Unknown shapes fall back to the raw value. */
export function parseWorkValue(value: string | null): Parsed | null {
  if (!value) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(value);
  } catch {
    return { shape: "raw", text: value };
  }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>;
    if (Array.isArray(o.tables)) return { shape: "tables", tables: o.tables as never };
    if (Array.isArray(o.docs)) return { shape: "docs", docs: o.docs as never };
    if (Array.isArray(o.calculators)) return { shape: "calculators", calculators: o.calculators as never };
    if (Array.isArray(o.items) && Array.isArray(o.done)) {
      return { shape: "checklist", items: o.items as never, done: o.done as never };
    }
  }
  return { shape: "raw", text: JSON.stringify(obj, null, 2) };
}

function StateView({ value }: { value: string | null }) {
  const parsed = parseWorkValue(value);
  if (!parsed) return null;
  switch (parsed.shape) {
    case "tables":
      return (
        <div className="flex flex-col gap-2">
          {parsed.tables.map((tbl, ti) => (
            <div key={ti} className="overflow-x-auto">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">{tbl.title || copy.untitledTable}</p>
              <table className="border-collapse text-xs">
                <thead>
                  <tr>
                    {(tbl.columns ?? []).map((c) => (
                      <th key={c.id} className="border border-border bg-muted/40 px-2 py-0.5 text-left font-medium">
                        {c.label}
                        {c.unit ? <span className="ml-1 text-muted-foreground">({c.unit})</span> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(tbl.data ?? []).map((row, ri) => (
                    <tr key={ri}>
                      {(tbl.columns ?? []).map((c) => (
                        <td key={c.id} className="border border-border px-2 py-0.5 tabular-nums">
                          {row?.[c.id] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      );
    case "docs":
      return (
        <div className="flex flex-col gap-2">
          {parsed.docs.map((d, di) => (
            <div key={di}>
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">{d.title || copy.untitledText}</p>
              <p className="whitespace-pre-wrap text-xs text-foreground">{d.text}</p>
            </div>
          ))}
        </div>
      );
    case "calculators":
      return (
        <ul className="flex flex-col gap-1 text-xs">
          {parsed.calculators.map((c, ci) => (
            <li key={ci}>
              <span className="font-medium">{c.title || c.formula}</span>
              {": "}
              {(c.inputs ?? []).map((i) => `${i.label} = ${i.value || "—"}${i.unit ? ` ${i.unit}` : ""}`).join(", ")}
              {" → "}
              <span className="tabular-nums">{c.result ?? copy.noResult}</span>
            </li>
          ))}
        </ul>
      );
    case "checklist":
      return (
        <ul className="flex flex-col gap-0.5 text-xs">
          {parsed.items.map((i) => (
            <li key={i.id}>
              <span aria-hidden="true">{parsed.done.includes(i.id) ? "☑" : "☐"}</span> {i.label}
            </li>
          ))}
        </ul>
      );
    default:
      return <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{parsed.text.slice(0, 4000)}</pre>;
  }
}

function WorkCard({ burst }: { burst: WorkBurst }) {
  const [open, setOpen] = useState(false);
  const last = burst.events[burst.events.length - 1];
  const Icon = ICONS[last.server ?? ""] ?? SlidersHorizontal;
  const time = last.ts ? last.ts.slice(11, 16) : "";
  const hasState = !!last.value;
  return (
    <li className="rounded border border-dashed border-border bg-muted/20 px-3 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-foreground">{workLabel(last)}</span>
        {burst.events.length > 1 ? (
          <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{copy.times(burst.events.length)}</span>
        ) : null}
        {time ? <span className="text-muted-foreground opacity-70">{time}</span> : null}
        {hasState ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="ml-auto flex items-center gap-1 rounded px-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
            {open ? copy.hideState : copy.showState}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 rounded border border-border bg-background p-2" aria-label={copy.stateTitle}>
          <StateView value={last.value} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * One conversation, in order (1.1.109) — with the work it was about, in the
 * same order (1.1.136 M1).
 *
 * Work rows render as compact cards between the turns, carrying the SAME text
 * as the trust card the student saw, so the researcher and the student read one
 * record. A burst of edits to one element folds into one card with a count, and
 * any card expands into the element's state at that moment.
 *
 * ⚠️ A synthetic turn is MARKED, not hidden. `[session_start]` is the non-empty
 * sentinel a system-driven turn has to send — `ag_ui_adk._convert_latest_message`
 * drops a message with falsy content — and it is logged under role='student'
 * like anything else. Rendering it as a student utterance would put words in a
 * student's mouth in a research record. Dropping it silently would hide that
 * the system, not the student, opened the conversation. So it is shown as what
 * it is.
 */
export function ChatLogTranscript({ items, status, workStatus = "ok" }: ChatLogTranscriptProps) {
  if (status === "loading") {
    return <p className="text-sm text-muted-foreground">{copy.loading}</p>;
  }
  if (status === "error") {
    return <p className="text-sm text-destructive">{copy.failed}</p>;
  }
  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground">{copy.empty}</p>;
  }

  const rows = collapseWork(items);
  return (
    <div className="flex flex-col gap-3">
      {workStatus === "unreadable" ? (
        <p role="status" className="rounded border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          {copy.workUnreadable}
        </p>
      ) : null}
      <ol className="flex flex-col gap-3">
        {rows.map((row, i) => {
          if (row.kind === "burst") {
            return <WorkCard key={`w-${row.events[0].ts ?? "x"}-${i}`} burst={row} />;
          }
          const turn = row;
          const key = `${turn.turn_index ?? "x"}-${i}`;
          if (turn.is_synthetic) {
            return (
              <li
                key={key}
                className="flex items-center gap-2 rounded border border-dashed border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
              >
                <Settings2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{copy.synthetic}</span>
                <code className="ml-auto font-mono text-[11px] opacity-70">{turn.content}</code>
              </li>
            );
          }
          const isStudent = turn.role === "student";
          const Icon = isStudent ? GraduationCap : Bot;
          return (
            <li
              key={key}
              className={
                isStudent
                  ? "rounded border border-border bg-background px-3 py-2"
                  : "rounded border border-border bg-muted/40 px-3 py-2"
              }
            >
              <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{roleLabel(turn)}</span>
                {turn.turn_index !== null && turn.turn_index !== undefined ? (
                  <span className="opacity-60">#{turn.turn_index}</span>
                ) : null}
                {turn.model ? <span className="ml-auto font-mono opacity-60">{turn.model}</span> : null}
              </div>
              <p className="whitespace-pre-wrap text-sm text-foreground">{turn.content}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
