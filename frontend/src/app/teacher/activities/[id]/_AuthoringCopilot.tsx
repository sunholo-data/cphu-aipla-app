/**
 * `AuthoringCopilot` — the teacher-facing AG-UI chat island for the activity
 * builder (COPILOT-1 + COPILOT-2; designs 1.1.39 + 1.1.50).
 *
 * The teacher describes what they want to teach; the co-pilot's owner-scoped,
 * propose-only tools surface **proposals** as Apply / Edit / Dismiss cards.
 * Apply writes into the builder draft (the existing save persists it) — nothing
 * changes without the teacher's action (EARNED TRUST).
 *
 * COPILOT-2 M0 generalized the pipeline: every tool returns a `{kind, …}`
 * proposal; `parseProposal` dispatches on `kind`; the parent supplies one
 * `onApplyProposal` router that maps each kind to a builder setter. Adding a
 * tool (add_element, set_artefact, …) is a new `Proposal` variant + a router
 * case — the card + transport are shared.
 *
 * This component is now a thin **config** over the shared `<TeacherCopilot>`
 * shell (`components/teacher/copilot/`) — the same panel, slug→UUID resolve,
 * teacher-auth AG-UI transport, proposal cards, and cross-visit resume the
 * class + analytics co-pilots use. The shell was originally extracted from THIS
 * file; this migration folds it back onto the shared shell so co-pilot changes
 * happen in one place (design: activity-copilot-shared-shell-migration.md).
 * Surface-specific bits live here: the `Proposal` union, `parseProposal`, the
 * Danish strings, and the per-kind proposal previews (the `descriptor`).
 *
 * Dark-flagged: renders null unless `NEXT_PUBLIC_AUTHORING_COPILOT === "1"`.
 * Browser-verify gate: the live SSE tool-result shapes + the Apply round-trips.
 */

"use client";

import type { ReactNode } from "react";

import { TeacherCopilot } from "@/components/teacher/copilot";
import type { CopilotLabels, ProposalDescriptor, TeacherCopilotConfig } from "@/components/teacher/copilot";
import { useTeacherFeature } from "@/hooks/useTeacherFeature";
import type { ToolCallState } from "@/hooks/useSkillAgent";

import type { ConceptMapDiff } from "../applyConceptMapDiff";

const SKILL_NAME = "activity-authoring-assistant";


/**
 * A co-pilot proposal. One variant per tool; the parent's `onApplyProposal`
 * router maps each `kind` to a builder setter. Extend the union when adding a
 * tool (COPILOT-2 M1 add_element, M2 set_artefact, …).
 */
export type Proposal =
  | { kind: "set_lesson_prompt"; value: string }
  | { kind: "add_element"; elementKind: "checklist"; items: string[]; label: string }
  | { kind: "add_element"; elementKind: "note"; title: string; body: string; label: string }
  | { kind: "add_element"; elementKind: "writing"; title: string; prompt: string; minWords: number; label: string }
  | { kind: "add_element"; elementKind: "solution" | "document"; prompt: string; label: string }
  | {
      kind: "add_element";
      elementKind: "table";
      title: string;
      columns: { label: string; unit: string; kind: "number" | "text" }[];
      rows: number;
      label: string;
    }
  | {
      kind: "add_element";
      elementKind: "chart";
      title: string;
      chartKind: "scatter" | "line" | "bar";
      /** 1.1.64 — optional axis binding, so the co-pilot can propose "velocity
       *  against time" rather than only "a chart". Column ids are the minted
       *  `col-{n}` of the activity's table. */
      xColumn?: string | null;
      yColumn?: string | null;
      label: string;
    }
  | {
      kind: "add_element";
      elementKind: "calculator";
      title: string;
      formula: string;
      inputs: { id: string; label: string; unit: string }[];
      label: string;
    }
  | { kind: "set_artefact"; artefactId: string; label: string }
  | {
      kind: "attach_material";
      materialKind: "curriculum";
      docId: string;
      origin: string;
      /** 1.1.63 M1 — the doc's title, cached onto the MaterialRef so the tutor
       *  cites by title rather than by domain. Optional for older proposals. */
      title?: string;
      label: string;
    }
  | {
      kind: "set_activity_facets";
      subject: string | null;
      level: "A" | "B" | "C" | null;
      tags: string[];
      label: string;
    }
  | {
      kind: "propose_concept_map";
      diff: ConceptMapDiff;
      /** The server-validated resulting map — used for label lookups in the
       *  card preview (edge refs are node ids). */
      resultNodes: { id: string; label: string }[];
      label: string;
    };

