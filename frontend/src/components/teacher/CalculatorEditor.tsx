"use client";

import { Calculator as CalcIcon, HelpCircle, Plus, X } from "lucide-react";
import { useRef } from "react";

import { useT } from "@/i18n";
import { validateFormula } from "@/lib/safeFormula";

const code = (chunks: React.ReactNode) => <code>{chunks}</code>;

/** A hover/focus help bubble explaining how to author a calculator. Self-
 *  contained (no Radix provider): CSS reveals it on hover or keyboard focus. */
function FormulaHelp() {
  const t = useT("CalculatorEditor");
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={t("helpAria")}
        className="text-slate-400 hover:text-slate-600 focus:text-slate-600 focus:outline-none"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-72 -translate-x-1/2 flex-col gap-1 rounded-md border border-slate-200 bg-white p-3 text-left text-xs leading-relaxed text-slate-600 shadow-lg group-hover:flex group-focus-within:flex"
      >
        <span className="font-semibold text-slate-700">{t("helpTitle")}</span>
        <span>{t.rich("help1", { code })}</span>
        <span>{t.rich("help2", { code })}</span>
        <span>{t.rich("help3", { code })}</span>
        <span>{t.rich("help4", { code })}</span>
        <span>{t("help5")}</span>
      </span>
    </span>
  );
}

export interface CalcInputRow {
  key: number;
  /** The variable name used in the formula (a simple identifier). */
  id: string;
  label: string;
  unit: string;
}

export interface CalculatorEditorValue {
  title: string;
  formula: string;
  inputs: CalcInputRow[];
}

interface CalculatorEditorProps {
  value: CalculatorEditorValue | null;
  onChange: (value: CalculatorEditorValue | null) => void;
}

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_INPUTS = 8;

/**
 * CalculatorEditor — the teacher-builder editor for a formula calculator
 * (1.1.38 M3). The teacher names variables (short identifiers) and writes a
 * formula over them; the formula is validated live by the same safe evaluator
 * the student uses, so a bad formula is caught at author time (and can never
 * execute — Axiom 9). Single calculator for v1.1; `null` means none.
 */
export function CalculatorEditor({ value, onChange }: CalculatorEditorProps) {
  const t = useT("CalculatorEditor");
  const nextKey = useRef(1);

  if (!value) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            {t("optional")} <FormulaHelp />
          </span>
          <button
            type="button"
            onClick={() =>
              onChange({
                title: "",
                formula: "",
                inputs: [{ key: nextKey.current++, id: "", label: "", unit: "" }],
              })
            }
            className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" /> {t("add")}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          {t.rich("intro", { code })}
        </p>
      </div>
    );
  }

  const setInput = (key: number, patch: Partial<CalcInputRow>) =>
    onChange({ ...value, inputs: value.inputs.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  const removeInput = (key: number) =>
    onChange({ ...value, inputs: value.inputs.filter((i) => i.key !== key) });
  const addInput = () =>
    onChange({ ...value, inputs: [...value.inputs, { key: nextKey.current++, id: "", label: "", unit: "" }] });

  const validIds = value.inputs.map((i) => i.id.trim()).filter((id) => ID_RE.test(id));
  const formulaCheck = value.formula.trim() ? validateFormula(value.formula, validIds) : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <CalcIcon className="h-4 w-4 text-slate-500" /> {t("title")} <FormulaHelp />
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          {t("remove")}
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">{t("titleLabel")}</span>
        <input
          type="text"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder={t("titlePlaceholder")}
          maxLength={120}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </label>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">{t("variables")}</span>
          <button
            type="button"
            onClick={addInput}
            disabled={value.inputs.length >= MAX_INPUTS}
            className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> {t("addVariable")}
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {value.inputs.map((inp, idx) => {
            const idBad = inp.id.trim() !== "" && !ID_RE.test(inp.id.trim());
            return (
              <li key={inp.key} className="flex items-center gap-2">
                <input
                  type="text"
                  aria-label={t("nameAria", { n: idx + 1 })}
                  value={inp.id}
                  onChange={(e) => setInput(inp.key, { id: e.target.value })}
                  placeholder="var"
                  maxLength={24}
                  className={`w-16 rounded-md border px-2 py-1.5 font-mono text-sm ${idBad ? "border-red-400" : "border-slate-300"}`}
                />
                <input
                  type="text"
                  aria-label={t("labelAria", { n: idx + 1 })}
                  value={inp.label}
                  onChange={(e) => setInput(inp.key, { label: e.target.value })}
                  placeholder={t("labelPlaceholder")}
                  maxLength={80}
                  className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
                <input
                  type="text"
                  aria-label={t("unitAria", { n: idx + 1 })}
                  value={inp.unit}
                  onChange={(e) => setInput(inp.key, { unit: e.target.value })}
                  placeholder={t("unit")}
                  maxLength={24}
                  className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeInput(inp.key)}
                  aria-label={t("removeAria", { n: idx + 1 })}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-slate-400">
          {t("nameRule")}
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">{t("formula")}</span>
        <input
          type="text"
          aria-label={t("formula")}
          value={value.formula}
          onChange={(e) => onChange({ ...value, formula: e.target.value })}
          placeholder={t("formulaPlaceholder")}
          maxLength={200}
          className="rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm"
        />
        {formulaCheck && !formulaCheck.ok ? (
          <span role="alert" className="text-xs text-red-600">
            {formulaCheck.code ? t(`formula_${formulaCheck.code}`, formulaCheck.values) : formulaCheck.error}
          </span>
        ) : formulaCheck?.ok ? (
          <span className="text-xs text-green-600">{t("formulaOk")}</span>
        ) : (
          <span className="text-xs text-slate-400">
            {t.rich("formulaHint", { code })}
          </span>
        )}
      </label>
    </div>
  );
}
