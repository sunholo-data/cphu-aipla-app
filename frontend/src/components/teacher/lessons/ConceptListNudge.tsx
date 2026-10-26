"use client";

// ConceptListNudge — the before-lesson step (1.1.139 M3).
//
// The lesson overview is only as good as its list of concepts: with a concept
// map, each session's concepts map onto the teacher's own nodes and the class
// counts are one number; without one they are free labels the model chose.
// So an activity with no concepts gets one short, skippable nudge, and the
// co-pilot (when the page has one) proposes them from the teaching goal — the
// teacher still applies or edits the proposal (Axiom 2).

import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";

import { useT } from "@/i18n";

export function conceptNudgeKey(activityId: string | null | undefined): string {
  return `aipla.conceptNudge.dismissed.${activityId || "new"}`;
}

export function ConceptListNudge({
  activityId,
  hasConcepts,
  onPropose,
}: {
  activityId?: string | null;
  hasConcepts: boolean;
  /** Ask the page's co-pilot to propose concepts; omitted = no co-pilot here. */
  onPropose?: () => void;
}) {
  const t = useT("ConceptListNudge");
  const key = conceptNudgeKey(activityId);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(key) === "1");
    } catch {
      setDismissed(false);
    }
  }, [key]);

  if (hasConcepts || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Blocked storage: hidden for this visit only.
    }
  };

  return (
    <div
      role="note"
      data-testid="concept-nudge"
      className="flex flex-col gap-2 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-100"
    >
      <p className="flex items-start gap-1">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t("body")}
      </p>
      <div className="flex flex-wrap gap-2">
        {onPropose ? (
          <button
            type="button"
            onClick={onPropose}
            className="rounded border border-sky-400 bg-white px-2.5 py-0.5 font-medium hover:bg-sky-100 dark:bg-transparent"
          >
            {t("propose")}
          </button>
        ) : null}
        <button type="button" onClick={dismiss} className="text-xs hover:underline">
          {t("dismiss")}
        </button>
      </div>
    </div>
  );
}
