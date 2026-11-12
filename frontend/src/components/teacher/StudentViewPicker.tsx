"use client";

import { useT } from "@/i18n";
import { STUDENT_VIEWS, type StudentView } from "@/lib/studentView";
import { cn } from "@/lib/utils";

interface StudentViewPickerProps {
  value: StudentView;
  onChange: (next: StudentView) => void;
}

/**
 * "Student view" in the activity editor (2026-11-09): how the students' screen
 * is arranged for this activity. Radio cards, each with a small schematic, so a
 * teacher chooses by what the students will see rather than by a name. The
 * content is the same in every view — nothing is added or removed.
 *
 * Design: the student-layout canvas shown to teachers before the 26 Nov
 * workshop (boards "Today", A "work first", D "photo on a phone").
 */
export function StudentViewPicker({ value, onChange }: StudentViewPickerProps) {
  const t = useT("StudentViewPicker");
  return (
    <fieldset className="flex flex-col gap-2">
      {/* Shown inside the "Student view" summary row, which already titles it:
          the legend is for screen readers; the help answers the one real
          question (does the view change the content?). */}
      <legend className="sr-only">{t("legend")}</legend>
      <p className="text-xs text-slate-500">{t("help")}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {STUDENT_VIEWS.map((view) => {
          const checked = value === view;
          return (
            <label
              key={view}
              className={cn(
                "flex cursor-pointer flex-col gap-2 rounded-lg border bg-white p-3 text-sm",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                checked ? "border-brand ring-1 ring-brand" : "border-slate-200 hover:border-slate-300",
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="student-view"
                  value={view}
                  checked={checked}
                  onChange={() => onChange(view)}
                  className="h-4 w-4 accent-brand"
                />
                <span className="font-medium text-slate-800">{t(`${view}_title`)}</span>
              </span>
              <ViewSchematic view={view} />
              <span className="text-xs leading-snug text-slate-600">{t(`${view}_desc`)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A wordless thumbnail of the layout: grey = the conversation, dark = the
 *  workspace, brand = the photo button. Decorative — the card text says it. */
function ViewSchematic({ view }: { view: StudentView }) {
  const chat = <span className="flex-1 rounded-sm border border-slate-200 bg-slate-50" />;
  const work = <span className="flex-[2] rounded-sm bg-slate-700" />;
  return (
    <span aria-hidden className="flex h-14 gap-1 rounded border border-slate-200 bg-white p-1">
      {view === "chat" && (
        <>
          <span className="flex-[1.2] rounded-sm border border-slate-200 bg-slate-50" />
          <span className="flex-1 rounded-sm bg-slate-700" />
        </>
      )}
      {view === "workbench" && (
        <>
          {work}
          {chat}
        </>
      )}
      {view === "photo" && (
        <span className="mx-auto flex w-12 flex-col gap-0.5 rounded-sm border border-slate-300 p-0.5">
          <span className="flex-1 rounded-[2px] bg-amber-50 ring-1 ring-slate-200" />
          <span className="h-2 rounded-[2px] bg-brand" />
        </span>
      )}
    </span>
  );
}
