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
 *   CLASS    — WHO takes part (students + group codes + what they can use)
 *   TUTOR    — WHO teaches (name, voice, tone and teaching approach)
 *   ACTIVITY — WHAT students do (goal + optional sim + materials)
 *
 * Listed in the order a teacher meets them: make a class, pick its tutor,
 * author activities for it.
 *
 * It is also "married" to the left-rail nav (TeacherNav): **Class** and
 * **Activity** ARE sidebar destinations, so they use the same icons
 * (`Users`, `ClipboardList`) and link there. **Tutor** is deliberately NOT a
 * sidebar item (it's class-scoped, set in class settings — Q4 class-default-
 * only), so it keeps a distinct icon and links *into* the class's settings —
 * teaching that it lives one level down. The `highlight` noun marks "you are
 * here" and is rendered non-clickable.
 *
 * ⚠️ The word is **tutor**, not "persona" (1.1.91). One tutor choice carries
 * name, picture, voice, tone and teaching approach together; `persona` survives
 * only as a legacy API field and must not resurface in teacher-facing copy.
 */
type SettingsNoun = "class" | "tutor" | "activity";

const copy = {
  heading: "Where settings live",
  class: {
    label: "Class",
    question: "who takes part",
    detail: "students, group codes and what they can use",
  },
  tutor: {
    label: "Tutor",
    question: "who teaches",
    detail: "name, voice, tone and teaching approach — one choice, made on the class",
  },
  activity: {
    label: "Activity",
    question: "what students do",
    detail: "teaching goal, optional simulation and cited materials — what you author here",
  },
};

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
      key: "class",
      ...copy.class,
      Icon: Users, // matches the "Classes" sidebar destination
      href: classHref,
    },
    {
      key: "tutor",
      ...copy.tutor,
      Icon: UserRound,
      // The tutor has no sidebar home — it lives in the class's settings.
      href: classId ? `${classHref}#class-settings` : "/teacher/classes",
    },
    {
      key: "activity",
      ...copy.activity,
      Icon: ClipboardList, // matches the "Activities" sidebar destination
      href: "/teacher/activities",
    },
  ];

  return (
    <aside
      className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
      aria-label="Where each setting lives"
    >
      <p className="mb-2 font-medium text-slate-700">{copy.heading}</p>
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
