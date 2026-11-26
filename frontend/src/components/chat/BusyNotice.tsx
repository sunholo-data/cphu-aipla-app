"use client";

import { useEffect, useState } from "react";

import { useT, type Locale } from "@/i18n";
import { onBusy } from "@/lib/busySignal";

/** How long the notice stays after the last busy answer, unless closed. */
export const BUSY_NOTICE_MS = 120_000;

/**
 * "AIPLA is busy right now — wait a moment" (2026-11-26).
 *
 * Shown when any request from this page came back busy (a Google quota the
 * backend could not absorb; lib/busySignal.ts). It names the time, so a group
 * can tell the teacher when it happened and the teacher can pass that on.
 * The tutor and the work are fine to continue with: the next push carries the
 * whole state again.
 *
 * `hidden` while the chat's own error banner is already saying "busy", so the
 * student never reads the same message twice.
 */
export function BusyNotice({ locale, hidden = false }: { locale: Locale; hidden?: boolean }) {
  const t = useT("ChatPage", locale);
  const [at, setAt] = useState<number | null>(null);

  useEffect(() => onBusy(setAt), []);
  useEffect(() => {
    if (at === null) return;
    const id = window.setTimeout(() => setAt(null), BUSY_NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [at]);

  if (at === null || hidden) return null;
  const time = new Date(at).toLocaleTimeString(locale === "da" ? "da-DK" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div
      role="status"
      data-testid="busy-notice"
      className="mb-2 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <div className="flex-1">
        <p className="font-medium">{t("busyTitle")}</p>
        <p>{t("busyBody", { time })}</p>
      </div>
      <button
        type="button"
        onClick={() => setAt(null)}
        className="shrink-0 rounded px-2 py-0.5 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900"
      >
        {t("busyDismiss")}
      </button>
    </div>
  );
}
