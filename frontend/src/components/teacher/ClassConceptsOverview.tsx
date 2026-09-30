"use client";

// ClassConceptsOverview — the class's concepts at the TOP of the class page
// (1.1.139 M2, first slice, 2026-09-30).
//
// JB, after a teacher session: "the UI of finding concepts [should be]
// easier" and "have the concepts discussed in aggregate". The class concept
// graph already WAS the aggregate — it just sat collapsed at the bottom of the
// page, under settings and conversations, where nobody scrolled to it.
//
// The one rule here: an empty graph at the top is worse than the old
// placement. So until the rollup answers with at least one concept, this
// renders nothing (loading, failed) or a single muted line (no concepts yet)
// — never an empty card.

import { useCallback, useEffect, useState } from "react";

import { ClassConceptGraph } from "@/components/teacher/ClassConceptGraph";
import { SettingsSection } from "@/components/teacher/ui/SettingsSection";
import { useT } from "@/i18n";

export const CLASS_CONCEPTS_ANCHOR = "class-concepts";

export function classConceptsOpenKey(classId: string): string {
  return `aipla.classConcepts.open.${classId}`;
}

function readOpen(classId: string): boolean {
  try {
    const v = window.localStorage.getItem(classConceptsOpenKey(classId));
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

function writeOpen(classId: string, open: boolean): void {
  try {
    window.localStorage.setItem(classConceptsOpenKey(classId), open ? "1" : "0");
  } catch {
    // Private window / blocked storage — the toggle still works this visit.
  }
}

export function ClassConceptsOverview({ classId }: { classId: string }) {
  const t = useT("ClassConceptsOverview");
  // undefined = still loading; null = the read failed; number = concept count.
  const [count, setCount] = useState<number | null | undefined>(undefined);
  // Open by default: this is the first thing the page is for now. Read the
  // stored choice after mount so server and client render the same markup.
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setOpen(readOpen(classId));
  }, [classId]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      writeOpen(classId, next);
    },
    [classId],
  );

  const hasConcepts = typeof count === "number" && count > 0;

  return (
    <>
      {count === 0 ? (
        <p
          id={CLASS_CONCEPTS_ANCHOR}
          data-testid="class-concepts-hint"
          className="text-xs text-muted-foreground"
        >
          {t("emptyHint")}
        </p>
      ) : null}
      {/* The graph stays mounted (hidden) until it reports: it owns the fetch,
          and a host that only mounted it once there was data would never learn
          there was data. */}
      <div hidden={!hasConcepts} data-testid="class-concepts-overview">
        <SettingsSection
          id={hasConcepts ? CLASS_CONCEPTS_ANCHOR : undefined}
          title={t("title")}
          description={t("description")}
          collapsible
          open={open}
          onOpenChange={onOpenChange}
          keepMounted
        >
          <ClassConceptGraph classId={classId} onLoaded={setCount} />
        </SettingsSection>
      </div>
    </>
  );
}
