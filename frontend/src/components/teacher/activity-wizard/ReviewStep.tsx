"use client";

import Link from "next/link";
import {
  ChevronDown,
  GraduationCap,
  Languages,
  LayoutGrid,
  LayoutPanelLeft,
  Library,
  MessageSquareText,
  NotebookPen,
  SlidersHorizontal,
  Target,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode, type Ref } from "react";

import { ActivityOpeningEditor } from "@/components/teacher/ActivityOpeningEditor";
import { BuilderHints } from "@/components/teacher/BuilderHints";
import { ClassTutorSummary, tutorSettingsHref } from "@/components/teacher/InheritedTutor";
import { MaterialsSection } from "@/components/teacher/MaterialsSection";
import { StudentViewPicker } from "@/components/teacher/StudentViewPicker";
import { WORKSPACE_KINDS, kindCount, type WorkspaceKind } from "@/components/teacher/WorkspaceElements";
import type { ActivityBuilder } from "@/hooks/useActivityBuilder";
import { useT } from "@/i18n";
import { languageHint, tableHints, type BuilderHint } from "@/lib/builderHints";
import type { ClassPayload, Language } from "@/lib/teacherApi";

import type { WizardStep } from "./WizardFrame";

// Living concept map (CONCEPT-1 M1) — dark-flagged, like the workspace grid.
const CONCEPT_MAP_ENABLED = process.env.NEXT_PUBLIC_CONCEPT_MAP === "1";

type SettingRow = "view" | "opening" | "language" | "notes" | "materials";

function snippet(s: string, n: number): string {
  const line = s.trim().split("\n")[0] ?? "";
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
}

/** The kinds the activity holds, in workspace order (what step 2 shows as on). */
export function addedKinds(b: ActivityBuilder): WorkspaceKind[] {
  return WORKSPACE_KINDS.filter((k) => k.kind !== "conceptMap" || CONCEPT_MAP_ENABLED)
    .filter((k) => kindCount(b, k.kind) > 0)
    .map((k) => k.kind);
}

/** Every soft hint the draft earns (1.1.151) — the same checks the editor runs. */
function draftHints(b: ActivityBuilder): BuilderHint[] {
  const labels = [
    ...b.table.flatMap((tbl) => [tbl.title, ...tbl.columns.map((c) => c.label)]),
    ...b.checklist.map((c) => c.label),
    ...b.writing.map((w) => w.title),
  ].filter((s): s is string => typeof s === "string" && s.trim() !== "");
  const hints: BuilderHint[] = [];
  const lang = languageHint({ language: b.language, title: b.title, teachingGoal: b.teachingGoal, labels });
  if (lang) hints.push(lang);
  hints.push(...tableHints(b.table));
  return hints;
}

/**
 * Wizard step 3 — "Check and start" (2026-11-12). One row per earlier choice,
 * each with Edit back to its step; everything with a default sits behind
 * "More settings" and opens its EXISTING editor in place, so nothing the long
 * form could set is out of reach.
 */
