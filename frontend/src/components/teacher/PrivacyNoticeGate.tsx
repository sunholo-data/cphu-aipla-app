"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

import {
  acknowledgePrivacyNotice,
  getPrivacyNotice,
  type PrivacyNoticeStatus,
} from "@/lib/privacyNoticeApi";
import { useT } from "@/i18n";

const POINTS = ["pointAccount", "pointStudents", "pointChat", "pointAi", "pointAsk", "pointContact"] as const;

/**
 * Shows the teacher privacy notice until the signed-in teacher acknowledges the
 * current version (KU legal, 2026-10-05: a verbal explanation is not enough).
 *
 * Blocking on purpose — "before or upon first login" — but it FAILS OPEN: if
 * the status cannot be read, nothing is shown, so a Firestore blip never locks
 * every teacher out. The acknowledgement is recorded server-side with the
 * server's time; `make list-privacy-acks ENV=<env>` lists them.
 */
export function PrivacyNoticeGate() {
  const t = useT("PrivacyNoticeGate");
  const [status, setStatus] = useState<PrivacyNoticeStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPrivacyNotice()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        // Fail open — see the docstring.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || status.acknowledged) return null;

  const acknowledge = async () => {
    setSaving(true);
    setFailed(false);
    try {
      setStatus(await acknowledgePrivacyNotice(status.version));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-notice-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-brand" aria-hidden="true" />
          <h2 id="privacy-notice-title" className="text-lg font-semibold">
            {t("title")}
          </h2>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">{t("intro")}</p>
        <ul className="mb-4 ml-5 list-disc space-y-2 text-sm">
          {POINTS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
        <p className="mb-5 text-sm">
          <Link href="/privacy" target="_blank" className="font-medium underline underline-offset-2">
            {t("readFull")}
          </Link>
        </p>
        {failed ? (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {t("error")}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void acknowledge()}
          disabled={saving}
          className="w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {saving ? t("saving") : t("acknowledge")}
        </button>
      </div>
    </div>
  );
}
