"use client";

import { Plus, X } from "lucide-react";

import { PinnedWelcome } from "@/components/chat/PinnedWelcome";
import { Button } from "@/components/ui/button";
import type { ActivityBuilder } from "@/hooks/useActivityBuilder";
import { LocaleProvider, useT } from "@/i18n";
import { ELEMENT_KINDS } from "@/lib/activityElements";
import type { ActivityOpening } from "@/lib/activityOpening";

export function ActivityOpeningEditor({ builder: b }: { builder: ActivityBuilder }) {
  const t = useT("ActivityOpeningEditor");
  const elements = b.elementPayload();
  const steps = b.checklist.map((step) => step.label).filter((label) => label.trim());
  let firstItem: ActivityOpening["firstItem"] = b.artefactId ? { kind: "simulation", title: "" } : null;
  if (!firstItem) {
    for (const kind of ELEMENT_KINDS) {
      if (kind === "checklist") continue;
      const item = elements[kind][0] as { title?: string } | undefined;
      if (item) { firstItem = { kind, title: item.title ?? "" }; break; }
    }
  }
  if (!firstItem && steps[0]) firstItem = { kind: "checklist", title: steps[0] };
  const opening: ActivityOpening = {
    text: b.studentOpening, source: b.studentOpening.trim() ? "teacher" : "default",
    firstItem, steps, starterPrompts: b.starterPrompts.filter((p) => p.trim()), byTeacher: b.openingByTeacher,
  };
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      {/* The summary row around this editor already says "Students see first";
          the legend stays for screen readers, not as a second visible title. */}
      <legend className="sr-only">{t("heading")}</legend>
      <p className="text-xs text-muted-foreground">{t("help")}</p>
      <label className="block text-sm" htmlFor="student-opening">{t("openingLabel")}</label>
      <textarea id="student-opening" value={b.studentOpening} maxLength={1500} rows={4}
        onChange={(e) => b.setStudentOpening(e.target.value)}
        className="w-full rounded-md border border-border px-3 py-2 text-sm" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={b.openingByTeacher} onChange={(e) => b.setOpeningByTeacher(e.target.checked)} />
        {t("byTeacher")}
      </label>
      <p className="text-xs text-muted-foreground">{t("byTeacherHelp")}</p>
      <p className="text-sm font-medium">{t("prompts")}</p>
      <p className="text-xs text-muted-foreground">{t("promptsHelp")}</p>
      {b.starterPrompts.map((prompt, index) => (
        <div key={index} className="flex gap-2">
          <input aria-label={t("promptNumber", { n: index + 1 })} value={prompt} maxLength={120}
            onChange={(e) => b.setStarterPrompts(b.starterPrompts.map((p, i) => i === index ? e.target.value : p))}
            className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm" />
          <Button variant="ghost" size="icon" aria-label={t("removePrompt", { n: index + 1 })}
            onClick={() => b.setStarterPrompts(b.starterPrompts.filter((_, i) => i !== index))}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" disabled={b.starterPrompts.length >= 4}
        onClick={() => b.setStarterPrompts([...b.starterPrompts, ""])}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t("addPrompt")}
      </Button>
      <p className="text-sm font-medium">{t("preview")}</p>
      <LocaleProvider locale={b.language}>
        <PinnedWelcome content="" skillId="__opening_preview__" opening={opening} activityTitle={b.title}
          onStarterPrompt={() => {}} promptsDisabled />
      </LocaleProvider>
    </fieldset>
  );
}