export type ApplyProposal = (proposal: Proposal) => void;

interface AuthoringCopilotProps {
  activityId: string;
  /** Apply router — maps a proposal to the right builder mutation. */
  onApplyProposal: ApplyProposal;
}

/** Parse a co-pilot tool result into a typed Proposal, or null. Dispatches on
 *  `proposal.kind` so each tool's result renders + applies through one path. */
export function parseProposal(tc: ToolCallState): Proposal | null {
  if (tc.status !== "success" || !tc.resultContent) return null;
  let r: { ok?: boolean; proposal?: Record<string, unknown> };
  try {
    r = JSON.parse(tc.resultContent);
  } catch {
    return null; // not JSON — no proposal to surface
  }
  if (!r?.ok || !r.proposal || typeof r.proposal.kind !== "string") return null;
  const p = r.proposal;
  switch (p.kind) {
    case "set_lesson_prompt":
      return typeof p.value === "string" && p.field === "teachingGoal" ? { kind: "set_lesson_prompt", value: p.value } : null;
    case "add_element": {
      const ek = p.element_kind;
      const spec = (p.spec ?? {}) as Record<string, unknown>;
      const label = typeof p.label === "string" ? p.label : "Element";
      if (ek === "checklist" && Array.isArray(spec.items) && spec.items.every((s) => typeof s === "string")) {
        return { kind: "add_element", elementKind: "checklist", items: spec.items as string[], label };
      }
      if (ek === "note" && typeof spec.body === "string") {
        return { kind: "add_element", elementKind: "note", title: typeof spec.title === "string" ? spec.title : "", body: spec.body, label };
      }
      if (ek === "writing" && typeof spec.prompt === "string") {
        return {
          kind: "add_element",
          elementKind: "writing",
          title: typeof spec.title === "string" ? spec.title : "",
          prompt: spec.prompt,
          minWords: typeof spec.minWords === "number" ? spec.minWords : 0,
          label,
        };
      }
      if ((ek === "solution" || ek === "document") && typeof spec.prompt === "string") {
        return { kind: "add_element", elementKind: ek, prompt: spec.prompt, label };
      }
      if (ek === "table" && Array.isArray(spec.columns)) {
        return {
          kind: "add_element",
          elementKind: "table",
          title: typeof spec.title === "string" ? spec.title : "",
          columns: spec.columns as { label: string; unit: string; kind: "number" | "text" }[],
          rows: typeof spec.rows === "number" ? spec.rows : 5,
          label,
        };
      }
      if (ek === "chart" && typeof spec.chartKind === "string") {
        return {
          kind: "add_element",
          elementKind: "chart",
          title: typeof spec.title === "string" ? spec.title : "",
          chartKind: spec.chartKind as "scatter" | "line" | "bar",
          // 1.1.64 — optional; absent on proposals from before axis binding.
          xColumn: typeof spec.xColumn === "string" ? spec.xColumn : null,
          yColumn: typeof spec.yColumn === "string" ? spec.yColumn : null,
          label,
        };
      }
      if (ek === "calculator" && typeof spec.formula === "string" && Array.isArray(spec.inputs)) {
        return {
          kind: "add_element",
          elementKind: "calculator",
          title: typeof spec.title === "string" ? spec.title : "",
          formula: spec.formula,
          inputs: spec.inputs as { id: string; label: string; unit: string }[],
          label,
        };
      }
      return null;
    }
    case "set_artefact":
      return typeof p.artefactId === "string" && p.artefactId
        ? { kind: "set_artefact", artefactId: p.artefactId, label: typeof p.label === "string" ? p.label : p.artefactId }
        : null;
    case "attach_material":
      return p.materialKind === "curriculum" && typeof p.docId === "string" && p.docId
        ? {
            kind: "attach_material",
            materialKind: "curriculum",
            docId: p.docId,
            origin: typeof p.origin === "string" ? p.origin : "",
            label: typeof p.label === "string" ? p.label : p.docId,
          }
        : null;
    case "set_activity_facets": {
      // 1.1.61 — how the activity is FILED (own facets only; inherited ones come
      // from the cited documents and are never proposable).
      const level = p.level === "A" || p.level === "B" || p.level === "C" ? p.level : null;
      const subject = typeof p.subject === "string" && p.subject ? p.subject : null;
      const tags = Array.isArray(p.tags) ? (p.tags as string[]).filter((t) => typeof t === "string") : [];
      if (!subject && !level && tags.length === 0) return null;
      return {
        kind: "set_activity_facets",
        subject,
        level,
        tags,
        label: typeof p.label === "string" ? p.label : "arkivering",
      };
    }
    case "propose_concept_map": {
      const result = (p.result ?? {}) as Record<string, unknown>;
      if (typeof p.diff !== "object" || p.diff === null || !Array.isArray(result.nodes)) return null;
      return {
        kind: "propose_concept_map",
        diff: p.diff as ConceptMapDiff,
        resultNodes: (result.nodes as { id: string; label: string }[]).map((n) => ({ id: n.id, label: n.label })),
        label: typeof p.label === "string" ? p.label : "begrebskort",
      };
    }
    default:
      return null; // unknown/unsupported kind (a newer tool than this build)
  }
}

