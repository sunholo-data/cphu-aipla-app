"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Settings2, UserRound } from "lucide-react";

import {
  type PersonaPayload,
  fetchPersonaCatalogue,
  fetchTutorCatalogue,
  getClass,
} from "@/lib/teacherApi";
import { INTERACTION_STYLE_LABEL } from "@/lib/tutorDisplay";
import { TutorFace } from "@/components/teacher/research/TutorFace";

/**
 * Read-only display of the tutor an activity inherits (1.1.32, Q4 =
 * class-default-only).
 *
 * The tutor is chosen in ONE place — class settings → Tutor — and every
 * activity in the class inherits it (name + picture + voice + tone + teaching
 * approach). The activity forms show it read-only so a teacher knows which
 * tutor this activity uses and where to change it, instead of a duplicate
 * per-activity picker (the old co-equal grid was problem 4 of
 * teacher-ux-refinement.md).
 *
 * Resolves the same chain the student-facing `/active` endpoint resolves:
 * class default > global default. A per-activity override returns in Phase B.
 *
 * ⚠️ Teacher-facing copy says **tutor**, never "persona" (1.1.91) — `persona`
 * is the legacy API field this still reads, and nothing more.
 */
const copy = {
  label: "Tutor",
  teachesWith: "Teaches with:",
  loading: "Finding this class's tutor…",
  unset: "Default tutor — this class hasn't chosen one yet",
  footnote: "Chosen once for the whole class — name, picture, voice, tone and teaching approach.",
  change: "Change in class settings",
};
export function InheritedTutor({ classId }: { classId: string }) {
  const [tutor, setTutor] = useState<PersonaPayload | null>(null);
  // 1.1.91 — when the class has a TUTOR, its teaching approach is part of the
  // identity the activity inherits. Showing only the name here while a
  // framework-bearing tutor was actually teaching would be the same split the
  // bundling exists to close, just moved to the activity form.
  const [approach, setApproach] = useState<string | null>(null);
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
    Promise.all([fetchPersonaCatalogue(), getClass(classId), fetchTutorCatalogue().catch(() => null)])
      .then(([cat, cls, tutorCat]) => {
        if (!alive) return;
        const chosen = cls.tutorId
          ? ([...(tutorCat?.tutors ?? []), ...(tutorCat?.skillBoundTutors ?? [])].find(
              (t) => t.id === cls.tutorId,
            ) ?? null)
          : null;
        setApproach(chosen?.frameworkName ?? null);
        // `cls.persona` is the legacy field a pre-1.1.91 class still carries.
        const id = chosen?.personaId ?? cls.persona ?? cat.defaultId;
        const resolved = id
          ? (cat.personas.find((p) => p.id === id) ?? null)
          : null;
        setTutor(resolved);
        setState(resolved ? "resolved" : "default");
      })
      .catch(() => {
        // The tutor display is non-critical — degrade to the default note
        // rather than blocking the form on a tutor/class fetch failure.
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
      <span className="text-sm font-medium text-slate-700">{copy.label}</span>
      <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        {state === "resolved" && tutor ? (
          <>
            <TutorFace name={tutor.name} avatar={tutor.avatar} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">
                {tutor.name}
              </p>
              {approach ? (
                <p className="truncate text-xs text-slate-500">{copy.teachesWith} {approach}</p>
              ) : null}
              <p className="truncate text-xs text-slate-500">
                {tutor.title ? `${tutor.title} · ` : ""}
                {INTERACTION_STYLE_LABEL[tutor.interactionStyle]} tone
                {tutor.voice?.ttsVoice ? ` · ${tutor.voice.ttsVoice} voice` : ""}
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
              {state === "loading" ? copy.loading : copy.unset}
            </p>
          </>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
        <Settings2 className="h-3 w-3 shrink-0" aria-hidden />
        {copy.footnote}
        <Link
          href={settingsLink}
          className="font-medium text-indigo-600 hover:underline"
        >
          {copy.change}
        </Link>
      </p>
    </div>
  );
}

