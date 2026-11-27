"use client";

/** 1.1.165 — the group's own activity sheet, in the chat header.
 *
 *  The digital copy of the page the teacher hands out: same content, the
 *  group's own code. Opens in a dialog with Download (Word) and Print. Loads
 *  only when opened, so a lesson pays nothing for it until someone asks.
 */

import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { Download, FileText, Printer, X } from "lucide-react";

import { ActivitySheetView } from "@/components/activity-sheet/ActivitySheetView";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import {
  type ActivitySheets,
  SheetWordUnavailableError,
  activitySheetFilename,
  downloadMyActivitySheetWord,
  getMyActivitySheet,
} from "@/lib/activitySheetApi";
import { triggerDownload } from "@/lib/download";
import { printSheets } from "@/lib/printSheets";

type Load = { kind: "idle" } | { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: ActivitySheets };

export function ActivitySheetButton({ activityId }: { activityId: string }) {
  const t = useT("ActivitySheet");
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ kind: "idle" });
  const [downloading, setDownloading] = useState(false);
  const [wordError, setWordError] = useState<"unavailable" | "failed" | null>(null);
  const sheetsRef = useRef<HTMLDivElement>(null);

  const fetchSheet = async () => {
    setLoad({ kind: "loading" });
    try {
      setLoad({ kind: "ready", data: await getMyActivitySheet(activityId) });
    } catch {
      setLoad({ kind: "error" });
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    setWordError(null);
    if (next && load.kind !== "ready") void fetchSheet();
  };

  const download = async (data: ActivitySheets) => {
    setDownloading(true);
    setWordError(null);
    try {
      triggerDownload(await downloadMyActivitySheetWord(activityId), activitySheetFilename(data));
    } catch (e) {
      setWordError(e instanceof SheetWordUnavailableError ? "unavailable" : "failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          title={t("open")}
          data-testid="activity-sheet-open"
          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <FileText className="h-3 w-3" aria-hidden="true" />
          <span>{t("button")}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border bg-background p-4 shadow-xl outline-none"
          data-testid="activity-sheet-dialog"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <Dialog.Title className="text-base font-semibold">{t("title")}</Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground">{t("description")}</Dialog.Description>
            </div>
            <Dialog.Close
              aria-label={t("close")}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Dialog.Close>
          </div>

          {load.kind === "ready" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void download(load.data)}
                pending={downloading}
                pendingLabel={t("downloading")}
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                {t("downloadWord")}
              </Button>
              <Button
                size="sm"
                onClick={() => printSheets(sheetsRef.current, load.data.title, load.data.language)}
              >
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                {t("print")}
              </Button>
            </div>
          ) : null}
          {wordError ? (
            <p role="alert" className="rounded border border-border bg-muted px-3 py-2 text-xs">
              {wordError === "unavailable" ? t("wordUnavailable") : t("wordFailed")}
            </p>
          ) : null}

          <div className="min-h-0 overflow-auto">
            {load.kind === "ready" ? (
              <ActivitySheetView ref={sheetsRef} sheets={load.data.sheets} language={load.data.language} />
            ) : load.kind === "error" ? (
              <div className="flex flex-col items-start gap-2 text-sm">
                <p>{t("loadFailed")}</p>
                <Button size="sm" onClick={() => void fetchSheet()}>
                  {t("retry")}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
