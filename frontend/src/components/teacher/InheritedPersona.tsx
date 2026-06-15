"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Settings2, UserRound } from "lucide-react";

import {
  type PersonaPayload,
  fetchPersonaCatalogue,
  getClass,
} from "@/lib/teacherApi";
import { INTERACTION_STYLE_LABEL } from "@/lib/personaDisplay";

/**
 * Read-only display of the persona an activity inherits (1.1.32, Q4 =
 * class-default-only).
 *
 * Persona is set in ONE place — class settings → Tutor personas — and every
 * activity in the class inherits it (avatar + name + voice + teaching style).
 * The activity forms show it read-only so a teacher knows which tutor this
 * activity uses and where to change it, instead of a duplicate per-activity
 * picker (the old co-equal grid was problem 4 of teacher-ux-refinement.md).
 *
 * Resolves the same chain the student-facing `/active` endpoint resolves:
 * class default > global default. A per-activity override returns in Phase B.
 */
export function InheritedPersona({ classId }: { classId: string }) {
  const [persona, setPersona] = useState<PersonaPayload | null>(null);
  const [state, setState] = useState<"loading" | "resolved" | "default">(
    "loading",
  );

  useEffect(() => {
    if (!classId) {
      setState("default");
      return;
    }
    let alive = true;
    setState("loading");
    Promise.all([fetchPersonaCatalogue(), getClass(classId)])
      .then(([cat, cls]) => {
        if (!alive) return;
        const id = cls.persona ?? cat.defaultId;
        const resolved = id
          ? (cat.personas.find((p) => p.id === id) ?? null)
          : null;
        setPersona(resolved);
        setState(resolved ? "resolved" : "default");
      })
      .catch(() => {
        // Persona display is non-critical — degrade to the default note rather
        // than blocking the form on a persona/class fetch failure.
        if (alive) setState("default");
      });
    return () => {
      alive = false;
    };
  }, [classId]);

  const settingsLink = classId
    ? `/teacher/classes/${encodeURIComponent(classId)}`
    : "/teacher/classes";

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-700">Tutor persona</span>
      <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        {state === "resolved" && persona ? (
          <>
            <Avatar name={persona.name} avatar={persona.avatar} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">
                {persona.name}
              </p>
              <p className="truncate text-xs text-slate-500">
                {persona.title ? `${persona.title} · ` : ""}
                {INTERACTION_STYLE_LABEL[persona.interactionStyle]} style
                {persona.voice?.ttsVoice ? ` · ${persona.voice.ttsVoice} voice` : ""}
              </p>
            </div>
          </>
        ) : (
          <>
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500"
            >
              <UserRound className="h-4 w-4" />
            </span>
            <p className="text-sm text-slate-600">
              {state === "loading"
                ? "Resolving the class persona…"
                : "Default tutor (no class persona set)"}
            </p>
          </>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
        <Settings2 className="h-3 w-3 shrink-0" aria-hidden />
        Set for the whole class — avatar, voice &amp; teaching style.
        <Link
          href={settingsLink}
          className="font-medium text-indigo-600 hover:underline"
        >
          Change in class settings
        </Link>
      </p>
    </div>
  );
}

function Avatar({ name, avatar }: { name: string; avatar?: string }) {
  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar}
        alt=""
        aria-hidden
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700"
    >
      {name[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
