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
import { BookOpen, Layers, Search, Tag } from "lucide-react";

import { ActiveChip, ALL, FacetRow } from "@/components/teacher/ui/FacetRow";
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
  /** Distinguishes the two instances on the page (library vs catalogue). */
  idPrefix?: string;
}) {
  const set = (patch: Partial<ActivityFilters>) => onChange({ ...filters, ...patch });
  const toggleTag = (tag: string) =>
    set({ tags: filters.tags.includes(tag) ? filters.tags.filter((t) => t !== tag) : [...filters.tags, tag] });

  const levelLabel = (v: string) => (v === UNLEVELLED ? "No level" : v);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          id={`${idPrefix}-search`}
          type="search"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search activities…"
          aria-label="Search activities"
          className="w-full rounded border border-border bg-background py-1.5 pl-8 pr-2 text-sm"
        />
      </div>

      {/* Subject options come from the server, never a hardcoded list — the
          frontend used to keep its own copy of SUBJECTS and it drifted. */}
      <FacetRow
        label="Subject"
        icon={<BookOpen className="h-3 w-3" aria-hidden="true" />}
        options={facets?.subjects ?? []}
        selected={filters.subject}
        onSelect={(v) => set({ subject: v === ALL ? "" : v })}
      />
      <FacetRow
        label="Level"
        icon={<Layers className="h-3 w-3" aria-hidden="true" />}
        options={facets?.levels ?? []}
        selected={filters.level}
        onSelect={(v) => set({ level: v === ALL ? "" : (v as LevelFilter) })}
      />
      <FacetRow
        label="Tags"
        icon={<Tag className="h-3 w-3" aria-hidden="true" />}
        options={facets?.tags ?? []}
        selected={filters.tags}
        onSelect={toggleTag}
        multi
      />

      {hasActiveFilters(filters) ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-muted-foreground">Filtering by</span>
          {filters.q.trim() ? <ActiveChip label={`"${filters.q.trim()}"`} onRemove={() => set({ q: "" })} /> : null}
          {filters.subject ? <ActiveChip label={filters.subject} onRemove={() => set({ subject: "" })} /> : null}
          {filters.level ? <ActiveChip label={levelLabel(filters.level)} onRemove={() => set({ level: "" })} /> : null}
          {filters.tags.map((t) => (
            <ActiveChip key={t} label={t} onRemove={() => toggleTag(t)} />
          ))}
          <button
            type="button"
            onClick={() => onChange(EMPTY_ACTIVITY_FILTERS)}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}
