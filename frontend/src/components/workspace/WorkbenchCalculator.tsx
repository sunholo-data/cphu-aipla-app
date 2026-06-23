"use client";

import { useState } from "react";

import { evaluateFormula } from "@/lib/safeFormula";

/** Mirrors the backend `CalcInput` (1.1.38 M3). */
export interface CalcInputDef {
  id: string;
  label: string;
  unit?: string;
}

/** Mirrors the backend `CalculatorElement`. */
export interface CalculatorElementDef {
  id: string;
  title?: string;
  formula: string;
  inputs: CalcInputDef[];
}

interface WorkbenchCalculatorProps {
  skillId: string;
  calculators: CalculatorElementDef[];
}

function fmt(n: number): string {
  // Trim float noise without forcing fixed decimals.
  return String(Number(n.toPrecision(6)));
}

/**
 * WorkbenchCalculator — a teacher-authored formula calculator (1.1.38 M3). The
 * student enters the named inputs and the result is computed **client-side** by
 * the safe-expression evaluator (`safeFormula.ts`) — never `eval`. It's a pure
 * local tool: nothing is pushed to the tutor (the student asks about a result
 * in chat if they want), so no session / sessionStorage coupling.
 */
export function WorkbenchCalculator({ calculators }: WorkbenchCalculatorProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <div className="space-y-4 p-4">
      {calculators.map((calc) => {
        const vars: Record<string, number> = {};
        let allFilled = calc.inputs.length > 0;
        for (const inp of calc.inputs) {
          const raw = values[`${calc.id}::${inp.id}`] ?? "";
          const n = Number(raw);
          if (raw.trim() === "" || !Number.isFinite(n)) allFilled = false;
          else vars[inp.id] = n;
        }
        const result = allFilled ? evaluateFormula(calc.formula, vars) : null;
        return (
          <section
            key={calc.id}
            className="rounded-lg border border-border bg-card p-4 text-sm"
            aria-label={calc.title || "Beregner"}
          >
            {calc.title && (
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {calc.title}
              </h3>
            )}
            <div className="space-y-2">
              {calc.inputs.map((inp) => (
                <label key={inp.id} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-muted-foreground">
                    {inp.label}
                    {inp.unit ? <span className="text-muted-foreground/70"> ({inp.unit})</span> : null}
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    aria-label={inp.label}
                    value={values[`${calc.id}::${inp.id}`] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [`${calc.id}::${inp.id}`]: e.target.value }))
                    }
                    className="w-full rounded border border-border bg-transparent px-2 py-1 focus:border-primary focus:outline-none"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
              <span className="font-mono text-xs text-muted-foreground">{calc.formula} =</span>
              <span className="font-semibold tabular-nums" aria-label="Resultat">
                {result === null ? "—" : fmt(result)}
              </span>
            </div>
          </section>
        );
      })}
    </div>
  );
}