/** Card body preview for an add_element proposal, per element kind. */
function AddElementBody({ proposal }: { proposal: Extract<Proposal, { kind: "add_element" }> }) {
  switch (proposal.elementKind) {
    case "checklist":
      return (
        <ul className="list-disc pl-5 text-sm" data-testid="proposal-items">
          {proposal.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      );
    case "note":
      return (
        <div data-testid="proposal-note">
          {proposal.title ? <p className="font-medium">{proposal.title}</p> : null}
          <p className="whitespace-pre-wrap text-sm">{proposal.body}</p>
        </div>
      );
    case "writing":
      return (
        <div data-testid="proposal-writing">
          {proposal.title ? <p className="font-medium">{proposal.title}</p> : null}
          <p className="whitespace-pre-wrap text-sm">{proposal.prompt}</p>
          {proposal.minWords > 0 ? (
            <p className="text-xs text-slate-500">Mål: {proposal.minWords} ord</p>
          ) : null}
        </div>
      );
    case "solution":
    case "document":
      return (
        <p className="whitespace-pre-wrap text-sm" data-testid="proposal-prompt">
          {proposal.prompt}
        </p>
      );
    case "table":
      return (
        <p className="text-sm" data-testid="proposal-table">
          {proposal.columns.map((c) => c.label).join(", ")} · {proposal.rows} rækker
        </p>
      );
    case "chart":
      return (
        <p className="text-sm" data-testid="proposal-chart">
          {proposal.chartKind}
        </p>
      );
    case "calculator":
      return (
        <p className="font-mono text-sm" data-testid="proposal-calc">
          {proposal.formula}
        </p>
      );
  }
}

/** How the shared `ProposalCard` renders + edits an authoring proposal. The
 *  lesson prompt is editable inline before Apply; elements + sims preview their
 *  shape (testids the suite asserts) and are Apply/Dismiss only. */
const authoringProposalDescriptor: ProposalDescriptor<Proposal> = {
  title: (p) => {
    switch (p.kind) {
      case "set_lesson_prompt":
        return "Forslag til lærer-prompt";
      case "add_element":
        return `Forslag: ${p.label}`;
      case "set_artefact":
        return "Forslag: brug en simulation";
      case "set_activity_facets":
        return "Forslag: arkivering (emne · niveau · tags)";
      case "attach_material":
        return `Forslag: materiale — ${p.label}`;
      case "propose_concept_map":
        return `Forslag: begrebskort — ${p.label}`;
    }
  },
  editableText: (p) => (p.kind === "set_lesson_prompt" ? p.value : null),
  withEditedText: (p, text) => (p.kind === "set_lesson_prompt" ? { ...p, value: text } : p),
  body: (p): ReactNode => {
    if (p.kind === "add_element") return <AddElementBody proposal={p} />;
    if (p.kind === "set_artefact") {
      return (
        <p className="text-sm" data-testid="proposal-sim">
          {p.label}
        </p>
      );
    }
    if (p.kind === "attach_material") {
      return (
        <p className="text-sm" data-testid="proposal-material">
          {p.label}
          {p.origin ? ` · ${p.origin}` : ""}
        </p>
      );
    }
    if (p.kind === "propose_concept_map") return <ConceptMapDiffBody proposal={p} />;
    return null; // set_lesson_prompt renders via editableText, not body
  },
};

/** Card body for a concept-map DIFF — what changes, in the teacher's terms
 *  (labels, not slugs). */
function ConceptMapDiffBody({ proposal }: { proposal: Extract<Proposal, { kind: "propose_concept_map" }> }) {
  const { diff, resultNodes } = proposal;
  const labelOf = (id: string) => resultNodes.find((n) => n.id === id)?.label ?? id;
  const rows: { key: string; text: string }[] = [];
  for (const n of diff.addNodes ?? []) {
    const q = n.checkQuestions?.length ? ` (${n.checkQuestions.length} tjekspørgsmål)` : "";
    rows.push({ key: `+n-${n.id}`, text: `+ ${n.label}${q}` });
  }
  for (const e of diff.addEdges ?? []) {
    rows.push({ key: `+e-${e.from}-${e.to}`, text: `→ ${labelOf(e.from)} før ${labelOf(e.to)}` });
  }
  for (const id of diff.removeNodes ?? []) rows.push({ key: `-n-${id}`, text: `− ${labelOf(id)}` });
  for (const r of diff.relabel ?? []) rows.push({ key: `~n-${r.id}`, text: `✎ ${r.id} → ${r.label}` });
  for (const sq of diff.setCheckQuestions ?? []) {
    rows.push({ key: `?n-${sq.nodeId}`, text: `? ${labelOf(sq.nodeId)}: ${sq.questions.length} tjekspørgsmål` });
  }
  return (
    <ul className="space-y-0.5 text-sm" data-testid="proposal-concept-map">
      {rows.map((r) => (
        <li key={r.key}>{r.text}</li>
      ))}
    </ul>
  );
}

/** Danish labels for the card + chat — the authoring co-pilot is a fixed-locale
 *  surface (the shell defaults to English). */
const DANISH_LABELS: Partial<CopilotLabels> = {
  apply: "Anvend",
  useEdited: "Brug denne",
  edit: "Rediger",
  dismiss: "Afvis",
  applied: "Anvendt ✓ — du kan stadig rette det i feltet.",
  thinking: "Tænker…",
  editAriaLabel: "Rediger forslag",
};

/** Hide the `[activity_id=…] ` prefix from the rendered user bubble. */
function stripActivityPrefix(content: string): string {
  const m = content.match(/^\[activity_id=[^\]]+\]\s*/);
  return m ? content.slice(m[0].length) : content;
}

