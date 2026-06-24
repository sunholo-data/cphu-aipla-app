"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";
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
  /** Active chat session; when set, the student's inputs + computed result are
   *  pushed to the tutor (so it can react to what the student calculated). */
  sessionId?: string | null;
  calculators: CalculatorElementDef[];
}

/** What the tutor receives (mcp_app_context.calculator.state). */
interface CalcSnapshot {
  calculators: {
    id: string;
    title: string;
    formula: string;
    inputs: { label: string; value: string; unit: string }[];
    result: string | null;
  }[];
}

function fmt(n: number): string {
  // Trim float noise without forcing fixed decimals.
  return String(Number(n.toPrecision(6)));
}

/** Pure: the current inputs + computed results, for the tutor snapshot. */
function buildCalcSnapshot(
  calculators: CalculatorElementDef[],
  values: Record<string, string>,
): CalcSnapshot {
  return {
    calculators: calculators.map((calc) => {
      const vars: Record<string, number> = {};
      let allFilled = calc.inputs.length > 0;
      const inputs = calc.inputs.map((inp) => {
        const raw = values[`${calc.id}::${inp.id}`] ?? "";
        const n = Number(raw);
        if (raw.trim() === "" || !Number.isFinite(n)) allFilled = false;
        else vars[inp.id] = n;
        return { label: inp.label, value: raw, unit: inp.unit ?? "" };
      });
      const result = allFilled ? evaluateFormula(calc.formula, vars) : null;
      return {
        id: calc.id,
        title: calc.title ?? "",
        formula: calc.formula,
        inputs,
        result: result === null ? null : fmt(result),
      };
    }),
  };
}

/**
 * WorkbenchCalculator — a teacher-authored formula calculator (1.1.38 M3). The
 * student enters the named inputs and the result is computed **client-side** by
 * the safe-expression evaluator (`safeFormula.ts`) — never `eval`.
 *
 * The student's inputs + computed result are pushed to the tutor on blur
 * (`mcp_app_context.calculator.state`, injected into the agent prompt) so the
 * tutor can react to what the student calculated — silent passive context (kind
 * `calculator.commit` doesn't map to a proactive trigger, mirroring the data
 * table). See the "push interactive state to the tutor" step in the element
 * recipe (docs/design/aipla/v1.1.0-feedback/activity-elements-palette.md).
 */
export function WorkbenchCalculator({ skillId: _skillId, sessionId = null, calculators }: WorkbenchCalculatorProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const pushCalc = useSimSnapshotPush<CalcSnapshot>(sessionId, "calculator");
  const committedRef = useRef<string>("");

  // Push the current snapshot when an input loses focus (the value is stable).
  const commit = useCallback(() => {
    const snap = buildCalcSnapshot(calculators, values);
    const serialised = JSON.stringify(snap);
    if (serialised === committedRef.current) return; // nothing changed
    committedRef.current = serialised;
    const req = pushCalc(snap, "calculator.commit");
    if (req) void req.catch(() => {});
  }, [calculators, values, pushCalc]);

  // Catch-up push when sessionId arrives: a student may compute before the first
  // chat turn (sessionId null → push short-circuits). Push any computed result.
  useEffect(() => {
    if (!sessionId) return;
    const snap = buildCalcSnapshot(calculators, values);
    if (snap.calculators.some((c) => c.result !== null)) {
      const req = pushCalc(snap, "calculator.sync");
      if (req) void req.catch(() => {});
    }
    // Only on sessionId arrival — blur commits handle their own pushes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
                    onBlur={commit}
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
