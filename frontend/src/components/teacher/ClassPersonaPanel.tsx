"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import {
  type PersonaPayload,
  fetchPersonaList,
  setClassPersona,
} from "@/lib/teacherApi";

interface Props {
  classId: string;
  initialPersona?: string | null;
  onSaved?: () => void;
}

/**
 * Per-class default persona picker (CLASS-PERSONA). The ONE identity choice for
 * a class — picking a persona sets the avatar + name + voice + teaching style
 * for every activity + chat in the class (an activity can still override).
 *
 * Unlike the activity-builder picker, this surfaces an explicit error if the
 * persona catalogue fails to load (rather than silently rendering nothing),
 * so a misconfigured `/api/personas` is visible instead of looking "empty".
 */
export function ClassPersonaPanel({ classId, initialPersona, onSaved }: Props) {
  const [personas, setPersonas] = useState<PersonaPayload[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialPersona ?? null);
  const [savingId, setSavingId] = useState<string | "default" | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPersonaList()
      .then((ps) => {
        if (alive) setPersonas(ps);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "failed to load personas");
      });
    return () => {
      alive = false;
    };
  }, []);

  async function pick(id: string | null) {
    setError(null);
    setSavingId(id ?? "default");
    const prev = selected;
    setSelected(id);
    try {
      await setClassPersona(classId, id);
      onSaved?.();
    } catch (e) {
      setSelected(prev);
      setError(e instanceof Error ? e.message : "failed to save");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section aria-labelledby="persona-label" className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="persona-label" className="text-lg font-semibold">
          Tutor persona
        </h2>
        <span className="text-xs text-muted-foreground">
          One choice sets the avatar, name, voice &amp; teaching style for this class.
        </span>
      </header>

      {error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          Couldn&rsquo;t load personas: {error}
        </p>
      ) : personas === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading personas…
        </p>
      ) : personas.length === 0 ? (
        <p className="text-sm text-muted-foreground">No personas available.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <PersonaCard
            name="Default (Sofie)"
            title="Allround — the global default"
            selected={selected === null}
            saving={savingId === "default"}
            onClick={() => void pick(null)}
          />
          {personas.map((p) => (
            <PersonaCard
              key={p.id}
              name={p.name}
              title={p.title ?? undefined}
              avatar={p.avatar}
              selected={selected === p.id}
              saving={savingId === p.id}
              onClick={() => void pick(p.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PersonaCard({
  name,
  title,
  avatar,
  selected,
  saving,
  onClick,
}: {
  name: string;
  title?: string;
  avatar?: string;
  selected: boolean;
  saving: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      disabled={saving}
      className={`relative flex w-44 items-center gap-2 rounded-md border px-2 py-2 text-left ${
        selected ? "border-indigo-500 bg-indigo-50" : "border-border hover:bg-accent"
      }`}
    >
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" aria-hidden="true" className="h-9 w-9 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
          {name[0]?.toUpperCase() ?? "?"}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        {title ? <span className="truncate text-xs text-muted-foreground">{title}</span> : null}
      </span>
      {selected && !saving ? <Check className="absolute right-1.5 top-1.5 h-4 w-4 text-indigo-600" /> : null}
      {saving ? <Loader2 className="absolute right-1.5 top-1.5 h-4 w-4 animate-spin text-indigo-600" /> : null}
    </button>
  );
}
