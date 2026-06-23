"use client";

import { FlaskConical, X } from "lucide-react";
import { useEffect, useState } from "react";

import { listArtefacts, type ArtefactSummary } from "@/lib/teacherApi";
import { SimThumbnail } from "@/components/teacher/SimThumbnail";

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
  const [catalogue, setCatalogue] = useState<ArtefactSummary[] | null>(null);

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

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <FlaskConical className="h-4 w-4 text-slate-500" /> Simulation (optional)
      </span>

      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2">
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
            aria-label="Remove simulation"
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : catalogue === null ? (
        <p className="text-xs text-slate-400">Loading simulations…</p>
      ) : catalogue.length === 0 ? (
        <p className="rounded border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
          No simulations available in this environment yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {catalogue.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onChange(a.id)}
              className="flex items-start gap-2.5 rounded-md border border-slate-200 px-3 py-2 text-left hover:border-indigo-300 hover:bg-indigo-50"
            >
              <SimThumbnail id={a.id} displayName={a.displayName} thumbnail={a.thumbnail} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium text-slate-800">{a.displayName}</span>
                <span className="text-xs text-slate-500">{a.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400">
        Host a vetted simulation in this activity — your lesson goal, checklist, and notes wrap it. The
        same sim can power many activities with different goals.
      </p>
    </div>
  );
}
