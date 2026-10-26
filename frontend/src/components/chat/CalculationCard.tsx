"use client";

// CalculationCard — a calculation the tutor chose to show (1.1.152 M4). The
// show_calculation tool result renders as this card instead of a tool chip.
//
// Everything on it comes from the RESULT, which the backend engine computed by
// re-evaluating the tutor's inputs (backend/maths/card.py). Nothing comes from
// the call's arguments or the tutor's text, so the number a student checks is
// the platform's, never the model's.
//
// On a tutor that lets students work the number out (`calculationResults: hold`)
// the result arrives with `held: true` and NO value in it: the card shows the
// working with "= ?" and, once the student has answered, which way they are off.
// The value is absent server-side, not hidden here, because this payload reaches
// the browser.

import { Calculator, CheckCircle2, CircleHelp } from "lucide-react";

import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { useT } from "@/i18n";

export type StudentAnswerStatus = "match" | "mismatch" | "different_quantity" | "no_unit" | "unreadable";

export interface StudentAnswer {
  value: string;
  status: StudentAnswerStatus;
  direction?: "too_large" | "too_small" | "sign";
  hint?: "power_of_ten" | "time_unit" | "speed_unit" | "factor_two";
  power?: number;
  factor?: number;
}

export interface CalculationResult {
  held: boolean;
  /** The equation with the values put in, as `$…$`, without the result. */
  working: string;
  /** The whole calculation as `$…$`, only when not held. */
  latex: string | null;
  /** The unit to answer in, as LaTeX, only when held. */
  resultUnitLatex: string;
  student: StudentAnswer | null;
  constantsUsed: Record<string, string>;
}

const STATUSES: readonly StudentAnswerStatus[] = ["match", "mismatch", "different_quantity", "no_unit", "unreadable"];

/** Parse a show_calculation tool result, or null (a refused, malformed or
 *  redacted call falls back to the generic chip). */
export function parseCalculationResult(resultContent: string | null | undefined): CalculationResult | null {
  if (!resultContent) return null;
  try {
    const r = JSON.parse(resultContent) as Record<string, unknown>;
    if (r.ok !== true || typeof r.working !== "string" || !r.working) return null;
    const held = r.held === true;
    const latex = !held && typeof r.latex === "string" ? r.latex : null;
    if (!held && !latex) return null;
    let student: StudentAnswer | null = null;
    const s = r.student as Record<string, unknown> | undefined;
    if (s && typeof s.value === "string" && STATUSES.includes(s.status as StudentAnswerStatus)) {
      student = {
        value: s.value,
        status: s.status as StudentAnswerStatus,
        direction: s.direction as StudentAnswer["direction"],
        hint: s.hint as StudentAnswer["hint"],
        power: typeof s.power === "number" ? s.power : undefined,
        factor: typeof s.factor === "number" ? s.factor : undefined,
      };
    }
    const constants =
      r.constants_used && typeof r.constants_used === "object" && !Array.isArray(r.constants_used)
        ? (r.constants_used as Record<string, string>)
        : {};
    return {
      held,
      working: r.working,
      latex,
      resultUnitLatex: typeof r.result_unit_latex === "string" ? r.result_unit_latex : "",
      student,
      constantsUsed: constants,
    };
  } catch {
    return null;
  }
}

/** `$a = b$` + `?` + unit → `$a = b = ?\,unit$`. */
function heldLatex(working: string, unit: string): string {
  const inner = working.replace(/^\$/, "").replace(/\$$/, "");
  return `$${inner} = {?}${unit ? `\\,${unit}` : ""}$`;
}

const noopNavigate = () => {};

export function CalculationCard({ result }: { result: CalculationResult }) {
  const t = useT("CalculationCard");
  const { student } = result;
  const matched = student?.status === "match";

  let feedback: string | null = null;
  if (student) {
    const value = student.value;
    if (student.status === "match") feedback = t("matches", { value });
    else if (student.status === "different_quantity") feedback = t("differentQuantity", { value });
    else if (student.status === "no_unit") feedback = t("noUnit", { value });
    else if (student.status === "unreadable") feedback = t("unreadable", { value });
    else {
      const direction =
        student.direction === "sign"
          ? t("wrongSign", { value })
          : student.direction === "too_small"
            ? t("tooSmall", { value })
            : t("tooLarge", { value });
      let cause = "";
      if (student.hint === "power_of_ten" && typeof student.power === "number") {
        cause = t("powerOfTen", { factor: String(10 ** Math.abs(student.power)) });
      } else if (student.hint === "time_unit" && student.factor) {
        cause = t("timeUnit", { factor: String(student.factor) });
      } else if (student.hint === "speed_unit") {
        cause = t("speedUnit");
      } else if (student.hint === "factor_two") {
        cause = t("factorTwo");
      }
      feedback = cause ? `${direction} ${cause}` : direction;
    }
  }

  const constants = Object.entries(result.constantsUsed)
    .map(([name, value]) => `${name} = ${value}`)
    .join(", ");

  return (
    <div
      data-testid="calculation-card"
      data-held={result.held ? "true" : "false"}
      className="min-w-0 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Calculator className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t("title")}
      </p>
      {/* Long equations scroll inside the card, never the page (~700px viewport). */}
      <div className="overflow-x-auto py-1" data-testid="calculation-card-maths">
        <ChatMarkdown
          content={result.held ? heldLatex(result.working, result.resultUnitLatex) : (result.latex ?? "")}
          navigateToBlock={noopNavigate}
        />
      </div>
      {result.held && !student ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <CircleHelp className="h-3 w-3 shrink-0" aria-hidden="true" />
          {t("yourTurn")}
        </p>
      ) : null}
      {feedback ? (
        <p
          data-testid="calculation-card-feedback"
          className={`flex items-start gap-1 text-xs ${
            matched ? "text-emerald-700 dark:text-emerald-400" : "text-amber-800 dark:text-amber-300"
          }`}
        >
          {matched ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> : null}
          <span>{feedback}</span>
        </p>
      ) : null}
      {constants ? <p className="mt-0.5 text-[10px] text-muted-foreground">{t("constants", { constants })}</p> : null}
      <p className="mt-0.5 text-[10px] text-muted-foreground">{t("computed")}</p>
    </div>
  );
}
