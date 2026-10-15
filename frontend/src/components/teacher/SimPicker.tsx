"use client";

import { FlaskConical, Search, TabletSmartphone, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { listArtefacts, type ArtefactSummary } from "@/lib/teacherApi";
import { SimThumbnail } from "@/components/teacher/SimThumbnail";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

// Past this many sims a teacher is scanning a library rather than choosing
// between a few, so search and a level filter appear.
const FILTER_FROM = 6;

function matches(a: ArtefactSummary, query: string, level: string): boolean {
  if (level && !a.levels.includes(level as ArtefactSummary["levels"][number])) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [a.displayName, a.description, ...a.topics].some((s) => s.toLowerCase().includes(q));
}

interface SimPickerProps {
  /** Selected artefact id, or null for no simulation. */
  value: string | null;
  onChange: (artefactId: string | null) => void;
}

/**
 * SimPicker — "Add a simulation" for the activity builder (1.1.41 M3). Browses
 * the vetted artefact catalogue (`GET /api/artefacts`) and sets `artefactId`.
 * Picking a sim is all the teacher does — the sim's tutoring (`tutorBlock`)
 * comes from the catalogue; the teacher's per-activity guidance stays the lesson
 * goal. The same sim can power many activities.
 */
export function SimPicker({ value, onChange }: SimPickerProps) {
  const t = useT("SimPicker");
  const [catalogue, setCatalogue] = useState<ArtefactSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");

  useEffect(() => {
    let alive = true;
    listArtefacts()
      .then((a) => alive && setCatalogue(a))
      .catch(() => alive && setCatalogue([]));
    return () => {
      alive = false;
    };
  }, []);

  const selected = catalogue?.find((a) => a.id === value) ?? null;
  const levels = useMemo(
    () => [...new Set((catalogue ?? []).flatMap((a) => a.levels))].sort(),
    [catalogue],
  );
  const shown = useMemo(
    () => (catalogue ?? []).filter((a) => matches(a, query, level)),
    [catalogue, query, level],
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <FlaskConical className="h-4 w-4 text-slate-500" /> {t("title")}
      </span>

      {value ? (
        <div className="flex flex-col gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2.5 text-sm">
            <SimThumbnail
              id={selected?.id ?? value}
              displayName={selected?.displayName ?? value}
              thumbnail={selected?.thumbnail}
            />
            <span className="min-w-0">
              <span className="block truncate font-medium text-slate-800">
                {selected?.displayName ?? value}
              </span>
              {selected?.description ? (
                <span className="block truncate text-xs text-slate-500">{selected.description}</span>
              ) : null}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("remove")}
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <X className="h-4 w-4" />
          </button>
          </div>
          {/* What students will see: the top of the sim, as the browser check caught it. */}
          <SimThumbnail
            id={selected?.id ?? value}
            displayName={selected?.displayName ?? value}
            thumbnail={selected?.thumbnail}
            className="h-48 w-full"
            fallback="none"
          />
        </div>
      ) : catalogue === null ? (
        <p className="text-xs text-slate-400">{t("loading")}</p>
      ) : catalogue.length === 0 ? (
        <p className="rounded border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
          {t("none")}
        </p>
      ) : (
        <>
          {catalogue.length > FILTER_FROM ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-0 flex-1 basis-48">
                <span className="sr-only">{t("search")}</span>
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="w-full rounded-md border border-slate-200 py-1.5 pl-7 pr-2 text-base sm:text-sm"
                />
              </label>
              {levels.length > 1 ? (
                <div role="group" aria-label={t("levelFilter")} className="flex gap-1">
                  {["", ...levels].map((l) => (
                    <button
                      key={l || "all"}
                      type="button"
                      aria-pressed={level === l}
                      onClick={() => setLevel(l)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-medium",
                        level === l
                          ? "border-indigo-400 bg-indigo-50 text-indigo-800"
                          : "border-slate-200 text-slate-600 hover:border-indigo-300",
                      )}
                    >
                      {l ? t("level", { levels: l }) : t("allLevels")}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {shown.length === 0 ? (
            <p className="rounded border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
              {t("noMatch")}{" "}
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setLevel("");
                }}
                className="font-medium text-indigo-700 underline-offset-2 hover:underline"
              >
                {t("clear")}
              </button>
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onChange(a.id)}
                  data-testid={`sim-picker-${a.id}`}
                  className="flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                >
                  {/* The screenshot leads: a teacher recognises a sim by its picture. */}
                  <SimThumbnail
                    id={a.id}
                    displayName={a.displayName}
                    thumbnail={a.thumbnail}
                    className="aspect-[16/9] h-auto w-full rounded-none border-0 border-b border-slate-200"
                  />
                  <span className="flex flex-1 flex-col gap-1 px-3 py-2">
                    <span className="text-sm font-medium leading-snug text-slate-800">{a.displayName}</span>
                    {a.description ? (
                      <span className="line-clamp-2 text-xs text-slate-500">{a.description}</span>
                    ) : null}
                    <span className="mt-auto flex flex-wrap gap-1 pt-1">
                      {a.levels.length > 0 ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                          {t("level", { levels: a.levels.join("/") })}
                        </span>
                      ) : null}
                      {a.source === "teacher" ? (
                        <span
                          data-testid={`sim-picker-teacher-${a.id}`}
                          className="inline-flex w-fit rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-700"
                        >
                          {a.scope === "library" ? t("teacherLibrary") : t("teacherMine")}
                        </span>
                      ) : null}
                      {/* MOBILE-1 — device requirement at the point of CHOOSING, not
                          at the point a class of thirty phones fails to open it. */}
                      {a.minViewportPx ? (
                        <span className="inline-flex w-fit items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                          <TabletSmartphone className="h-3 w-3" aria-hidden="true" />
                          {a.minViewportPx >= 720 ? t("tablet") : t("cramped")}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <p className="text-xs text-slate-400">
        {t("help")}
      </p>
    </div>
  );
}
