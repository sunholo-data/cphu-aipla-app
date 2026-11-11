"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ChevronDown, Circle, Copy, Rocket, X } from "lucide-react";

import { type TeacherStagePayload, fetchTeacherStage } from "@/lib/teacherApi";
import { STAGE_ORDER, type Stage } from "@/lib/onboardingStage";
import { useT } from "@/i18n";

/** 1.1.108 M4 — copy lives here, never inline in JSX. */
type StepKey = "createClass" | "mintCode" | "addActivity" | "previewOpening" | "shareLink" | "firstTurn";

const DISMISS_KEY = "aipla.gettingStarted.dismissed";

/**
 * Hiding is a per-viewer convenience. Once the class is LIVE the card is done
 * and "Skjul" is remembered in this browser (localStorage, as before). Before
 * that, "Skjul" only hides it for this browser session (sessionStorage): a
 * teacher half-way through setting up should get the checklist back tomorrow,
 * not lose it for good to one click.
 */
function readDismissed(live: boolean): boolean {
  try {
    if (live && window.localStorage.getItem(DISMISS_KEY) === "1") return true;
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(live: boolean): void {
  try {
    (live ? window.localStorage : window.sessionStorage).setItem(DISMISS_KEY, "1");
  } catch {
    /* per-viewer convenience only */
  }
}

function reached(stage: Stage, target: Stage): boolean {
  return STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(target);
}

/**
 * The first-run checklist (1.1.124 M1) — the teacher's view of the same stage
 * the Programme page shows a researcher. Five steps ticked from the stage,
 * plus the teacher's own confirmation that they checked the student opening;
 * each undone step links to the CONTROL, not to a guide. Shown until the class
 * is live, dismissible after; renders nothing while the stage is unknown, so a
 * teacher already past all this never sees it flash.
 *
 * "Add an activity" offers ADOPT first: the builder is where teachers stall
 * (1.1.86, the 28-item list, JB's mail), and a one-click copy from the shared
 * catalogue gets a first lesson running without it.
 *
 * UI sweep 2026-11-11: it opens as ONE line — "Kom i gang · 4 af 6 · Næste
 * trin: … · Fortsæt · Skjul" — because a six-row card at the top of the page
 * teachers land on was most of what made it busy. "Fortsæt" expands the full
 * checklist; every step keeps its action there.
 */
export function GettingStartedCard({ onCreateClass }: { onCreateClass: () => void }) {
  const t = useT("GettingStartedCard");
  const [stage, setStage] = useState<TeacherStagePayload | null>(null);
  const [hidden, setHidden] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewChecked, setPreviewChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTeacherStage()
      .then((s) => {
        if (cancelled) return;
        setStage(s);
        setHidden(readDismissed(s.stage === "live"));
      })
      .catch(() => {
        /* no card is better than a wrong card */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!stage || hidden) return null;

  const own = stage.classes.filter((c) => !c.demo && c.name !== "Demo class");
  const first = own[0] ?? null;
  const firstCode = own.flatMap((c) => c.groupCodes)[0] ?? null;
  const s = stage.stage;
  const steps = [
    { key: "createClass", done: reached(s, "no_code") },
    { key: "mintCode", done: reached(s, "no_activity") },
    { key: "addActivity", done: reached(s, "waiting") },
    { key: "previewOpening", done: previewChecked },
    { key: "shareLink", done: reached(s, "live") },
    { key: "firstTurn", done: reached(s, "live") },
  ] as const;
  const done = steps.filter((st) => st.done).length;
  const next = steps.find((st) => !st.done) ?? null;

  function copyJoinLink() {
    if (!firstCode) return;
    const link = `${window.location.origin}/group?code=${encodeURIComponent(firstCode)}`;
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <section
      aria-labelledby="getting-started-label"
      data-testid="getting-started-card"
      data-stage={s}
      className="rounded-lg border border-border bg-background px-4 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <h2 id="getting-started-label" className="flex items-center gap-2 font-semibold">
          <Rocket className="h-4 w-4" aria-hidden="true" />
          {t("title")}
          <span className="font-normal text-muted-foreground">· {t("progress", { done, total: steps.length })}</span>
        </h2>
        <p className="min-w-0 flex-1 text-muted-foreground" data-testid="getting-started-next">
          {s === "live" ? t("live") : next ? t("nextStep", { step: t(`step_${next.key}`) }) : null}
        </p>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="getting-started-steps"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary hover:bg-accent"
        >
          {expanded ? t("collapse") : t("continue")}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            writeDismissed(s === "live");
            setHidden(true);
          }}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {t("dismiss")}
        </button>
      </div>
      <div id="getting-started-steps" hidden={!expanded} className={expanded ? "mt-3" : undefined}>
        <ol className="flex flex-col gap-1.5 text-sm">
          {steps.map((st) => (
            <li key={st.key} className="flex flex-wrap items-center gap-2" data-testid={`step-${st.key}`} data-done={st.done}>
              {st.done ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-label={t("doneAria")} />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
              )}
              <span className={st.done ? "text-muted-foreground line-through" : "font-medium"}>{t(`step_${st.key}`)}</span>
              {!st.done ? <StepAction step={st.key} firstClassId={first?.classId ?? null} firstCode={firstCode} copied={copied} onCreateClass={onCreateClass} onCopy={copyJoinLink} onPreviewChecked={() => setPreviewChecked(true)} /> : null}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("readInstead")}{" "}
          <Link href="/guides/t1-set-up-a-class" className="underline hover:text-foreground">
            {t("guide")}
          </Link>
        </p>
      </div>
    </section>
  );
}

const linkClass = "rounded border border-border px-2 py-0.5 text-xs hover:bg-accent";

function StepAction({
  step,
  firstClassId,
  firstCode,
  copied,
  onCreateClass,
  onCopy,
  onPreviewChecked,
}: {
  step: StepKey;
  firstClassId: string | null;
  firstCode: string | null;
  copied: boolean;
  onCreateClass: () => void;
  onCopy: () => void;
  onPreviewChecked: () => void;
}) {
  const t = useT("GettingStartedCard");
  switch (step) {
    case "createClass":
      return (
        <button type="button" onClick={onCreateClass} className={linkClass}>
          {t("action_createClass")}
        </button>
      );
    case "mintCode":
      return firstClassId ? (
        <Link href={`/teacher/classes/${encodeURIComponent(firstClassId)}?tab=lesson`} className={linkClass}>
          {t("action_mintCode")}
        </Link>
      ) : null;
    case "addActivity":
      return (
        <>
          <Link href="/teacher/activities#shared" className={linkClass}>
            {t("action_adopt")}
          </Link>
          <Link
            href={firstClassId ? `/teacher/activities/new?classId=${encodeURIComponent(firstClassId)}` : "/teacher/activities/new"}
            className={linkClass}
          >
            {t("action_create")}
          </Link>
        </>
      );
    case "shareLink":
      return firstCode ? (
        <button type="button" onClick={onCopy} className={`${linkClass} inline-flex items-center gap-1`}>
          <Copy className="h-3 w-3" aria-hidden="true" />
          {copied ? t("action_copied") : t("action_copyLink")}
        </button>
      ) : null;
    case "previewOpening":
      return firstClassId ? <>
        <Link href={`/teacher/classes/${encodeURIComponent(firstClassId)}?tab=setup`} className={linkClass}>{t("action_previewOpening")}</Link>
        <button type="button" onClick={onPreviewChecked} className={linkClass}>{t("action_previewChecked")}</button>
      </> : null;
    case "firstTurn":
      return <span className="text-xs text-muted-foreground">{t("action_waiting")}</span>;
  }
}
