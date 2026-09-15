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

import { SimThumbnail } from "@/components/teacher/SimThumbnail";
import { ACTIVITY_TEMPLATES, type ActivityTemplate } from "@/lib/activityTemplates";
import { cn } from "@/lib/utils";

interface TemplatePickerProps {
  onPick: (template: ActivityTemplate) => void;
  /** Reset the builder to a blank draft — the "start from scratch" card. */
  onStartBlank?: () => void;
}

const copy = {
  heading: "Start from a template",
  hint: "Click one to load it — the preview beside the builder shows what students will see. Everything stays editable.",
  all: "All",
  applied: "Loaded",
  blankName: "Start from scratch",
  blankSummary: "A blank activity — write your own goal and add tools as you go.",
  blankFamily: "Custom",
  prev: "Scroll templates left",
  next: "Scroll templates right",
  strip: "Activity templates",
  filter: "Filter templates by lesson shape",
  families: {
    sim: "Simulation",
    lab: "Measurement lab",
    writing: "Writing & feedback",
    dialogue: "Dialogue",
  },
  features: {
    sim: "Sim",
    checklist: "Checklist",
    table: "Table",
    chart: "Chart",
    calculator: "Calculator",
    note: "Note",
    writing: "Writing",
    solution: "Solution",
    document: "Document",
    conceptMap: "Concept map",
  },
} as const;

// Product names for the sims the templates attach — the catalogue's
// displayName is longer ("Boldkast — projektilbevægelse") and needs a fetch;
// a card tile only wants the short handle.
const SIM_LABELS: Record<string, string> = {
  boldkast: "Boldkast",
  kinebot: "KineBot",
  "led-planck": "LED Planck",
};

type FamilyId = keyof typeof copy.families;

interface Family {
  id: FamilyId;
  label: string;
  icon: LucideIcon;
  tile: string;
}

