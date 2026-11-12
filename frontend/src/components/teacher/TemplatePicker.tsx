"use client";

import type { LucideIcon } from "lucide-react";
import {
  Calculator,
  Check,
  FilePlus2,
  ChevronLeft,
  ChevronRight,
  FileUp,
  FlaskConical,
  Languages,
  LayoutGrid,
  LineChart,
  ListChecks,
  MessageCircle,
  Network,
  PenLine,
  Sparkles,
  StickyNote,
  Table2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { SimThumbnail, simScreenshotUrl } from "@/components/teacher/SimThumbnail";
import { useT } from "@/i18n";
import { ACTIVITY_TEMPLATES, type ActivityTemplate } from "@/lib/activityTemplates";
import { cn } from "@/lib/utils";

interface TemplatePickerProps {
  onPick: (template: ActivityTemplate) => void;
  /** Reset the builder to a blank draft — the "start from scratch" card. */
  onStartBlank?: () => void;
  /** The template already applied, so reopening the strip still marks it. */
  appliedId?: string | null;
}

// 1.1.108 M2 — copy lives in messages (namespace TemplatePicker). Families and
// features are keyed `family_<id>` / `feature_<key>`.
export type FeatureKey =
  | "sim"
  | "checklist"
  | "table"
  | "chart"
  | "calculator"
  | "note"
  | "writing"
  | "solution"
  | "document"
  | "conceptMap";

type FamilyId = "sim" | "lab" | "writing" | "dialogue";

interface Family {
  id: FamilyId;
  icon: LucideIcon;
  tile: string;
}

const FAMILIES: Record<FamilyId, Family> = {
  sim: { id: "sim", icon: FlaskConical, tile: "bg-emerald-100 text-emerald-700" },
  lab: { id: "lab", icon: Table2, tile: "bg-sky-100 text-sky-700" },
  writing: { id: "writing", icon: PenLine, tile: "bg-amber-100 text-amber-700" },
  dialogue: {
    id: "dialogue",
    icon: MessageCircle,
    tile: "bg-violet-100 text-violet-700",
  },
};

const FAMILY_ORDER: FamilyId[] = ["sim", "lab", "writing", "dialogue"];

// The "start from scratch" card's applied-id; never collides with a template.
const BLANK_ID = "__blank__";

// The shape of the lesson, derived from what the template puts in the
// workspace rather than declared — so it can never drift from the content.
// Order matters: a sim lab is "Simulation" first, a chalk-and-photo lab with a
// table is a "Measurement lab" even though it also has a solution photo.
export function templateFamily(t: ActivityTemplate): Family {
  if (t.artefactId) return FAMILIES.sim;
  if (t.table || t.chart) return FAMILIES.lab;
  if (t.solution || t.document || t.writing?.length) return FAMILIES.writing;
  return FAMILIES.dialogue;
}

/** One template per lesson shape, in the picker's family order — the short row
 *  of examples on the new-activity wizard's first step (2026-11-12). Derived,
 *  so a template added to a family can never leave the row stale. */
export function featuredTemplates(): ActivityTemplate[] {
  return FAMILY_ORDER.flatMap((id) => {
    const first = ACTIVITY_TEMPLATES.find((tpl) => templateFamily(tpl).id === id);
    return first ? [first] : [];
  });
}

// The features each template demonstrates, in workspace order. Rendered as
// at-a-glance pills so a teacher can pick a starting point by the tools it
// shows — together the templates cover the whole element palette.
export function templateFeatures(t: ActivityTemplate): { key: FeatureKey; icon: LucideIcon }[] {
  const f: { key: FeatureKey; icon: LucideIcon }[] = [];
  if (t.artefactId) f.push({ key: "sim", icon: FlaskConical });
  if (t.checklist.length) f.push({ key: "checklist", icon: ListChecks });
  if (t.table) f.push({ key: "table", icon: Table2 });
  if (t.chart) f.push({ key: "chart", icon: LineChart });
  if (t.calculator) f.push({ key: "calculator", icon: Calculator });
  if (t.note) f.push({ key: "note", icon: StickyNote });
  if (t.writing?.length) f.push({ key: "writing", icon: PenLine });
  if (t.solution) f.push({ key: "solution", icon: PenLine });
  if (t.document) f.push({ key: "document", icon: FileUp });
  if (t.conceptMap) f.push({ key: "conceptMap", icon: Network });
  return f;
}

/**
 * TemplatePicker — quick-start templates for the activity builder. Picking one
 * pre-fills the form (prompt + checklist + workbench elements); the teacher then
 * edits everything before publishing. So the builder is never a blank page.
 *
 * Fourteen templates is too many for a grid, so they sit in a horizontal
 * scroll-snap strip filtered by lesson shape (sim / lab / writing / dialogue).
 * There is no separate mini preview: the picker renders inside the builder's
 * config column, so the live "what students see" preview is beside it and
 * re-renders with each click — that IS the preview.
 */
export function TemplatePicker({ onPick, onStartBlank, appliedId = null }: TemplatePickerProps) {
  const t = useT("TemplatePicker");
  const [family, setFamily] = useState<FamilyId | null>(null);
  const [applied, setApplied] = useState<string | null>(appliedId);
  const stripRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });

  const visible = family ? ACTIVITY_TEMPLATES.filter((tpl) => templateFamily(tpl).id === family) : ACTIVITY_TEMPLATES;

  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    // Snap parks the first card at the strip's inner padding, not at 0, so
    // the "at the start" test needs a few px of slack.
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ atStart: el.scrollLeft <= 4, atEnd: el.scrollLeft >= max - 4 });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, family]);

  function scrollBy(direction: -1 | 1) {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  }

  function pick(tpl: ActivityTemplate) {
    setApplied(tpl.id);
    onPick(tpl);
  }

  function startBlank() {
    setApplied(BLANK_ID);
    onStartBlank?.();
  }

  const counts = ACTIVITY_TEMPLATES.reduce<Record<string, number>>((acc, tpl) => {
    const id = templateFamily(tpl).id;
    acc[id] = (acc[id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> {t("heading")}
        </span>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("filter")}>
          <FilterChip active={family === null} onClick={() => setFamily(null)}>
            <LayoutGrid className="h-3 w-3" aria-hidden="true" />
            {t("chipCount", { label: t("all"), count: ACTIVITY_TEMPLATES.length })}
          </FilterChip>
          {FAMILY_ORDER.map((id) => {
            const fam = FAMILIES[id];
            const Icon = fam.icon;
            return (
              <FilterChip key={id} active={family === id} onClick={() => setFamily(id)}>
                <Icon className="h-3 w-3" aria-hidden="true" />
                {t("chipCount", { label: t(`family_${fam.id}`), count: counts[id] ?? 0 })}
              </FilterChip>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-slate-500">{t("hint")}</p>

      <div className="relative">
        <div
          ref={stripRef}
          onScroll={measure}
          role="list"
          aria-label={t("strip")}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-0.5 pb-2 pt-0.5 [scrollbar-width:thin]"
        >
          {onStartBlank ? (
            <BlankCard applied={applied === BLANK_ID} onPick={startBlank} />
          ) : null}
          {visible.map((tpl) => (
            <TemplateCard key={tpl.id} template={tpl} applied={applied === tpl.id} onPick={() => pick(tpl)} />
          ))}
        </div>
        <EdgeButton side="left" hidden={edges.atStart} label={t("prev")} onClick={() => scrollBy(-1)} />
        <EdgeButton side="right" hidden={edges.atEnd} label={t("next")} onClick={() => scrollBy(1)} />
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/5 text-foreground"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function TemplateCard({
  template: tpl,
  applied,
  onPick,
}: {
  template: ActivityTemplate;
  applied: boolean;
  onPick: () => void;
}) {
  const t = useT("TemplatePicker");
  const fam = templateFamily(tpl);
  const FamIcon = fam.icon;
  const features = templateFeatures(tpl);
  return (
    <div role="listitem" className="snap-start">
      <button
        type="button"
        onClick={onPick}
        aria-pressed={applied}
        className={cn(
          "flex h-full w-60 flex-col items-start gap-2 rounded-lg border bg-white px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          applied
            ? "border-primary bg-primary/5 ring-1 ring-primary"
            : "border-slate-200 hover:border-primary/40 hover:bg-primary/5",
        )}
      >
        <span className="flex w-full items-center gap-2">
          {tpl.artefactId ? (
            <SimThumbnail
              id={tpl.artefactId}
              displayName={tpl.name}
              thumbnail={simScreenshotUrl(tpl.artefactId)}
              className="h-9 w-12"
            />
          ) : (
            <span
              className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", fam.tile)}
              aria-hidden="true"
            >
              <FamIcon className="h-4 w-4" />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t(`family_${fam.id}`)}</span>
            <span lang={tpl.language} className="line-clamp-2 text-sm font-medium leading-snug text-slate-800">
              {tpl.name}
            </span>
          </span>
          {applied ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">
              <Check className="h-3 w-3" aria-hidden="true" /> {t("applied")}
            </span>
          ) : null}
        </span>
        <span lang={tpl.language} className="line-clamp-2 text-xs text-slate-500">
          {tpl.summary}
        </span>
        <span className="mt-auto flex flex-wrap gap-1">
          <TemplateLanguageBadge language={tpl.language} />
          {features.map((feat) => {
            const Icon = feat.icon;
            return (
              <span
                key={feat.key}
                className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
              >
                <Icon className="h-3 w-3" aria-hidden="true" />
                {t(`feature_${feat.key}`)}
              </span>
            );
          })}
        </span>
      </button>
    </div>
  );
}

/** The template's own language — an endonym, never translated, like the
 *  students'-language picker. Templates are authored teaching material and are
 *  NOT translated with the teacher's DA | EN switch (22 of 23 are Danish), so
 *  the badge is what tells an English-reading teacher why a card is Danish. */
const TEMPLATE_LANGUAGE_NAME: Record<ActivityTemplate["language"], string> = {
  da: "Dansk",
  en: "English",
};

function TemplateLanguageBadge({ language }: { language: ActivityTemplate["language"] }) {
  const t = useT("TemplatePicker");
  return (
    <span
      title={t("languageLabel")}
      className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
    >
      <Languages className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{t("languageLabel")}: </span>
      <span lang={language} translate="no">
        {TEMPLATE_LANGUAGE_NAME[language]}
      </span>
    </span>
  );
}

function BlankCard({ applied, onPick }: { applied: boolean; onPick: () => void }) {
  const t = useT("TemplatePicker");
  return (
    <div role="listitem" className="snap-start">
      <button
        type="button"
        onClick={onPick}
        aria-pressed={applied}
        className={cn(
          "flex h-full w-60 flex-col items-start gap-2 rounded-lg border border-dashed px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          applied
            ? "border-primary bg-primary/5 ring-1 ring-primary"
            : "border-slate-300 bg-slate-50 hover:border-primary/40 hover:bg-primary/5",
        )}
      >
        <span className="flex w-full items-center gap-2">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-slate-500 ring-1 ring-slate-200"
            aria-hidden="true"
          >
            <FilePlus2 className="h-4 w-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("blankFamily")}</span>
            <span className="truncate text-sm font-medium text-slate-800">{t("blankName")}</span>
          </span>
          {applied ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">
              <Check className="h-3 w-3" aria-hidden="true" /> {t("applied")}
            </span>
          ) : null}
        </span>
        <span className="line-clamp-2 text-xs text-slate-500">{t("blankSummary")}</span>
      </button>
    </div>
  );
}

function EdgeButton({
  side,
  hidden,
  label,
  onClick,
}: {
  side: "left" | "right";
  hidden: boolean;
  label: string;
  onClick: () => void;
}) {
  if (hidden) return null;
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 sm:flex",
        side === "left" ? "-left-3" : "-right-3",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
