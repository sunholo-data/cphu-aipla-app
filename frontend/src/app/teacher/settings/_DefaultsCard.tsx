"use client";

// Defaults card (1.1.58 / SETTINGS-1) — the teacher's account-level defaults.
// These SEED the contextual controls (builder language on /new, class persona
// at create) and never fight them: the per-activity / per-class controls stay
// authoritative once something exists. Beta toggles list any feature flag
// currently in 'beta' (runtime opt-in) — none on dev, where flags are '1'.

import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import { useTeacherPrefs } from "@/hooks/useTeacherPrefs";
import { fetchPersonaCatalogue, type PersonaPayload } from "@/lib/teacherApi";

/** Flags currently in runtime-opt-in state ('beta'). Build-time values bake
 *  into the bundle, so this list is computed once at module load. Empty on
 *  dev (flags are '1' = on for everyone) — the card shows a designed empty
 *  state rather than hiding, so teachers learn where betas will appear. */
export const BETA_FLAGS: { key: string; label: string; buildValue: string | undefined }[] = [
  {
    key: "authoringCopilot",
    label: "Aktivitets-medbygger (AI co-pilot i aktivitetsbyggeren)",
    buildValue: process.env.NEXT_PUBLIC_AUTHORING_COPILOT,
  },
  {
    key: "conceptMap",
    label: "Begrebskort (levende begrebskort med tjekspørgsmål)",
    buildValue: process.env.NEXT_PUBLIC_CONCEPT_MAP,
  },
].filter((f) => f.buildValue === "beta");

export function DefaultsCard() {
  const { prefs, loaded, save } = useTeacherPrefs();
  const [personas, setPersonas] = useState<PersonaPayload[]>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPersonaCatalogue()
      .then((cat) => {
        if (alive) setPersonas(cat.personas);
      })
      .catch(() => {
        /* persona select degrades to unset-only */
      });
    return () => {
      alive = false;
    };
  }, []);

  const put = async (updates: Parameters<typeof save>[0], message: string) => {
    setNote(null);
    setNote((await save(updates)) ? message : "Save failed — try again.");
  };

  return (
    <section data-testid="defaults-card" className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <SlidersHorizontal className="h-4 w-4 text-slate-500" /> Defaults
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Account-wide starting points for new activities and classes. They only seed the form —
          you can always change each activity or class individually.
        </p>
      </div>

      {!loaded ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span className="w-44 shrink-0 text-xs font-medium text-slate-600">New-activity language</span>
            <select
              aria-label="Default activity language"
              value={prefs.defaultLanguage ?? ""}
              onChange={(e) =>
                void put(
                  { defaultLanguage: (e.target.value || null) as "da" | "en" | null },
                  "Language default saved.",
                )
              }
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">No default (Dansk)</option>
              <option value="da">Dansk</option>
              <option value="en">English</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span className="w-44 shrink-0 text-xs font-medium text-slate-600">New-class persona</span>
            <select
              aria-label="Default class persona"
              value={prefs.defaultPersonaId ?? ""}
              onChange={(e) => void put({ defaultPersonaId: e.target.value || null }, "Persona default saved.")}
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">No default</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Beta features</span>
            {BETA_FLAGS.length === 0 ? (
              <p className="text-xs text-slate-400" data-testid="beta-empty">
                No beta features are open for opt-in right now — new ones will appear here first.
              </p>
            ) : (
              BETA_FLAGS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={!!prefs.features?.[f.key]}
                    onChange={(e) =>
                      void put(
                        { features: { ...(prefs.features ?? {}), [f.key]: e.target.checked } },
                        e.target.checked ? "Beta enabled." : "Beta disabled.",
                      )
                    }
                  />
                  {f.label}
                </label>
              ))
            )}
          </div>

          {note ? <p className="text-xs text-slate-500">{note}</p> : null}
        </>
      )}
    </section>
  );
}