const FAMILIES: Record<FamilyId, Family> = {
  sim: { id: "sim", label: copy.families.sim, icon: FlaskConical, tile: "bg-emerald-100 text-emerald-700" },
  lab: { id: "lab", label: copy.families.lab, icon: Table2, tile: "bg-sky-100 text-sky-700" },
  writing: { id: "writing", label: copy.families.writing, icon: PenLine, tile: "bg-amber-100 text-amber-700" },
  dialogue: {
    id: "dialogue",
    label: copy.families.dialogue,
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

// The features each template demonstrates, in workspace order. Rendered as
// at-a-glance pills so a teacher can pick a starting point by the tools it
// shows — together the templates cover the whole element palette.
function templateFeatures(t: ActivityTemplate): { label: string; icon: LucideIcon }[] {
  const f: { label: string; icon: LucideIcon }[] = [];
  if (t.artefactId) f.push({ label: copy.features.sim, icon: FlaskConical });
  if (t.checklist.length) f.push({ label: copy.features.checklist, icon: ListChecks });
  if (t.table) f.push({ label: copy.features.table, icon: Table2 });
  if (t.chart) f.push({ label: copy.features.chart, icon: LineChart });
  if (t.calculator) f.push({ label: copy.features.calculator, icon: Calculator });
  if (t.note) f.push({ label: copy.features.note, icon: StickyNote });
  if (t.writing?.length) f.push({ label: copy.features.writing, icon: PenLine });
  if (t.solution) f.push({ label: copy.features.solution, icon: PenLine });
  if (t.document) f.push({ label: copy.features.document, icon: FileUp });
  if (t.conceptMap) f.push({ label: copy.features.conceptMap, icon: Network });
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
export function TemplatePicker({ onPick, onStartBlank }: TemplatePickerProps) {
  const [family, setFamily] = useState<FamilyId | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });

  const visible = family ? ACTIVITY_TEMPLATES.filter((t) => templateFamily(t).id === family) : ACTIVITY_TEMPLATES;

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

  function pick(t: ActivityTemplate) {
    setApplied(t.id);
    onPick(t);
  }

  function startBlank() {
    setApplied(BLANK_ID);
    onStartBlank?.();
  }

  const counts = ACTIVITY_TEMPLATES.reduce<Record<string, number>>((acc, t) => {
    const id = templateFamily(t).id;
    acc[id] = (acc[id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <Sparkles className="h-4 w-4 text-indigo-500" /> {copy.heading}
        </span>
        <div className="flex flex-wrap gap-1" role="group" aria-label={copy.filter}>
          <FilterChip active={family === null} onClick={() => setFamily(null)}>
            {copy.all} · {ACTIVITY_TEMPLATES.length}
          </FilterChip>
          {FAMILY_ORDER.map((id) => {
            const fam = FAMILIES[id];
            const Icon = fam.icon;
            return (
              <FilterChip key={id} active={family === id} onClick={() => setFamily(id)}>
                <Icon className="h-3 w-3" aria-hidden="true" />
                {fam.label} · {counts[id] ?? 0}
              </FilterChip>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-slate-500">{copy.hint}</p>

      <div className="relative">
        <div
          ref={stripRef}
          onScroll={measure}
          role="list"
          aria-label={copy.strip}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-0.5 pb-2 pt-0.5 [scrollbar-width:thin]"
        >
          {onStartBlank ? (
            <BlankCard applied={applied === BLANK_ID} onPick={startBlank} />
          ) : null}
          {visible.map((t) => (
            <TemplateCard key={t.id} template={t} applied={applied === t.id} onPick={() => pick(t)} />
          ))}
        </div>
        <EdgeButton side="left" hidden={edges.atStart} label={copy.prev} onClick={() => scrollBy(-1)} />
        <EdgeButton side="right" hidden={edges.atEnd} label={copy.next} onClick={() => scrollBy(1)} />
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
          ? "border-indigo-300 bg-indigo-50 text-indigo-700"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function TemplateCard({
  template: t,
  applied,
  onPick,
}: {
  template: ActivityTemplate;
  applied: boolean;
  onPick: () => void;
}) {
  const fam = templateFamily(t);
  const FamIcon = fam.icon;
  const features = templateFeatures(t);
  return (
    <div role="listitem" className="snap-start">
      <button
        type="button"
        onClick={onPick}
        aria-pressed={applied}
        className={cn(
          "flex h-full w-60 flex-col items-start gap-2 rounded-lg border bg-white px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
          applied
            ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300"
            : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50",
        )}
      >
        <span className="flex w-full items-center gap-2">
          {t.artefactId ? (
            <SimThumbnail id={t.artefactId} displayName={SIM_LABELS[t.artefactId] ?? t.artefactId} className="h-9 w-9" />
          ) : (
            <span
              className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", fam.tile)}
              aria-hidden="true"
            >
              <FamIcon className="h-4 w-4" />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{fam.label}</span>
            <span className="line-clamp-2 text-sm font-medium leading-snug text-slate-800">{t.name}</span>
          </span>
          {applied ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
              <Check className="h-3 w-3" aria-hidden="true" /> {copy.applied}
            </span>
          ) : null}
        </span>
        <span className="line-clamp-2 text-xs text-slate-500">{t.summary}</span>
        <span className="mt-auto flex flex-wrap gap-1">
          {features.map((feat) => {
            const Icon = feat.icon;
            return (
              <span
                key={feat.label}
                className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
              >
                <Icon className="h-3 w-3" aria-hidden="true" />
                {feat.label}
              </span>
            );
          })}
        </span>
      </button>
    </div>
  );
}

function BlankCard({ applied, onPick }: { applied: boolean; onPick: () => void }) {
  return (
    <div role="listitem" className="snap-start">
      <button
        type="button"
        onClick={onPick}
        aria-pressed={applied}
        className={cn(
          "flex h-full w-60 flex-col items-start gap-2 rounded-lg border border-dashed px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
          applied
            ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300"
            : "border-slate-300 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50",
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
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{copy.blankFamily}</span>
            <span className="truncate text-sm font-medium text-slate-800">{copy.blankName}</span>
          </span>
          {applied ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
              <Check className="h-3 w-3" aria-hidden="true" /> {copy.applied}
            </span>
          ) : null}
        </span>
        <span className="line-clamp-2 text-xs text-slate-500">{copy.blankSummary}</span>
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
