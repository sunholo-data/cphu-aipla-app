"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Circle, Copy, Rocket, X } from "lucide-react";

import { type TeacherStagePayload, fetchTeacherStage } from "@/lib/teacherApi";
import { STAGE_ORDER, type Stage } from "@/lib/onboardingStage";

/** 1.1.108 M4 — copy lives here, never inline in JSX. */
const copy = {
  title: "Getting started",
  progress: (done: number, total: number) => `${done} of ${total}`,
  steps: {
    createClass: "Create a class",
    mintCode: "Mint a group code",
    addActivity: "Add an activity",
    shareLink: "Share the join link",
    firstTurn: "First student conversation",
  },
  actions: {
    createClass: "New class",
    mintCode: "Open the class",
    adopt: "Adopt from the library",
    create: "Create one",
    copyLink: "Copy link",
    copied: "Copied",
    waiting: "Happens when a student joins and writes",
  },
  readInstead: "Prefer to read? The guide walks through the same steps.",
  guide: "Set up a class",
  dismiss: "Hide",
  live: "Your class is live — students are talking to the tutor.",
} as const;

const DISMISS_KEY = "aipla.gettingStarted.dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* per-viewer convenience only */
  }
}

function reached(stage: Stage, target: Stage): boolean {
  return STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(target);
}

/**
 * The first-run checklist (1.1.124 M1) — the teacher's view of the same stage
 * the Programme page shows a researcher. Five steps, ticked from the stage;
 * each undone step links to the CONTROL, not to a guide. Shown until the class
 * is live, dismissible after; renders nothing while the stage is unknown, so a
 * teacher already past all this never sees it flash.
 *
 * "Add an activity" offers ADOPT first: the builder is where teachers stall
 * (1.1.86, the 28-item list, JB's mail), and a one-click copy from the shared
 * catalogue gets a first lesson running without it.
 */
export function GettingStartedCard({ onCreateClass }: { onCreateClass: () => void }) {
  const [stage, setStage] = useState<TeacherStagePayload | null>(null);
  const [hidden, setHidden] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTeacherStage()
      .then((s) => {
        if (cancelled) return;
        setStage(s);
        setHidden(s.stage === "live" && readDismissed());
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
    { key: "shareLink", done: reached(s, "live") },
    { key: "firstTurn", done: reached(s, "live") },
  ] as const;
  const done = steps.filter((st) => st.done).length;

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
      className="rounded-lg border border-border bg-background p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="getting-started-label" className="flex items-center gap-2 text-sm font-semibold">
          <Rocket className="h-4 w-4" aria-hidden="true" />
          {copy.title}
          <span className="font-normal text-muted-foreground">{copy.progress(done, steps.length)}</span>
        </h2>
        {s === "live" ? (
          <button
            type="button"
            onClick={() => {
              writeDismissed();
              setHidden(true);
            }}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            {copy.dismiss}
          </button>
        ) : null}
      </div>
      {s === "live" ? <p className="mb-2 text-sm text-muted-foreground">{copy.live}</p> : null}
      <ol className="flex flex-col gap-1.5 text-sm">
        {steps.map((st) => (
          <li key={st.key} className="flex flex-wrap items-center gap-2" data-testid={`step-${st.key}`} data-done={st.done}>
            {st.done ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-label="done" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
            )}
            <span className={st.done ? "text-muted-foreground line-through" : "font-medium"}>{copy.steps[st.key]}</span>
            {!st.done ? <StepAction step={st.key} firstClassId={first?.classId ?? null} firstCode={firstCode} copied={copied} onCreateClass={onCreateClass} onCopy={copyJoinLink} /> : null}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        {copy.readInstead}{" "}
        <Link href="/guides/t1-set-up-a-class" className="underline hover:text-foreground">
          {copy.guide}
        </Link>
      </p>
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
}: {
  step: keyof typeof copy.steps;
  firstClassId: string | null;
  firstCode: string | null;
  copied: boolean;
  onCreateClass: () => void;
  onCopy: () => void;
}) {
  switch (step) {
    case "createClass":
      return (
        <button type="button" onClick={onCreateClass} className={linkClass}>
          {copy.actions.createClass}
        </button>
      );
    case "mintCode":
      return firstClassId ? (
        <Link href={`/teacher/classes/${encodeURIComponent(firstClassId)}`} className={linkClass}>
          {copy.actions.mintCode}
        </Link>
      ) : null;
    case "addActivity":
      return (
        <>
          <Link href="/teacher/activities#shared" className={linkClass}>
            {copy.actions.adopt}
          </Link>
          <Link
            href={firstClassId ? `/teacher/activities/new?classId=${encodeURIComponent(firstClassId)}` : "/teacher/activities/new"}
            className={linkClass}
          >
            {copy.actions.create}
          </Link>
        </>
      );
    case "shareLink":
      return firstCode ? (
        <button type="button" onClick={onCopy} className={`${linkClass} inline-flex items-center gap-1`}>
          <Copy className="h-3 w-3" aria-hidden="true" />
          {copied ? copy.actions.copied : copy.actions.copyLink}
        </button>
      ) : null;
    case "firstTurn":
      return <span className="text-xs text-muted-foreground">{copy.actions.waiting}</span>;
  }
}
