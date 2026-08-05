"use client";

/**
 * The chip idiom shared by every faceted library surface (1.1.60, extracted 1.1.61).
 *
 * Lifted verbatim out of `MaterialsSection` when the activity library became the
 * second thing that needed it. The 1.1.60 commit already described this as "one
 * chip idiom for all four facets"; keeping it private to a 1099-line component
 * meant the next surface would have got a lookalike instead, and two lookalikes
 * drift — different zero-count behaviour, different reset affordance, different
 * aria labels — until they are visibly two different controls doing one job.
 *
 * Behaviour is unchanged from the Materials original, and the existing
 * MaterialsSection tests are the regression net for that.
 */

import { X } from "lucide-react";
import React from "react";

import type { FacetOption } from "@/lib/curriculumApi";

/** The "no filter" value. Empty string, so it is falsy at every call site. */
export const ALL = "";

/**
 * One labelled row of facet chips.
 *
 * Chips show a COUNT narrowed by the other active facets, and options are never
 * hidden when that count hits zero — a rail you navigate by muscle memory must
 * not reshuffle as you type. A zero-count chip is dimmed but still clickable
 * (clicking it is how you move the filter to it).
 */
export function FacetRow({
  label,
  icon,
  options,
  selected,
  onSelect,
  multi = false,
  allChip = true,
  renderAction,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  options: FacetOption[];
  /** A single value, or the selected set when `multi`. */
  selected: string | string[];
  onSelect: (value: string) => void;
  /** Tags are AND-combinable; the rest are single-select. */
  multi?: boolean;
  /** Single-select rows get an explicit "All" reset chip. */
  allChip?: boolean;
  /** Optional per-chip trailing control (the folder delete button). */
  renderAction?: (option: FacetOption) => React.ReactNode;
  /** Optional trailing control for the row (the folder "New" button). */
  children?: React.ReactNode;
}) {
  const isOn = (value: string) => (Array.isArray(selected) ? selected.includes(value) : selected === value);
  const noneSelected = Array.isArray(selected) ? selected.length === 0 : selected === ALL;

  if (options.length === 0 && !children) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={`Filter by ${label.toLowerCase()}`}>
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      {allChip && !multi ? (
        <button
          type="button"
          onClick={() => onSelect(ALL)}
          aria-pressed={noneSelected}
          className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
            noneSelected
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          All
        </button>
      ) : null}
      {options.map((o) => {
        const on = isOn(o.value);
        const empty = o.count === 0 && !on;
        const chip = (
          <button
            type="button"
            onClick={() => onSelect(o.value)}
            aria-pressed={on}
            className={`rounded-full px-2 py-0.5 text-xs transition-colors ${renderAction ? "" : "border"} ${
              on
                ? "border-primary bg-primary/10 text-foreground"
                : `border-border hover:bg-muted ${empty ? "text-muted-foreground/50" : "text-muted-foreground"}`
            }`}
          >
            {o.label} <span className="tabular-nums opacity-60">({o.count})</span>
          </button>
        );
        if (!renderAction) return <span key={o.value}>{chip}</span>;
        return (
          <span
            key={o.value}
            className={`inline-flex items-center gap-0.5 rounded-full border pr-1 text-xs transition-colors ${
              on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {chip}
            {renderAction(o)}
          </span>
        );
      })}
      {children}
    </div>
  );
}

/** A removable active-filter chip (1.1.58 M4). */
export function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs">
      {label}
      <button type="button" aria-label={`Remove filter ${label}`} onClick={onRemove} className="hover:text-foreground">
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * A chip for a facet the activity INHERITED from a document it cites (1.1.61).
 *
 * Deliberately not the same control as an own-facet chip. An inherited facet is
 * a fact about the cited document, not a choice the teacher made here, so it is
 * dimmed, carries a paperclip, and has no remove affordance — the way to change
 * it is to re-file the document or cite a different one. Merging the two
 * silently would make "why is this tagged Mekanik?" unanswerable from the row,
 * and would invite a teacher to try removing something this screen cannot remove.
 */
export function InheritedChip({ label, title }: { label: string; title?: string }) {
  return (
    <span
      title={title ?? "Inherited from a cited document — change it by re-filing that document"}
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/70 px-2 py-0.5 text-xs text-muted-foreground/80"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
      {label}
    </span>
  );
}