export function ReviewStep({
  builder: b,
  selectedClass,
  activityId,
  headingRef,
  onEditStep,
  onLanguageChange,
  share,
  onShareChange,
  error,
}: {
  builder: ActivityBuilder;
  selectedClass: ClassPayload | null;
  /** Threaded to Materials (image uploads attach to this slot). */
  activityId?: string;
  headingRef?: Ref<HTMLHeadingElement>;
  onEditStep: (step: WizardStep) => void;
  onLanguageChange: (language: Language) => void;
  share: boolean;
  onShareChange: (share: boolean) => void;
  error?: ReactNode;
}) {
  const t = useT("ActivityWizard");
  const tSum = useT("ActivitySummary");
  const tWs = useT("WorkspaceAdd");
  const tView = useT("StudentViewPicker");
  const tLint = useT("TeachingGoalLint");
  const [moreOpen, setMoreOpen] = useState(false);
  const [openRow, setOpenRow] = useState<SettingRow | null>(null);

  const tutorClasses = selectedClass ? [selectedClass] : null;
  const kinds = addedKinds(b);
  const prompts = b.starterPrompts.filter((p) => p.trim()).length;
  const opening = [
    b.openingByTeacher ? tSum("openingByTeacher") : b.studentOpening.trim() ? tSum("openingOwn") : tSum("openingDefault"),
    prompts > 0 ? tSum("openingPrompts", { count: prompts }) : tSum("openingDefaultPrompts"),
  ].join(" · ");

  const toggle = (row: SettingRow) => setOpenRow((cur) => (cur === row ? null : row));

  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-foreground outline-none sm:text-2xl">
        {t("reviewHeading")}
      </h1>

      <ul
        aria-label={t("summaryAria")}
        data-testid="wizard-summary"
        className="divide-y divide-border rounded-lg border border-border bg-background text-sm"
      >
        <SummaryRow
          icon={Target}
          value={
            <>
              <span className="block font-medium text-foreground">{b.title.trim()}</span>
              <span className="block text-muted-foreground">{snippet(b.teachingGoal, 140)}</span>
            </>
          }
          action={
            <EditButton label={t("edit")} aria={t("editAria", { what: t("goalWhat") })} onClick={() => onEditStep(1)} />
          }
        />
        <SummaryRow
          icon={LayoutGrid}
          value={
            <span className="text-foreground">
              {kinds.length ? kinds.map((k) => tWs(`name_${k}`)).join(", ") : t("toolsNone")}
            </span>
          }
          action={
            <EditButton label={t("edit")} aria={t("editAria", { what: t("toolsWhat") })} onClick={() => onEditStep(2)} />
          }
        />
        <SummaryRow
          icon={GraduationCap}
          value={
            <span className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{t("tutorLabel")}</span>
              <ClassTutorSummary classes={tutorClasses} showClassNames={false} />
            </span>
          }
          action={
            <Link href={tutorSettingsHref(tutorClasses)} className="text-sm font-medium text-primary hover:underline">
              {tSum("changeInClass")}
            </Link>
          }
        />
      </ul>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls="wizard-more-settings"
          onClick={() => setMoreOpen((v) => !v)}
          className="flex w-full items-start gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <SlidersHorizontal aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-foreground">{t("more")}</span>
            <span className="text-xs text-muted-foreground">{t("moreHelp")}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${moreOpen ? "rotate-180" : ""}`}
          />
        </button>

        {moreOpen ? (
          <ul
            id="wizard-more-settings"
            className="divide-y divide-border rounded-lg border border-border bg-background text-sm"
          >
            <SettingItem
              id="view"
              icon={LayoutPanelLeft}
              label={tSum("studentView")}
              value={tView(`${b.studentView}_title`)}
              open={openRow === "view"}
              onToggle={toggle}
            >
              <StudentViewPicker value={b.studentView} onChange={b.setStudentView} />
            </SettingItem>
            <SettingItem
              id="opening"
              icon={MessageSquareText}
              label={tSum("opening")}
              value={opening}
              open={openRow === "opening"}
              onToggle={toggle}
            >
              <ActivityOpeningEditor builder={b} />
            </SettingItem>
            <SettingItem
              id="language"
              icon={Languages}
              label={t("language")}
              value={b.language === "en" ? "English" : "Dansk"}
              valueLang={b.language}
              open={openRow === "language"}
              onToggle={toggle}
            >
              <div className="flex max-w-xs flex-col gap-1">
                <label htmlFor="activity-language" className="text-sm font-medium text-foreground">
                  {t("language")}
                </label>
                <select
                  id="activity-language"
                  value={b.language}
                  aria-describedby="activity-language-help"
                  onChange={(e) => onLanguageChange(e.target.value as Language)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {/* Endonyms: each language named in itself, never translated. */}
                  <option value="da" translate="no">
                    Dansk
                  </option>
                  <option value="en" translate="no">
                    English
                  </option>
                </select>
                <span id="activity-language-help" className="text-xs text-muted-foreground">
                  {t("languageHelp")}
                </span>
              </div>
            </SettingItem>
            <SettingItem
              id="notes"
              icon={NotebookPen}
              label={t("notes")}
              value={b.tutorNotes.trim() ? snippet(b.tutorNotes, 70) : t("notesNone")}
              open={openRow === "notes"}
              onToggle={toggle}
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="activity-tutor-notes" className="text-sm font-medium text-foreground">
                  {t("notes")}
                </label>
                <textarea
                  id="activity-tutor-notes"
                  value={b.tutorNotes}
                  onChange={(e) => b.setTutorNotes(e.target.value)}
                  aria-describedby="activity-tutor-notes-help"
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
                <span id="activity-tutor-notes-help" className="text-xs text-muted-foreground">
                  {tLint("notesHelp")}
                </span>
              </div>
            </SettingItem>
            <SettingItem
              id="materials"
              icon={Library}
              label={t("materials")}
              value={t("materialsCount", { count: b.materials.length })}
              open={openRow === "materials"}
              onToggle={toggle}
            >
              <MaterialsSection materials={b.materials} onChange={b.setMaterials} activityId={activityId} />
            </SettingItem>
          </ul>
        ) : null}
      </div>

      {/* 1.1.151 — soft hints; never blocking. */}
      <BuilderHints hints={draftHints(b)} />

      <label className="flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={share}
          onChange={(e) => onShareChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border accent-brand"
        />
        <span>{t("share")}</span>
      </label>

      {error}
    </>
  );
}

function SummaryRow({ icon: Icon, value, action }: { icon: LucideIcon; value: ReactNode; action: ReactNode }) {
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">{value}</div>
      <div className="shrink-0">{action}</div>
    </li>
  );
}

function EditButton({ label, aria, onClick }: { label: string; aria: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={aria} className="text-sm font-medium text-primary hover:underline">
      {label}
    </button>
  );
}

function SettingItem({
  id,
  icon: Icon,
  label,
  value,
  valueLang,
  open,
  onToggle,
  children,
}: {
  id: SettingRow;
  icon: LucideIcon;
  label: string;
  value: string;
  valueLang?: string;
  open: boolean;
  onToggle: (id: SettingRow) => void;
  children: ReactNode;
}) {
  const tSum = useT("ActivitySummary");
  const panelId = `wizard-setting-${id}`;
  return (
    <li className="flex flex-col gap-3 px-3 py-2.5">
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:gap-3">
          <span className="shrink-0 font-medium text-foreground sm:w-40">{label}</span>
          <span className="min-w-0 text-muted-foreground" lang={valueLang}>
            {value}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? tSum("closeAria", { label }) : tSum("changeAria", { label })}
          className="shrink-0 text-sm font-medium text-primary hover:underline"
        >
          {open ? tSum("close") : tSum("change")}
        </button>
      </div>
      {open ? <div id={panelId}>{children}</div> : null}
    </li>
  );
}
