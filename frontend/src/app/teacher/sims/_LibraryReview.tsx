"use client";

import { useCallback, useEffect, useState } from "react";

import { StaticArtefactFrame } from "@/components/workspace/StaticArtefactFrame";
import { useT } from "@/i18n";
import {
  decideLibrary,
  listLibraryRequests,
  type TeacherSim,
} from "@/lib/teacherSimsApi";
import { loadTeacherSimPage } from "@/lib/teacherSimPage";

const sandboxOrigin = () =>
  (process.env.NEXT_PUBLIC_MCP_SANDBOX_URL ?? "").replace(
    /\/sandbox\.html$/,
    "",
  );

/**
 * For researchers: teacher sims asking for the shared library. The reviewer
 * tries the exact published version (the page students get, in the same
 * sandbox frame) and records a decision with a note. Approval makes it
 * available to every teacher; the decision is stored with the sim.
 */
export function LibraryReview() {
  const t = useT("SimPublish");
  const [requests, setRequests] = useState<TeacherSim[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setRequests(await listLibraryRequests());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      data-testid="sim-library-review"
      className="flex flex-col gap-3 rounded border border-border p-3"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("reviewHeading")}
      </h2>
      <p className="text-xs text-muted-foreground">{t("reviewIntro")}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("error")}
        </p>
      ) : null}
      {requests !== null && requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("reviewEmpty")}</p>
      ) : null}
      {(requests ?? []).map((r) => (
        <ReviewItem key={r.id} sim={r} onDone={() => void load()} />
      ))}
    </section>
  );
}

function ReviewItem({ sim, onDone }: { sim: TeacherSim; onDone: () => void }) {
  const t = useT("SimPublish");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const origin = sandboxOrigin();
  const path = `teacher-sims/${sim.id}/v${sim.version}`;

  const decide = async (approve: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      await decideLibrary(sim.id, approve, note);
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      data-testid={`sim-review-${sim.id}`}
      className="flex flex-col gap-2 rounded border border-border p-3 text-sm"
    >
      <h3 className="font-medium">{sim.displayName ?? sim.id}</h3>
      <p className="text-xs text-muted-foreground">
        {t("reviewFrom", {
          v: sim.version,
          at: sim.request?.at?.slice(0, 10) ?? "?",
        })}
      </p>
      {sim.request?.note ? (
        <p className="text-xs">{t("reviewNote", { note: sim.request.note })}</p>
      ) : null}
      {origin ? (
        open ? (
          <StaticArtefactFrame
            sandboxOrigin={origin}
            artefactPath={path}
            loadHtml={() => loadTeacherSimPage(path)}
            onUpdateModelContext={() => {}}
            title={sim.displayName ?? sim.id}
            className="h-[560px] w-full rounded border border-border bg-white"
          />
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="self-start rounded border border-border px-2 py-1 text-xs"
          >
            {t("reviewTry")}
          </button>
        )
      ) : null}
      <label className="flex flex-col gap-1 text-xs">
        {t("reviewYourNote")}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="rounded border border-border p-2 text-sm"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(true)}
          className="rounded border border-border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {t("reviewApprove")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(false)}
          className="rounded border border-border px-3 py-1.5 text-xs"
        >
          {t("reviewDecline")}
        </button>
      </div>
      {failed ? (
        <p role="alert" className="text-xs text-destructive">
          {t("error")}
        </p>
      ) : null}
    </article>
  );
}
