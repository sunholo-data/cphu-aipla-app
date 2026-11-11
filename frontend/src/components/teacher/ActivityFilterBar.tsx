"use client";

/**
 * Search + facet chips for the activity library and the shared catalogue (1.1.61).
 *
 * The activity-side twin of the Materials browse strip, built on the same
 * `FacetRow` so the two libraries are one control in two places rather than two
 * controls that look similar. Filtering itself is server-side; this only holds
 * the selection and renders the rail.
 */

import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, Layers, Search, SlidersHorizontal, Tag } from "lucide-react";

import { ActiveChip, ALL, FacetRow } from "@/components/teacher/ui/FacetRow";
import { useT } from "@/i18n";
import type { CurriculumFacets } from "@/lib/curriculumApi";
import { UNLEVELLED, type LevelFilter } from "@/lib/curriculumApi";
import type { ActivityFilterParams } from "@/lib/teacherApi";

export interface ActivityFilters {
  q: string;
  level: LevelFilter | "";
  subject: string;
  tags: string[];
}

export const EMPTY_ACTIVITY_FILTERS: ActivityFilters = { q: "", level: "", subject: "", tags: [] };

export function hasActiveFilters(f: ActivityFilters): boolean {
  return Boolean(f.q.trim() || f.level || f.subject || f.tags.length);
}

/** How many facet filters are set (the search box is not one — it is visible). */
export function facetFilterCount(f: ActivityFilters): number {
  return (f.subject ? 1 : 0) + (f.level ? 1 : 0) + f.tags.length;
}

/** Filters → the API's param shape. Empty values are omitted, not sent blank. */
export function toFilterParams(f: ActivityFilters): ActivityFilterParams {
  return {
    q: f.q.trim() || undefined,
    level: f.level || undefined,
    subject: f.subject || undefined,
    tags: f.tags.length ? f.tags : undefined,
  };
}

/**
 * Debounce the free-text box only.
 *
 * Chip clicks are deliberate and discrete, so they fire immediately; typing is
 * not, and the Materials browse shipped without this and had to be fixed after
 * it fired a request per keystroke (1.1.58). Doing it here means the activity
 * library never has that version.
 */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function ActivityFilterBar({
  facets,
  filters,
  onChange,
  idPrefix = "activity",
}: {
  facets: CurriculumFacets | null;
  filters: ActivityFilters;
  onChange: (next: ActivityFilters) => void;
  /** Distinguishes instances (ids of the search box and the facet panel). */
  idPrefix?: string;
}) {
  const t = useT("ActivityFilterBar");
  // UI sweep 2026-11-11 — the three facet rows (10–15 chips) sit behind one
  // Filter button; the active-filter chips below stay visible either way, so a
  // narrowed list always says why.
  const [open, setOpen] = useState(false);
  const facetCount = facetFilterCount(filters);
  const panelId = `${idPrefix}-facets`;
  const set = (patch: Partial<ActivityFilters>) => onChange({ ...filters, ...patch });
  const toggleTag = (tag: string) =>
    set({ tags: filters.tags.includes(tag) ? filters.tags.filter((x) => x !== tag) : [...filters.tags, tag] });

  const levelLabel = (v: string) => (v === UNLEVELLED ? t("noLevel") : v);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id={`${idPrefix}-search`}
            type="search"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder={t("searchPlaceholder")}
            aria-label={t("search")}
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {facetCount > 0 ? t("filterCount", { count: facetCount }) : t("filter")}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {open ? (
        <div id={panelId} className="space-y-2 rounded-md border border-border p-2">
          {/* Subject options come from the server, never a hardcoded list — the
              frontend used to keep its own copy of SUBJECTS and it drifted. */}
          <FacetRow
            label={t("subject")}
            icon={<BookOpen className="h-3 w-3" aria-hidden="true" />}
            options={facets?.subjects ?? []}
            selected={filters.subject}
            onSelect={(v) => set({ subject: v === ALL ? "" : v })}
          />
          <FacetRow
            label={t("level")}
            icon={<Layers className="h-3 w-3" aria-hidden="true" />}
            options={facets?.levels ?? []}
            selected={filters.level}
            onSelect={(v) => set({ level: v === ALL ? "" : (v as LevelFilter) })}
          />
          <FacetRow
            label={t("tags")}
            icon={<Tag className="h-3 w-3" aria-hidden="true" />}
            options={facets?.tags ?? []}
            selected={filters.tags}
            onSelect={toggleTag}
            multi
          />
        </div>
      ) : null}

      {hasActiveFilters(filters) ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-muted-foreground">{t("filteringBy")}</span>
          {filters.q.trim() ? <ActiveChip label={t("query", { q: filters.q.trim() })} onRemove={() => set({ q: "" })} /> : null}
          {filters.subject ? <ActiveChip label={filters.subject} onRemove={() => set({ subject: "" })} /> : null}
          {filters.level ? <ActiveChip label={levelLabel(filters.level)} onRemove={() => set({ level: "" })} /> : null}
          {filters.tags.map((tag) => (
            <ActiveChip key={tag} label={tag} onRemove={() => toggleTag(tag)} />
          ))}
          <button
            type="button"
            onClick={() => onChange(EMPTY_ACTIVITY_FILTERS)}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            {t("clearAll")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
