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
});
