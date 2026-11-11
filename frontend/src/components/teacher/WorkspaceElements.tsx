"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { LucideIcon } from "lucide-react";
import {
  Calculator,
  CheckCircle2,
  FileUp,
  FlaskConical,
  LineChart,
  ListChecks,
  Network,
  PenLine,
  Plus,
  StickyNote,
  Table2,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { CalculatorEditor } from "@/components/teacher/CalculatorEditor";
import { ChartEditor, MAX_CHARTS, newChart } from "@/components/teacher/ChartEditor";
import { ConceptMapEditor } from "@/components/teacher/ConceptMapEditor";
import { ConceptListNudge } from "@/components/teacher/lessons/ConceptListNudge";
import { DocumentEditor } from "@/components/teacher/DocumentEditor";
import { NoteEditor } from "@/components/teacher/NoteEditor";
import { SimPicker } from "@/components/teacher/SimPicker";
import { SolutionEditor } from "@/components/teacher/SolutionEditor";
import { MAX_TABLES, TableEditor, newTable } from "@/components/teacher/TableEditor";
import { useSimCatalogue } from "@/components/teacher/useSimCatalogue";
import { MAX_WRITING, WritingEditor } from "@/components/teacher/WritingEditor";
import { Button } from "@/components/ui/button";
import { RowMenu } from "@/components/ui/row-menu";
import { notify } from "@/components/ui/toast";
import type { ActivityBuilder } from "@/hooks/useActivityBuilder";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * The builder's Workspace section, add-on-demand (UI sweep 2026-11-11).
 *
 * Before: nine always-open "X (optional) + Add X" blocks, each with its own
 * help paragraph, plus an inline grid of every sim — 40-odd controls before a
 * teacher had added anything. Now only what the activity HAS renders, each as a
 * compact card that expands to its existing editor, plus one "Add to the
 * workspace" grid naming every element type with its help line.
 *
 * Nothing moved out of the builder's state: "added" is DERIVED from the same
 * fields `elementPayload()` saves (a null calculator, an empty table list), so
 * there is no second notion of presence to drift from the payload, and the
 * co-pilot's `add_element` Apply — which calls the same setters — makes its
 * card appear with no wiring of its own.
 */

// Living concept map (CONCEPT-1 M1) — dark-flagged; bakes at build time.
const CONCEPT_MAP_ENABLED = process.env.NEXT_PUBLIC_CONCEPT_MAP === "1";

export type WorkspaceKind =
  | "sim"
  | "checklist"
  | "table"
  | "chart"
  | "calculator"
  | "note"
  | "writing"
  | "solution"
  | "document"
  | "conceptMap";

interface KindSpec {
  kind: WorkspaceKind;
  icon: LucideIcon;
  /** How many the activity may hold; 1 = single-instance. */
  max: number;
}

/** In workspace order — the order the cards and the add grid show them. */
export const WORKSPACE_KINDS: KindSpec[] = [
  { kind: "sim", icon: FlaskConical, max: 1 },
  { kind: "checklist", icon: ListChecks, max: 1 },
  { kind: "table", icon: Table2, max: MAX_TABLES },
  { kind: "chart", icon: LineChart, max: MAX_CHARTS },
  { kind: "calculator", icon: Calculator, max: 1 },
  { kind: "note", icon: StickyNote, max: 1 },
  { kind: "writing", icon: PenLine, max: MAX_WRITING },
  { kind: "solution", icon: CheckCircle2, max: 1 },
  { kind: "document", icon: FileUp, max: 1 },
  { kind: "conceptMap", icon: Network, max: 1 },
];

function visibleKinds(): KindSpec[] {
  return WORKSPACE_KINDS.filter((k) => k.kind !== "conceptMap" || CONCEPT_MAP_ENABLED);
}

/** How many of `kind` the builder holds — read from the saved fields themselves. */
export function kindCount(b: ActivityBuilder, kind: WorkspaceKind): number {
  switch (kind) {
    case "sim":
      return b.artefactId ? 1 : 0;
    case "checklist":
      return b.checklist.length > 0 ? 1 : 0;
    case "table":
      return b.table.length;
    case "chart":
      return b.chart.length;
    case "writing":
      return b.writing.length;
    case "calculator":
      return b.calculator ? 1 : 0;
    case "note":
      return b.note ? 1 : 0;
    case "solution":
      return b.solution ? 1 : 0;
    case "document":
      return b.document ? 1 : 0;
    case "conceptMap":
      return b.conceptMap ? 1 : 0;
  }
}

/** Add one of `kind` — exactly what that editor's own Add button creates. */
function addKind(b: ActivityBuilder, kind: Exclude<WorkspaceKind, "sim">): void {
  switch (kind) {
    case "checklist":
      b.addChecklistItem();
      return;
    case "table":
      b.setTable([...b.table, newTable(b.nextElementKey)]);
      return;
    case "chart":
      b.setChart([...b.chart, newChart(b.chart, b.table)]);
      return;
    case "writing":
      b.setWriting([...b.writing, { key: b.nextElementKey(), id: "", title: "", prompt: "", minWords: 0 }]);
      return;
    case "calculator":
      b.setCalculator({ title: "", formula: "", inputs: [{ key: b.nextElementKey(), id: "", label: "", unit: "" }] });
      return;
    case "note":
      b.setNote({ title: "", body: "" });
      return;
    case "solution":
      b.setSolution({ prompt: "" });
      return;
    case "document":
      b.setDocument({ prompt: "" });
      return;
    case "conceptMap":
      b.setConceptMap({ title: "", nodes: [] });
      return;
  }
}

/** Remove every `kind` from the builder; returns the Undo that puts it back. */
function removeKind(b: ActivityBuilder, kind: WorkspaceKind): () => void {
  switch (kind) {
    case "sim": {
      const was = b.artefactId;
      b.setArtefactId(null);
      return () => b.setArtefactId(was);
    }
    case "checklist": {
      const was = b.checklist;
      b.setChecklist([]);
      return () => b.setChecklist(was);
    }
    case "table": {
      const was = b.table;
      b.setTable([]);
      return () => b.setTable(was);
    }
    case "chart": {
      const was = b.chart;
      b.setChart([]);
      return () => b.setChart(was);
    }
    case "writing": {
      const was = b.writing;
      b.setWriting([]);
      return () => b.setWriting(was);
    }
    case "calculator": {
      const was = b.calculator;
      b.setCalculator(null);
      return () => b.setCalculator(was);
    }
    case "note": {
      const was = b.note;
      b.setNote(null);
      return () => b.setNote(was);
    }
    case "solution": {
      const was = b.solution;
      b.setSolution(null);
      return () => b.setSolution(was);
    }
    case "document": {
      const was = b.document;
      b.setDocument(null);
      return () => b.setDocument(was);
    }
    case "conceptMap": {
      const was = b.conceptMap;
      b.setConceptMap(null);
      return () => b.setConceptMap(was);
    }
  }
}

function snippet(s: string | undefined | null, n = 70): string {
  const line = (s ?? "").trim().split("\n")[0] ?? "";
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
}

export function WorkspaceSection({
  builder: b,
  activityId,
  onProposeConceptMap,
}: {
  builder: ActivityBuilder;
  activityId?: string;
  onProposeConceptMap?: () => void;
}) {
  const t = useT("WorkspaceAdd");
  const tBody = useT("ActivityBuilderBody");
  const catalogue = useSimCatalogue();
  // Cards the teacher opened. A card added from the menu opens at once; a card
  // that came from a load, a template or the co-pilot rests as its summary.
  const [open, setOpen] = useState<Set<WorkspaceKind>>(new Set());
  const [adding, setAdding] = useState(false);
  const [pickingSim, setPickingSim] = useState(false);

  const kinds = visibleKinds();
  const added = kinds.filter((k) => kindCount(b, k.kind) > 0);
  const name = (kind: WorkspaceKind) => t(`name_${kind}`);

  const toggle = (kind: WorkspaceKind, next?: boolean) =>
    setOpen((cur) => {
      const s = new Set(cur);
      if (next ?? !s.has(kind)) s.add(kind);
      else s.delete(kind);
      return s;
    });

  function choose(kind: WorkspaceKind) {
    setAdding(false);
    if (kind === "sim") {
      setPickingSim(true);
      return;
    }
    addKind(b, kind);
    toggle(kind, true);
  }

  function remove(kind: WorkspaceKind) {
    const undo = removeKind(b, kind);
    toggle(kind, false);
    notify(t("removed", { name: name(kind) }), { action: { label: t("undo"), onClick: undo } });
  }

  function summary(kind: WorkspaceKind): string {
    switch (kind) {
      case "sim": {
        const meta = b.artefactId ? catalogue?.get(b.artefactId) : undefined;
        return meta?.displayName ?? b.artefactId ?? "";
      }
      case "checklist":
        return t("steps", { count: b.checklist.length });
      case "table":
        return t("tables", { count: b.table.length });
      case "chart":
        return t("charts", { count: b.chart.length });
      case "writing":
        return t("writings", { count: b.writing.length });
      case "calculator":
        return snippet(b.calculator?.formula) || snippet(b.calculator?.title) || t("notFilled");
      case "note":
        return snippet(b.note?.title) || snippet(b.note?.body) || t("notFilled");
      case "solution":
        return snippet(b.solution?.prompt) || t("notFilled");
      case "document":
        return snippet(b.document?.prompt) || t("notFilled");
      case "conceptMap":
        return t("concepts", { count: b.conceptMap?.nodes.filter((n) => n.label.trim()).length ?? 0 });
    }
  }

  function editor(kind: WorkspaceKind): ReactNode {
    switch (kind) {
      case "sim":
        return <SimPicker value={b.artefactId} onChange={b.setArtefactId} />;
      case "checklist":
        return <ChecklistEditor builder={b} />;
      case "table":
        return <TableEditor value={b.table} onChange={b.setTable} nextKey={b.nextElementKey} />;
      case "chart":
        return <ChartEditor value={b.chart} onChange={b.setChart} tables={b.table} />;
      case "calculator":
        return <CalculatorEditor value={b.calculator} onChange={b.setCalculator} />;
      case "note":
        return <NoteEditor value={b.note} onChange={b.setNote} />;
      case "writing":
        return <WritingEditor value={b.writing} onChange={b.setWriting} nextKey={b.nextElementKey} />;
      case "solution":
        return <SolutionEditor value={b.solution} onChange={b.setSolution} />;
      case "document":
        return <DocumentEditor value={b.document} onChange={b.setDocument} />;
      case "conceptMap":
        return (
          <ConceptMapEditor
            value={b.conceptMap}
            onChange={b.setConceptMap}
            nextKey={b.nextElementKey}
            onPropose={onProposeConceptMap}
          />
        );
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="workspace-section">
      {added.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {tBody("workspaceIntro")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {added.map(({ kind, icon: Icon }) => {
            const isOpen = open.has(kind);
            const panelId = `workspace-${kind}-editor`;
            return (
              <li
                key={kind}
                data-testid={`workspace-card-${kind}`}
                className="rounded-lg border border-border bg-background"
              >
                <div className="flex items-center gap-3 px-3 py-2">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-foreground">{name(kind)}</span>
                    <span className="truncate text-xs text-muted-foreground">{summary(kind)}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    aria-label={isOpen ? t("closeAria", { name: name(kind) }) : t("editAria", { name: name(kind) })}
                    onClick={() => toggle(kind)}
                  >
                    {isOpen ? t("close") : t("edit")}
                  </Button>
                  <RowMenu
                    label={t("more", { name: name(kind) })}
                    items={[
                      ...(kind === "sim"
                        ? [{ id: `change-${kind}`, label: t("changeSim"), onSelect: () => setPickingSim(true) }]
                        : []),
                      { id: `remove-${kind}`, label: t("remove"), danger: true, onSelect: () => remove(kind) },
                    ]}
                  />
                </div>
                {isOpen ? (
                  <div id={panelId} className="border-t border-border px-3 py-3">
                    {editor(kind)}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* 1.1.139 M3 — the before-lesson nudge: the lesson overview is only as
          good as this activity's list of concepts. */}
      {CONCEPT_MAP_ENABLED && (
        <ConceptListNudge
          activityId={activityId}
          hasConcepts={(b.conceptMap?.nodes.length ?? 0) > 0}
          onPropose={onProposeConceptMap}
        />
      )}

      <div>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("add")}
        </Button>
      </div>

      <BuilderDialog open={adding} onOpenChange={setAdding} title={t("dialogTitle")} description={t("dialogHelp")}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {kinds.map(({ kind, icon: Icon, max }) => {
            const count = kindCount(b, kind);
            const full = count >= max;
            return (
              <li key={kind}>
                <button
                  type="button"
                  data-testid={`workspace-add-${kind}`}
                  disabled={full}
                  onClick={() => choose(kind)}
                  className={cn(
                    "flex h-full w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors",
                    "hover:border-primary/40 hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    "disabled:cursor-default disabled:bg-muted/50 disabled:hover:border-border",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-foreground">
                      {name(kind)}
                      {count > 0 ? (
                        <span className="text-xs font-normal text-muted-foreground">
                          {full && max > 1 ? t("atMax", { max }) : t("added")}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <KindHelp kind={kind} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </BuilderDialog>

      <BuilderDialog open={pickingSim} onOpenChange={setPickingSim} title={t("simDialogTitle")} wide>
        <SimPicker
          mode="browse"
          value={b.artefactId}
          onChange={(id) => {
            b.setArtefactId(id);
            setPickingSim(false);
          }}
        />
      </BuilderDialog>
    </div>
  );
}

/** Each element's existing help line (the copy its empty state used to show). */
function KindHelp({ kind }: { kind: WorkspaceKind }) {
  const tSim = useT("SimPicker");
  const tBody = useT("ActivityBuilderBody");
  const tTable = useT("TableEditor");
  const tChart = useT("ChartEditor");
  const tCalc = useT("CalculatorEditor");
  const tNote = useT("NoteEditor");
  const tWriting = useT("WritingEditor");
  const tSolution = useT("SolutionEditor");
  const tDocument = useT("DocumentEditor");
  const tConcept = useT("ConceptMapEditor");
  switch (kind) {
    case "sim":
      return <>{tSim("help")}</>;
    case "checklist":
      return <>{tBody("checklistHelp")}</>;
    case "table":
      return <>{tTable("help")}</>;
    case "chart":
      return <>{tChart("help")}</>;
    case "calculator":
      return <>{tCalc.rich("intro", { code: (chunks) => <code>{chunks}</code> })}</>;
    case "note":
      return <>{tNote("help")}</>;
    case "writing":
      return <>{tWriting("help")}</>;
    case "solution":
      return <>{tSolution("help")}</>;
    case "document":
      return <>{tDocument("help")}</>;
    case "conceptMap":
      return <>{tConcept("help")}</>;
  }
}

/** The checklist editor — was inline in ActivityBuilderBody; same controls. */
function ChecklistEditor({ builder: b }: { builder: ActivityBuilder }) {
  const t = useT("ActivityBuilderBody");
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {b.checklist.map((item, idx) => (
          <li key={item.key} className="flex items-center gap-2">
            <span className="w-5 text-right text-xs text-muted-foreground">{idx + 1}.</span>
            <input
              type="text"
              aria-label={t("stepAria", { n: idx + 1 })}
              value={item.label}
              onChange={(e) => b.setChecklistLabel(item.key, e.target.value)}
              placeholder={t("stepPlaceholder")}
              maxLength={200}
              className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => b.removeChecklistItem(item.key)}
              aria-label={t("removeStep", { n: idx + 1 })}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div>
        <Button variant="secondary" size="sm" onClick={b.addChecklistItem}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t("addStep")}
        </Button>
      </div>
    </div>
  );
}

function BuilderDialog({
  open,
  onOpenChange,
  title,
  description,
  wide = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const t = useT("WorkspaceAdd");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg",
            wide ? "max-w-4xl" : "max-w-2xl",
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-sm text-muted-foreground">{description}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-label={t("close")}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
