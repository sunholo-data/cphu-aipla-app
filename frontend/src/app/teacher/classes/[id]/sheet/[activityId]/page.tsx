"use client";

/** 1.1.165 — the activity sheet for every group of a class: download Word, or print.
 *
 *  One page per live join code, built on the server from what students already
 *  see. The names line is blank on purpose: names against codes live only in
 *  this browser (1.1.137), and the sheet is made on the server.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Printer } from "lucide-react";

import { ActivitySheetView } from "@/components/activity-sheet/ActivitySheetView";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/ui/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import {
  type ActivitySheets,
  SheetWordUnavailableError,
  activitySheetFilename,
  downloadClassActivitySheetWord,
  getClassActivitySheets,
} from "@/lib/activitySheetApi";
import { triggerDownload } from "@/lib/download";
import { printSheets } from "@/lib/printSheets";

type Load = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: ActivitySheets };

export default function ActivitySheetPage() {
  const t = useT("ActivitySheetPage");
  const params = useParams();
  const classId = typeof params?.id === "string" ? params.id : "";
  const activityId = typeof params?.activityId === "string" ? params.activityId : "";
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [downloading, setDownloading] = useState(false);
  const [wordError, setWordError] = useState<"unavailable" | "failed" | null>(null);
  const sheetsRef = useRef<HTMLDivElement>(null);

  const fetchSheets = useCallback(async () => {
    if (!classId || !activityId) return;
    setLoad({ kind: "loading" });
    try {
      setLoad({ kind: "ready", data: await getClassActivitySheets(classId, activityId) });
    } catch {
      setLoad({ kind: "error" });
    }
  }, [classId, activityId]);

  useEffect(() => {
    void fetchSheets();
  }, [fetchSheets]);

  const download = async (data: ActivitySheets) => {
    setDownloading(true);
    setWordError(null);
    try {
      triggerDownload(await downloadClassActivitySheetWord(classId, activityId), activitySheetFilename(data));
    } catch (e) {
      setWordError(e instanceof SheetWordUnavailableError ? "unavailable" : "failed");
    } finally {
      setDownloading(false);
    }
  };

  const data = load.kind === "ready" ? load.data : null;
  const groups = data ? data.sheets.filter((s) => s.code !== null).length : 0;

  return (
    <TeacherPage
      breadcrumb={
        <Link
          href={`/teacher/classes/${encodeURIComponent(classId)}`}
          className="flex w-fit items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("breadcrumb")}
        </Link>
      }
      title={data?.title?.trim() || t("title")}
      subtitle={data ? (groups > 0 ? t("subtitleGroups", { n: groups }) : t("subtitleNoGroups")) : undefined}
      actions={
        data ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={() => void download(data)}
              pending={downloading}
              pendingLabel={t("downloading")}
              data-testid="sheet-download-word"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("downloadWord")}
            </Button>
            <Button
              onClick={() => printSheets(sheetsRef.current, data.title, data.language)}
              data-testid="sheet-print"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              {t("print")}
            </Button>
          </div>
        ) : null
      }
    >
      <div className="flex max-w-2xl flex-col gap-3">
        {wordError ? (
          <p role="alert" className="rounded border border-border bg-muted px-3 py-2 text-sm">
            {wordError === "unavailable" ? t("wordUnavailable") : t("wordFailed")}
          </p>
        ) : null}
        {load.kind === "loading" ? (
          <div className="flex flex-col gap-2" aria-hidden>
            <Skeleton className="h-64 w-full" />
          </div>
        ) : load.kind === "error" ? (
          <LoadError what={t("what")} onRetry={() => void fetchSheets()} />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("hint")}</p>
            <ActivitySheetView ref={sheetsRef} sheets={load.data.sheets} />
          </>
        )}
      </div>
    </TeacherPage>
  );
}
