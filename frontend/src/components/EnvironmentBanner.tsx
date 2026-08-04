"use client";

import { FlaskConical, TriangleAlert, Wrench } from "lucide-react";

import { useEnvironment } from "@/hooks/useEnvironment";
import {
  type EnvironmentName,
  environmentLabel,
  shouldAnnounceEnvironment,
} from "@/lib/environment";

/**
 * EnvironmentBanner — a strip at the top of every page naming which
 * deployment the user is looking at, on everything except production.
 *
 * Why: AIPLA's three environments are told apart only by an opaque Cloud Run
 * hostname. On 2026-08-04 a teacher spent two hours minting group codes on dev
 * and typing them into test, where they 401 — codes are Firestore documents
 * and Firestore is per-project. Nothing in the UI said the two sites were
 * different systems. Now it does, in the one place that can't be missed.
 *
 * Renders nothing on prod (the real site needs no warning strip) and nothing
 * on LOCAL_MODE (LocalModeBanner already says it, louder) — and nothing at all
 * if the backend can't be reached, because "I don't know" must never be
 * displayed as "this is fine".
 */

const TONE: Record<string, { bar: string; pill: string; Icon: typeof Wrench }> = {
  test: {
    bar: "bg-violet-100 border-violet-300 text-violet-900 dark:bg-violet-950 dark:border-violet-800 dark:text-violet-100",
    pill: "bg-violet-200 text-violet-900 dark:bg-violet-800 dark:text-violet-50",
    Icon: FlaskConical,
  },
  dev: {
    bar: "bg-sky-100 border-sky-300 text-sky-900 dark:bg-sky-950 dark:border-sky-800 dark:text-sky-100",
    pill: "bg-sky-200 text-sky-900 dark:bg-sky-800 dark:text-sky-50",
    Icon: Wrench,
  },
  unknown: {
    bar: "bg-rose-100 border-rose-300 text-rose-900 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-100",
    pill: "bg-rose-200 text-rose-900 dark:bg-rose-800 dark:text-rose-50",
    Icon: TriangleAlert,
  },
};

export function EnvironmentBanner() {
  const info = useEnvironment();

  if (!info || !shouldAnnounceEnvironment(info.env)) return null;

  const tone = TONE[info.env] ?? TONE.unknown;
  const label = environmentLabel(info.env);
  const { Icon } = tone;

  return (
    <div
      role="status"
      aria-label={`${label.tag} environment`}
      data-testid="environment-banner"
      data-environment={info.env satisfies EnvironmentName}
      className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-xs ${tone.bar}`}
    >
      <span className="flex items-center gap-1.5 font-semibold">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className={`rounded px-1.5 py-0.5 tracking-wide ${tone.pill}`}>
          {label.tag}
        </span>
      </span>
      <span>{label.da}</span>
      <span className="opacity-70">{label.en}</span>
      {(info.projectId || info.version) && (
        <span className="ml-auto hidden font-mono opacity-70 md:inline">
          {[info.projectId, info.version].filter(Boolean).join(" · ")}
        </span>
      )}
    </div>
  );
}
