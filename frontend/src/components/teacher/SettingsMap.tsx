"use client";

import { BookOpen, GraduationCap, UserRound } from "lucide-react";

/**
 * "Where settings live" explainer (1.1.32 Phase A, design item 5).
 *
 * The teacher surfaces accreted five overlapping levels
 * (teacher × class × persona × activity × sim). The coherence pass collapses
 * the mental model to three nouns, each owning a clear set of settings. This
 * panel states that model rather than leaving a teacher to infer it — it sits
 * at the top of the activity form and the class-settings surface so the same
 * map is visible wherever settings are edited.
 *
 *   PERSONA  — HOW the tutor sounds + teaches (style + voice)   [class default]
 *   ACTIVITY — WHAT students learn (goal + optional sim + materials)
 *   CLASS    — WHO can run it (roster + group codes)
 *
 * `highlight` lets a surface bolden the noun it edits (e.g. the activity form
 * highlights "Activity") so the panel doubles as a "you are here" marker.
 */
type SettingsNoun = "persona" | "activity" | "class";

const NOUNS: {
  key: SettingsNoun;
  label: string;
  question: string;
  detail: string;
  Icon: typeof UserRound;
}[] = [
  {
    key: "persona",
    label: "Persona",
    question: "how it sounds + teaches",
    detail: "style + voice — set as the class default, picked from the catalogue",
    Icon: UserRound,
  },
  {
    key: "activity",
    label: "Activity",
    question: "what students learn",
    detail: "teaching goal + optional sim + cited materials — the unit you author here",
    Icon: BookOpen,
  },
  {
    key: "class",
    label: "Class",
    question: "who can run it",
    detail: "roster + group codes + capabilities",
    Icon: GraduationCap,
  },
];

export function SettingsMap({ highlight }: { highlight?: SettingsNoun }) {
  return (
    <aside
      className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
      aria-label="Where each setting lives"
    >
      <p className="mb-2 font-medium text-slate-700">Where settings live</p>
      <ul className="flex flex-col gap-1.5">
        {NOUNS.map(({ key, label, question, detail, Icon }) => {
          const active = key === highlight;
          return (
            <li key={key} className="flex items-start gap-2">
              <Icon
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                  active ? "text-indigo-600" : "text-slate-400"
                }`}
                aria-hidden
              />
              <span>
                <span
                  className={
                    active ? "font-semibold text-indigo-700" : "font-medium text-slate-700"
                  }
                >
                  {label}
                </span>{" "}
                — {question}
                <span className="text-slate-400"> · {detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
