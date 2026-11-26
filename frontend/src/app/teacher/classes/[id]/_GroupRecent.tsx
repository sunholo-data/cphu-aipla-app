"use client";

/**
 * What one group did in the last 5 / 10 / 20 minutes (1.1.163 M1 + M3).
 *
 * Opens under a group's row in the class page's groups table, so the teacher
 * sees it without leaving the page the raised hands are on. Counted from the
 * chat and the workbench by the backend (`GET …/groups/{code}/recent`), with
 * no AI. The written synopsis (M2) will sit above this line when it ships.
 *
 * Takes a CODE, never a name: `_GroupsTable.tsx` holds the teacher's names and
 * imports no API client, so the fetch lives here and the table only decides
 * which row is open.
 *
 * Design: docs/design/aipla/v2.1.0-extension/live-group-synopsis.md
 */

import { useCallback, useEffect, useState } from "react";

import { useT, type Translate } from "@/i18n";
import {
  GROUP_RECENT_MINUTES,
  getGroupRecent,
  type GroupRecent as GroupRecentData,
} from "@/lib/teacherApi";
import { cn } from "@/lib/utils";

const MINUTES_KEY = "aipla.teacher.groupRecentMinutes";
const DEFAULT_MINUTES = 10;
export const GROUP_RECENT_REFRESH_MS = 120_000;

function storedMinutes(): number {
  try {
    const n = Number(window.localStorage.getItem(MINUTES_KEY));
    return (GROUP_RECENT_MINUTES as readonly number[]).includes(n)
      ? n
      : DEFAULT_MINUTES;
  } catch {
    return DEFAULT_MINUTES;
  }
}

/** The counted line's parts, in reading order. Exported for tests. */
export function recentParts(
  d: GroupRecentData,
  t: Translate<"GroupRecent">,
): string[] {
  const parts: string[] = [];
  for (const s of d.sheets) {
    const title = s.title || t("untitledSheet");
    parts.push(
      s.wordsNow > s.wordsBefore
        ? t("wrote", { n: s.wordsNow - s.wordsBefore, title })
        : t("edited", { title, before: s.wordsBefore, now: s.wordsNow }),
    );
  }
  for (const s of d.sims) parts.push(t("sim", { n: s.changes, name: s.name }));
  if (d.tableEdits) parts.push(t("table", { n: d.tableEdits }));
  if (d.questions) parts.push(t("questions", { n: d.questions }));
  if (d.feedbackRequests) parts.push(t("feedback", { n: d.feedbackRequests }));
  if (d.tutorTurns) parts.push(t("tutorReplies", { n: d.tutorTurns }));
  if (d.documentsOpened) parts.push(t("documents", { n: d.documentsOpened }));
  return parts;
}

export function GroupRecent({
  classId,
  code,
}: {
  classId: string;
  code: string;
}) {
  const t = useT("GroupRecent");
  const [minutes, setMinutes] = useState<number>(DEFAULT_MINUTES);
  const [data, setData] = useState<GroupRecentData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => setMinutes(storedMinutes()), []);

  const load = useCallback(async () => {
    try {
      setData(await getGroupRecent(classId, code, minutes));
      setError(false);
    } catch {
      setError(true);
    }
  }, [classId, code, minutes]);

  useEffect(() => {
    setData(null);
    void load();
    const id = window.setInterval(() => void load(), GROUP_RECENT_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const choose = (n: number) => {
    setMinutes(n);
    try {
      window.localStorage.setItem(MINUTES_KEY, String(n));
    } catch {
      /* private mode: the choice lasts until the page closes */
    }
  };

  const shown = data && data.minutes === minutes ? data : null;

  return (
    <div className="space-y-1.5 text-sm" data-testid={`group-recent-${code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t("heading")}
        </span>
        <div
          role="group"
          aria-label={t("windowLabel")}
          className="inline-flex rounded-md border border-border"
        >
          {GROUP_RECENT_MINUTES.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={minutes === n}
              onClick={() => choose(n)}
              className={cn(
                "px-2 py-0.5 text-xs first:rounded-l-md last:rounded-r-md",
                minutes === n
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("minutes", { n })}
            </button>
          ))}
        </div>
      </div>
      {error && !shown ? (
        <p role="status" className="text-amber-700 dark:text-amber-300">
          {t("error")}
        </p>
      ) : !shown ? (
        <p role="status" className="text-muted-foreground">
          {t("loading")}
        </p>
      ) : shown.empty ? (
        <p className="text-muted-foreground">{t("empty", { n: minutes })}</p>
      ) : (
        <p className="text-foreground">{recentParts(shown, t).join(" · ")}</p>
      )}
      <p className="text-xs text-muted-foreground">{t("source")}</p>
    </div>
  );
}
