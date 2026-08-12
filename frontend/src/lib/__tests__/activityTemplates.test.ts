import { describe, expect, it } from "vitest";

import { ACTIVITY_TEMPLATES } from "@/lib/activityTemplates";
import { validateFormula } from "@/lib/safeFormula";

describe("ACTIVITY_TEMPLATES", () => {
  it("each template has the required fields and a unique id", () => {
    const ids = new Set<string>();
    for (const t of ACTIVITY_TEMPLATES) {
      expect(t.id, "id").toBeTruthy();
      expect(ids.has(t.id), `duplicate id ${t.id}`).toBe(false);
      ids.add(t.id);
      expect(t.name).toBeTruthy();
      expect(t.summary).toBeTruthy();
      expect(t.title).toBeTruthy();
      expect(t.teachingGoal.length).toBeGreaterThan(0);
    }
  });

  it("every calculator template's formula is valid over its declared variables", () => {
    for (const t of ACTIVITY_TEMPLATES) {
      if (!t.calculator) continue;
      const ids = t.calculator.inputs.map((i) => i.id);
      expect(validateFormula(t.calculator.formula, ids), `template ${t.id}`).toMatchObject({ ok: true });
    }
  });

  it("every chart template ships a data table with at least two numeric columns to plot", () => {
    for (const t of ACTIVITY_TEMPLATES) {
      if (!t.chart) continue;
      expect(t.table, `chart template ${t.id} needs a table`).toBeDefined();
      const numeric = (t.table?.columns ?? []).filter((c) => c.kind === "number");
      expect(numeric.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("ships at least one concept-map template, each a valid DAG over its own node ids", () => {
    const withMap = ACTIVITY_TEMPLATES.filter((t) => t.conceptMap);
    expect(withMap.length).toBeGreaterThan(0);
    for (const t of withMap) {
      const nodes = t.conceptMap!.nodes;
      const ids = new Set(nodes.map((n) => n.id));
      expect(ids.size, `template ${t.id} has duplicate node ids`).toBe(nodes.length);
      for (const n of nodes) {
        for (const dep of n.dependsOn ?? []) {
          expect(ids.has(dep), `template ${t.id} node ${n.id} depends on unknown ${dep}`).toBe(true);
          expect(dep, `template ${t.id} node ${n.id} depends on itself`).not.toBe(n.id);
        }
      }
    }
  });

  it("ships a solution-writing template with a solution editor (1.1.45 M4)", () => {
    const t = ACTIVITY_TEMPLATES.find((x) => x.id === "solution-writing");
    expect(t?.solution?.prompt).toBeTruthy();
  });

  it("ships a written-conclusion template with a writing element (1.1.73)", () => {
    // The picker must demo all THREE student-submission shapes: prose,
    // drawn physics, and an uploaded file.
    const t = ACTIVITY_TEMPLATES.find((x) => x.id === "written-conclusion");
    expect(t?.writing?.[0]?.prompt).toBeTruthy();
    // Never a maths surface — that is what "Din løsning" is for (1.1.48).
    expect(t?.solution).toBeUndefined();
  });

  it("its teaching goal forbids the tutor writing the text for the student", () => {
    // The Axiom 2 rule, stated where the teacher can read and edit it — a
    // helpful model will otherwise offer to "fix it up for you".
    const t = ACTIVITY_TEMPLATES.find((x) => x.id === "written-conclusion")!;
    expect(t.teachingGoal.toLowerCase()).toContain("aldrig teksten for eleven");
  });

  it("the bench labs give the student somewhere to write the conclusion", () => {
    // A lab that stops at the graph never asks what the data MEANS. Hookes lov
    // is the demo case; the test pins that the arc is complete.
    const t = ACTIVITY_TEMPLATES.find((x) => x.id === "measurement-lab")!;
    expect(t.table, "the conclusion is only interesting alongside data").toBeDefined();
    expect(t.writing?.[0]?.title).toBe("Konklusion");
  });

  it("ships a document-feedback template with a document element (1.1.48)", () => {
    const t = ACTIVITY_TEMPLATES.find((x) => x.id === "document-feedback");
    // Reconciled from the workbench mode to a composable document element.
    expect(t?.document?.prompt).toBeTruthy();
  });
});

describe("agent-design template (RUBRIC-1 M2 / 1.1.57)", () => {
  const t = ACTIVITY_TEMPLATES.find((x) => x.id === "agent-design")!;

  it("exists and carries the five-phase checklist", () => {
    expect(t).toBeDefined();
    expect(t.checklist).toHaveLength(5);
    expect(t.checklist.some((c) => c.toLowerCase().includes("afvise"))).toBe(true);
  });

  it("the teaching goal is refutation-oriented, not confirmation-oriented", () => {
    expect(t.teachingGoal).toContain("AFVISE");
    expect(t.teachingGoal).toContain("hypotese");
  });
});
