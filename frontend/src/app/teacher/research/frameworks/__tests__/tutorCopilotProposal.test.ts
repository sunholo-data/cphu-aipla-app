import { describe, expect, it } from "vitest";

import type { ToolCallState } from "@/hooks/useSkillAgent";
import {
  parseTutorProposal,
  tutorProposalDescriptor,
} from "@/app/teacher/research/frameworks/tutorCopilotProposal";

function tc(result: unknown): ToolCallState {
  return { status: "success", resultContent: JSON.stringify(result) } as ToolCallState;
}

describe("tutor co-pilot proposals (1.1.91 M2)", () => {
  it("parses an approach proposal and surfaces that no source is attached", () => {
    // The note is rendered, not swallowed: a researcher has to SEE that the
    // provenance is theirs to supply, or an unsourced approach looks finished.
    const p = parseTutorProposal(
      tc({
        ok: true,
        proposal: {
          kind: "propose_approach",
          label: "Self-determination theory",
          summary: "Autonomy, competence, relatedness.",
          constructs: [{ name: "autonomy" }, { name: "competence" }],
          provenance: [],
          needsVouching: "No citation is attached. Add the source yourself…",
        },
      }),
    );
    expect(p).toMatchObject({
      kind: "propose_approach",
      label: "Self-determination theory",
      constructNames: ["autonomy", "competence"],
    });
    expect(p && "needsVouching" in p && p.needsVouching).toMatch(/No citation/);
  });

  it("carries no citation even if one appears in the payload", () => {
    // The backend strips these, so this should never arrive. Belt and braces:
    // the parser has no field to put a citation in, so a backend regression
    // cannot surface one in the UI either.
    const p = parseTutorProposal(
      tc({
        ok: true,
        proposal: {
          kind: "propose_approach",
          label: "X",
          constructs: [{ name: "a", citation: "Deci & Ryan (1985)" }],
          provenance: [{ citation: "Invented (2026)", vouchedBy: "the model" }],
        },
      }),
    );
    expect(JSON.stringify(p)).not.toMatch(/Deci|Invented|vouchedBy/);
  });

  it("parses a behaviours proposal with its avoid-list", () => {
    const p = parseTutorProposal(
      tc({
        ok: true,
        proposal: {
          kind: "propose_behaviours",
          constructName: "elicit",
          behaviours: [{ text: "Ask the student to predict first." }],
          avoid: ["Say 'Good!' before they explain."],
        },
      }),
    );
    expect(p).toMatchObject({
      kind: "propose_behaviours",
      constructName: "elicit",
      behaviours: ["Ask the student to predict first."],
    });
  });

  it("returns null for a read tool's result, so no card appears", () => {
    // critique_approach and find_source_passages are reads — they answer in
    // chat and must not produce an Apply button for something there is nothing
    // to apply.
    expect(parseTutorProposal(tc({ ok: true, observations: { constructs: 4 } }))).toBeNull();
    expect(parseTutorProposal(tc({ ok: true, configured: true, passages: [] }))).toBeNull();
  });

  it("returns null for a failed or non-JSON tool result", () => {
    expect(parseTutorProposal(tc({ ok: false, error: "nope" }))).toBeNull();
    expect(
      parseTutorProposal({ status: "success", resultContent: "not json" } as ToolCallState),
    ).toBeNull();
    expect(parseTutorProposal({ status: "running" } as ToolCallState)).toBeNull();
  });

  it("titles a proposal by what it actually contains", () => {
    expect(
      tutorProposalDescriptor.title({
        kind: "propose_approach",
        label: "SDT",
        summary: "",
        constructNames: ["autonomy"],
        needsVouching: "",
      }),
    ).toBe("New approach: SDT — 1 construct");

    expect(
      tutorProposalDescriptor.title({
        kind: "propose_behaviours",
        constructName: "elicit",
        behaviours: ["a", "b"],
        avoid: [],
      }),
    ).toBe("2 behaviours for “elicit”");
  });

  it("lets the summary be edited before Apply, but not a behaviour list", () => {
    const approach = {
      kind: "propose_approach" as const,
      label: "SDT",
      summary: "draft",
      constructNames: ["autonomy"],
      needsVouching: "",
    };
    expect(tutorProposalDescriptor.editableText?.(approach)).toBe("draft");
    expect(tutorProposalDescriptor.withEditedText?.(approach, "reworded")).toMatchObject({
      summary: "reworded",
    });

    // Behaviours are structured; they are edited in the structure editor after
    // Apply rather than as one free-text blob here.
    expect(
      tutorProposalDescriptor.editableText?.({
        kind: "propose_behaviours",
        constructName: "elicit",
        behaviours: ["a"],
        avoid: [],
      }),
    ).toBeNull();
  });
});
