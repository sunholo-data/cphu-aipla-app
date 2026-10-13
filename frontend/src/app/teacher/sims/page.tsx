/**
 * /teacher/sims — the Sim workshop (in-app-sim-authoring M4/M5).
 *
 * A teacher describes a simulation to the `sim-author` skill (the floating
 * assistant) and iterates on it. Every time the skill checks a draft, a
 * VERSION is stored (backend `db/sim_drafts.py`): the two files, the level it
 * reached, what stopped it, and screenshots. This page shows those versions so
 * the teacher can judge the drawing and the physics themselves — the checks
 * cannot — and download any version.
 *
 * The draft HTML is never rendered on this origin: screenshots come from the
 * sim-verify service's browser run, and the files download as attachments.
 * A live preview and publishing to the teacher's classes are the next milestone
 * (ADR-013 as amended for teacher sims, 2026-10-13).
 *
 * Behind NEXT_PUBLIC_SIM_WORKSHOP ('1' on dev only), like the other co-pilots.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { TeacherCopilot } from "@/components/teacher/copilot";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { useTeacherFeature } from "@/hooks/useTeacherFeature";
import { useT } from "@/i18n";
import {
  fetchSimFile,
  fetchSimScreenshot,
  getSimDraft,
  listSimDrafts,
  type SimDraft,
  type SimDraftSummary,
  type SimDraftVersion,
} from "@/lib/simDraftsApi";

/** While the assistant works, new versions land every minute or two. */
const POLL_MS = 8000;

export default function SimWorkshopPage() {
  const enabled = useTeacherFeature("simWorkshop", process.env.NEXT_PUBLIC_SIM_WORKSHOP);
  const t = useT("SimWorkshopPage");
  if (!enabled) {
    return (
      <TeacherPage title={t("title")}>
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      </TeacherPage>
    );
  }
  return <SimWorkshop />;
}

function SimWorkshop() {
  const t = useT("SimWorkshopPage");
  const [drafts, setDrafts] = useState<SimDraftSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<SimDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await listSimDrafts();
      setDrafts(list);
      setError(null);
      const id = selected ?? list[0]?.id ?? null;
      if (id && id !== selected) setSelected(id);
      if (id) setDraft(await getSimDraft(id));
    } catch {
      setError(t("loadError"));
    }
  }, [selected, t]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const latest = draft?.versions[draft.versions.length - 1] ?? null;

  return (
    <TeacherPage
      title={t("title")}
      subtitle={t("subtitle")}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t("refresh")}
        </button>
      }
    >
      <p className="text-xs text-muted-foreground">{t("draftOnly")}</p>
      {error ? (
        <div role="alert" className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {drafts === null && !error ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
      {drafts !== null && drafts.length === 0 ? (
        <p data-testid="sim-workshop-empty" className="max-w-prose text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : null}

      {drafts && drafts.length > 0 ? (
        <div className="flex flex-col gap-4 lg:flex-row">
          <nav aria-label={t("draftsHeading")} className="flex flex-col gap-1 lg:w-56">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("draftsHeading")}</h2>
            {drafts.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelected(d.id)}
                aria-current={d.id === selected ? "true" : undefined}
                className={`rounded border px-3 py-2 text-left text-sm ${
                  d.id === selected ? "border-primary bg-muted" : "border-border"
                }`}
              >
                <span className="block font-medium">{d.title ?? "—"}</span>
                <span className="text-xs text-muted-foreground">
                  {t("version", { n: d.latestVersion ?? 0 })} · {t("level", { n: d.latestLevel ?? 0 })}
                </span>
              </button>
            ))}
          </nav>
          <section className="flex min-w-0 flex-1 flex-col gap-4">
            {draft && latest ? <VersionPanel draftId={draft.id} version={latest} /> : null}
            {draft && draft.versions.length > 1 ? (
              <details className="rounded border border-border p-3">
                <summary className="cursor-pointer text-sm">
                  {draft.versions.length - 1} × {t("version", { n: "…" })}
                </summary>
                <div className="mt-3 flex flex-col gap-4">
                  {draft.versions
                    .slice(0, -1)
                    .reverse()
                    .map((v) => (
                      <VersionPanel key={v.version} draftId={draft.id} version={v} compact />
                    ))}
                </div>
              </details>
            ) : null}
          </section>
        </div>
      ) : null}

      <TeacherCopilot
        skillName="sim-author"
        title={t("assistantTitle")}
        persistKey="sim-author"
        placeholder={t("assistantPlaceholder")}
        emptyText={t("assistantEmpty")}
        testId="sim-workshop-copilot"
      />
    </TeacherPage>
  );
}

function VersionPanel({ draftId, version, compact = false }: { draftId: string; version: SimDraftVersion; compact?: boolean }) {
  const t = useT("SimWorkshopPage");
  const shots: { key: string; label: string }[] = [
    { key: "700", label: t("atRest") },
    { key: "driven", label: t("afterClicking") },
    { key: "390", label: t("phone") },
  ].filter((s) => version.screenshots.includes(s.key));

  const download = async (name: "index.html" | "catalogue.yaml") => {
    const blob = await fetchSimFile(draftId, version.version, name);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name === "index.html" ? `v${version.version}-index.html` : `v${version.version}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <article data-testid={`sim-version-${version.version}`} className="flex flex-col gap-3 rounded border border-border p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {t("version", { n: version.version })} · {t("level", { n: version.level ?? 0 })}
        </h3>
        <div className="flex gap-2">
          <button type="button" onClick={() => void download("index.html")} className="rounded border border-border px-2 py-1 text-xs">
            {t("downloadHtml")}
          </button>
          <button type="button" onClick={() => void download("catalogue.yaml")} className="rounded border border-border px-2 py-1 text-xs">
            {t("downloadYaml")}
          </button>
        </div>
      </header>
      {!compact ? <p className="text-xs text-muted-foreground">{t("levelHelp")}</p> : null}
      {version.reasons.length ? (
        <div className="text-xs">
          <span className="font-medium">{t("notReached")}: </span>
          {version.reasons.join("; ")}
        </div>
      ) : null}
      {shots.length ? (
        <div className={`grid gap-3 ${compact ? "grid-cols-3" : "sm:grid-cols-2"}`}>
          {shots.map((s) => (
            <Screenshot key={s.key} draftId={draftId} version={version.version} shot={s.key} label={s.label} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("noScreenshots")}</p>
      )}
    </article>
  );
}

function Screenshot({ draftId, version, shot, label }: { draftId: string; version: number; shot: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fetchSimScreenshot(draftId, version, shot)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [draftId, version, shot]);
  return (
    <figure className="flex flex-col gap-1">
      {src ? (
        // A blob: URL of a PNG this teacher's own draft produced; next/image adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} className="w-full rounded border border-border bg-white" />
      ) : (
        <div className="aspect-[4/3] w-full animate-pulse rounded border border-border bg-muted" />
      )}
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}
