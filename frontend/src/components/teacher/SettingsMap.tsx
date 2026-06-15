"use client";

import Link from "next/link";
import { ClipboardList, UserRound, Users } from "lucide-react";

/**
 * "Where settings live" explainer (1.1.32 Phase A, design item 5).
 *
 * The teacher surfaces accreted five overlapping levels
 * (teacher × class × persona × activity × sim). The coherence pass collapses
 * the mental model to three nouns, each owning a clear set of settings. This
 * panel states that model rather than leaving a teacher to infer it.
 *
 *   PERSONA  — HOW the tutor sounds + teaches (style + voice)   [class default]
 *   ACTIVITY — WHAT students learn (goal + optional sim + materials)
 *   CLASS    — WHO can run it (roster + group codes)
 *
 * It is also "married" to the left-rail nav (TeacherNav): **Activity** and
 * **Class** ARE sidebar destinations, so they use the same icons
 * (`ClipboardList`, `Users`) and link there. **Persona** is deliberately NOT a
 * sidebar item (it's class-scoped, set in class settings — Q4 class-default-
 * only), so it keeps a distinct icon and links *into* the class's settings —
 * teaching that it lives one level down. The `highlight` noun marks "you are
 * here" and is rendered non-clickable.
 */
type SettingsNoun = "persona" | "activity" | "class";

export function SettingsMap({
  highlight,
  classId,
}: {
  highlight?: SettingsNoun;
  classId?: string;
}) {
  const classHref = classId
    ? `/teacher/classes/${encodeURIComponent(classId)}`
    : "/teacher/classes";

  const nouns: {
    key: SettingsNoun;
    label: string;
    question: string;
    detail: string;
    Icon: typeof UserRound;
    href: string;
  }[] = [
    {
      key: "persona",
      label: "Persona",
      question: "how it sounds + teaches",
      detail: "style + voice — set as the class default, picked from the catalogue",
      Icon: UserRound,
      // Persona has no sidebar home — it lives in the class's settings.
      href: classId ? `${classHref}#class-settings` : "/teacher/classes",
    },
    {
      key: "activity",
      label: "Activity",
      question: "what students learn",
      detail: "teaching goal + optional sim + cited materials — the unit you author here",
      Icon: ClipboardList, // matches the "Activities" sidebar destination
      href: "/teacher/activities",
    },
    {
      key: "class",
      label: "Class",
      question: "who can run it",
      detail: "roster + group codes + capabilities",
      Icon: Users, // matches the "Classes" sidebar destination
      href: classHref,
    },
  ];

  return (
    <aside
      className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
      aria-label="Where each setting lives"
    >
      <p className="mb-2 font-medium text-slate-700">Where settings live</p>
      <ul className="flex flex-col gap-1.5">
        {nouns.map(({ key, label, question, detail, Icon, href }) => {
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
                {active ? (
                  <span
                    aria-current="true"
                    className="font-semibold text-indigo-700"
                  >
                    {label}
                  </span>
                ) : (
                  <Link
                    href={href}
                    className="font-medium text-slate-700 underline-offset-2 hover:text-indigo-700 hover:underline"
                  >
                    {label}
                  </Link>
                )}{" "}
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
