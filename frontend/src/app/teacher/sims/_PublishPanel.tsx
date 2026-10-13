"use client";

import { useState } from "react";

import { useT } from "@/i18n";
import type { SimDraftVersion } from "@/lib/simDraftsApi";
import {
  TeacherSimError,
  publishSimVersion,
  requestLibrary,
  withdrawTeacherSim,
  type TeacherSim,
} from "@/lib/teacherSimsApi";

/**
 * Publish the latest checked version to the teacher's own classes, with their
 * recorded approval (in-app-sim-authoring M6, ADR-013 as amended 2026-10-13);
 * then ask for the shared library, or withdraw. The server re-runs every gate on
 * the exact version and refuses with reasons, which are shown as they come.
 */
export function PublishPanel({
  draftId,
  latest,
  published,
  onChange,
}: {
  draftId: string;
  latest: SimDraftVersion;
  published: TeacherSim | null;
  onChange: (sim: TeacherSim) => void;
}) {
  const t = useT("SimPublish");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  const live = published?.status === "live" ? published : null;
  const isCurrent = !!live && live.draftVersion === latest.version;
  const canPublish = (latest.level ?? 0) >= 3;

  const run = async (fn: () => Promise<TeacherSim>) => {
    setBusy(true);
    setReasons(null);
    try {
      onChange(await fn());
      setApproved(false);
      setAsking(false);
      setNote("");
    } catch (err) {
      setReasons(
        err instanceof TeacherSimError && err.reasons.length
          ? err.reasons
          : [t("error")],
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="sim-publish"
      aria-label={t("heading")}
      className="flex flex-col gap-3 rounded border border-border p-3"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("heading")}
      </h2>

      {live ? (
        <div
          className="flex flex-col gap-2 text-sm"
          data-testid="sim-published"
        >
          <p>
            {t("published", {
              name: live.displayName ?? live.id,
              v: live.version,
              draft: live.draftVersion ?? "?",
              by: live.approvedBy ?? "?",
            })}
          </p>
          {live.scope === "library" ? (
            <p className="text-muted-foreground">
              {t("inLibrary", { by: live.librarySignoff?.by ?? "?" })}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("inPicker")}</p>
          {!isCurrent ? (
            <p className="text-xs text-muted-foreground">
              {t("newerDraft", { n: latest.version, v: live.version })}
            </p>
          ) : null}
          {live.scope === "classes" && live.libraryRequested ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="sim-library-requested"
            >
              {t("requested")}
            </p>
          ) : null}
          {live.scope === "classes" &&
          !live.libraryRequested &&
          live.libraryDeclined ? (
            <p className="text-xs text-muted-foreground">
              {t("declined", { note: live.libraryDeclined.note || "—" })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {live.scope === "classes" && !live.libraryRequested && !asking ? (
              <button
                type="button"
                onClick={() => setAsking(true)}
                className="rounded border border-border px-2 py-1 text-xs"
              >
                {t("askLibrary")}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("withdrawConfirm")))
                  void run(() => withdrawTeacherSim(live.id));
              }}
              className="rounded border border-border px-2 py-1 text-xs"
            >
              {t("withdraw")}
            </button>
          </div>
          {asking ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-xs">
                {t("askNote")}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="rounded border border-border p-2 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => requestLibrary(live.id, note))}
                className="self-start rounded border border-border px-2 py-1 text-xs"
              >
                {t("askSend")}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("intro")}</p>
          {published?.status === "withdrawn" ? (
            <p className="text-xs text-muted-foreground">{t("withdrawn")}</p>
          ) : null}
        </>
      )}

      {!isCurrent ? (
        canPublish ? (
          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
                className="mt-1"
                data-testid="sim-publish-approve"
              />
              <span>{t("approve", { n: latest.version })}</span>
            </label>
            <button
              type="button"
              disabled={!approved || busy}
              onClick={() =>
                void run(() => publishSimVersion(draftId, latest.version))
              }
              data-testid="sim-publish-button"
              className="self-start rounded border border-border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy
                ? t("publishing")
                : t(live ? "update" : "publish", { n: latest.version })}
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("needsLevel3")}</p>
        )
      ) : null}

      {reasons ? (
        <div
          role="alert"
          className="rounded border border-destructive bg-destructive/10 p-2 text-xs text-destructive"
        >
          <p className="font-medium">{t("refused")}</p>
          <ul className="list-disc pl-4">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