/**
 * Public entry. Dark-flagged → renders nothing when disabled (degradation).
 * A thin config over the shared `<TeacherCopilot>` shell: the shell owns the
 * floating panel, slug→UUID resolve, teacher-auth transport, cards, and resume;
 * this supplies the authoring skill, the Danish strings, the `activity_id`
 * scope prefix, the proposal parser + descriptor, and the Apply router.
 */
export function AuthoringCopilot({ activityId, onApplyProposal }: AuthoringCopilotProps) {
  // 1.1.58 tri-state: '1' (dev) unchanged; 'beta' follows the teacher's
  // settings opt-in; ''/unset renders nothing. Read inline (Next inlines
  // NEXT_PUBLIC_* at build; tests mutate process.env at runtime). The hook
  // runs before any early return (hook-order rule).
  const enabled = useTeacherFeature("authoringCopilot", process.env.NEXT_PUBLIC_AUTHORING_COPILOT);
  if (!enabled) return null;

  const config: TeacherCopilotConfig<Proposal> = {
    skillName: SKILL_NAME,
    title: "Medbygger",
    testId: "authoring-copilot",
    placeholder: "Fx: energibevarelse for en B-klasse…",
    inputAriaLabel: "Beskriv hvad du vil undervise i",
    emptyText:
      "Fortæl hvad du vil undervise i — jeg foreslår en lærer-prompt og elementer, du kan rette og anvende. Du kan stadig bladre i siden mens jeg arbejder.",
    loadingText: "Indlæser medbygger…",
    minimizeLabel: "Skjul medbygger",
    // activity_id rides the message prefix (the analytics-chat contract) when
    // editing an existing activity; on /new (no id yet) it's a draft — omit it.
    scopePrefix: activityId ? `[activity_id=${activityId}] ` : "",
    stripPrefix: stripActivityPrefix,
    // Per-activity resume — a new benefit the migration grants (each activity's
    // co-pilot conversation is its own thread).
    persistKey: `activity-authoring:${activityId}`,
    parseProposal,
    proposalDescriptor: authoringProposalDescriptor,
    // Keep the "Anvendt ✓" badge (default, dismissOnApply omitted): the effect
    // lands in a builder field the teacher can still edit, so the badge reminds
    // them it was applied — unlike the class co-pilot whose effect shows in a list.
    onApplyProposal,
    labels: DANISH_LABELS,
  };

  return <TeacherCopilot<Proposal> {...config} />;
}
