"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";

import {
  type PersonaPayload,
  fetchPersonaCatalogue,
  setClassPersona,
} from "@/lib/teacherApi";
import {
  INTERACTION_STYLE_HELP,
  INTERACTION_STYLE_LABEL,
} from "@/lib/personaDisplay";

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
 * Transparency (2026-06-12): each card surfaces what the persona actually does
 * — its teaching style + a one-line bio — so the teacher makes an informed
 * choice. The global default is BADGED on its own card rather than duplicated
 * as a synthetic "Default (Sofie)" entry; selecting it means "inherit the
 * platform default" (stored as null). This is the groundwork for the future
 * "custom persona" where a teacher uploads their own avatar, voice & instructions.
 */
export function ClassPersonaPanel({ classId, initialPersona, onSaved }: Props) {
  const [personas, setPersonas] = useState<PersonaPayload[] | null>(null);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialPersona ?? null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPersonaCatalogue()
      .then((cat) => {
        if (!alive) return;
        setPersonas(cat.personas);
        setDefaultId(cat.defaultId);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "failed to load personas");
      });
    return () => {
      alive = false;
    };
  }, []);

  // A class with no explicit persona (selected === null) inherits the global
  // default — so the default persona's card reads as active in that case.
  function isActive(personaId: string): boolean {
    if (selected === personaId) return true;
    return selected === null && personaId === defaultId;
  }

  async function pick(persona: PersonaPayload) {
    // Picking the default-badged persona stores null ("inherit the platform
    // default") so we don't pin a copy that wouldn't follow a future default change.
    const idToStore = persona.id === defaultId ? null : persona.id;
    setError(null);
    setSavingId(persona.id);
    const prev = selected;
    setSelected(idToStore);
    try {
      await setClassPersona(classId, idToStore);
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {personas.map((p) => (
            <PersonaCard
              key={p.id}
              persona={p}
              isDefault={p.id === defaultId}
              selected={isActive(p.id)}
              saving={savingId === p.id}
              onClick={() => void pick(p)}
            />
          ))}
          <CustomPersonaCard />
        </div>
      )}
    </section>
  );
}

function PersonaCard({
  persona,
  isDefault,
  selected,
  saving,
  onClick,
}: {
  persona: PersonaPayload;
  isDefault: boolean;
  selected: boolean;
  saving: boolean;
  onClick: () => void;
}) {
  const styleLabel = INTERACTION_STYLE_LABEL[persona.interactionStyle];
  const styleHelp = INTERACTION_STYLE_HELP[persona.interactionStyle];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      disabled={saving}
      className={`relative flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
        selected ? "border-indigo-500 bg-indigo-50" : "border-border hover:bg-accent"
      }`}
    >
      <div className="flex items-center gap-3">
        {persona.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={persona.avatar}
            alt=""
            aria-hidden="true"
            className="h-14 w-14 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-700">
            {persona.name[0]?.toUpperCase() ?? "?"}
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium text-foreground">{persona.name}</span>
            {isDefault ? (
              <span className="rounded border border-indigo-300 bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                Default
              </span>
            ) : null}
          </span>
          {persona.title ? (
            <span className="truncate text-xs text-muted-foreground">{persona.title}</span>
          ) : null}
          <span className="mt-0.5 w-fit rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {styleLabel}
          </span>
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{styleHelp}</p>
      {selected && !saving ? <Check className="absolute right-2 top-2 h-4 w-4 text-indigo-600" /> : null}
      {saving ? <Loader2 className="absolute right-2 top-2 h-4 w-4 animate-spin text-indigo-600" /> : null}
    </button>
  );
}

/**
 * Forward-looking signal for the custom-persona feature (v1.2): a teacher will
 * be able to upload their own avatar, voice and teaching instructions. Disabled
 * for now — it sets the expectation the transparency above is building toward.
 */
function CustomPersonaCard() {
  return (
    <div
      role="note"
      aria-label="Custom persona — coming soon"
      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-3 text-center opacity-70"
    >
      <Sparkles className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <span className="text-sm font-medium text-foreground">Custom persona</span>
      <span className="text-xs text-muted-foreground">
        Coming soon — upload your own avatar, voice &amp; teaching instructions.
      </span>
    </div>
  );
}
