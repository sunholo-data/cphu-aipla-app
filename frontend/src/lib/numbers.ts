/**
 * Numbers a student TYPES, in either decimal convention (1.1.136).
 *
 * Neutral home (no React, no surface) because three things read student-typed
 * numbers and must agree: the workbench chart, the teacher's re-rendered chart,
 * and the calculator. Danish writes a decimal comma; every one of them used to
 * read "3,42" wrongly — the chart as 3 (`parseFloat`), the calculator as
 * nothing at all (`Number`).
 */

import type { LocaleMode } from "@/i18n/locale";

/** Space characters a thousands group may be separated by: space, no-break
 *  space, narrow no-break space (what a Danish locale formatter emits). */
const GROUP_SPACE = "[ \\u00a0\\u202f]";

/** "1 234" / "-12 345,5" — digits grouped in threes by a SPACE. Unambiguous:
 *  a space is never a decimal separator. */
const SPACE_GROUPED = new RegExp(`^([-+]?)(\\d{1,3}(?:${GROUP_SPACE}\\d{3})+)([.,]\\d+)?((?:[eE][-+]?\\d+)?)$`);

/** A plain number with ONE optional decimal separator, either "." or ",". */
const PLAIN = /^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][-+]?\d+)?$/;

/**
 * A table cell → a number, or `NaN` when the cell is not one.
 *
 * Danish writes a decimal COMMA. `parseFloat("3,42")` is 3 — not NaN — so the
 * chart used to plot a silently WRONG point rather than no point (29 Sep:
 * "different decimal conventions were an issue"). Rules:
 *
 * - "3,42" and "3.42" are both 3.42; "-0,5" is -0.5; surrounding whitespace and
 *   a typographic minus (U+2212) are tolerated.
 * - A thousands separator is accepted only where it cannot be misread: digits
 *   grouped in threes by a space ("1 234,5" → 1234.5).
 * - "1,234" is read as 1.234 — the comma is a decimal separator, as in every
 *   other Danish number. We do not guess that it might be a thousands group.
 * - Mixed separators ("1.234,5", "1,234.5") are ambiguous → NaN, as is anything
 *   with trailing text ("12abc", "3 m"), which `parseFloat` used to read as a
 *   number. A cell that is not a number is not a point.
 */
export function parseCellNumber(raw: string | null | undefined): number {
  if (raw == null) return NaN;
  let s = raw.trim().replace(/^−/, "-");
  if (s === "") return NaN;
  const grouped = SPACE_GROUPED.exec(s);
  if (grouped) {
    s = grouped[1] + grouped[2].replace(new RegExp(GROUP_SPACE, "g"), "") + (grouped[3] ?? "") + grouped[4];
  }
  if (!PLAIN.test(s)) return NaN;
  return Number(s.replace(",", "."));
}

/**
 * A computed number for display: float noise trimmed (6 significant digits, no
 * forced decimals), with a decimal COMMA when the surface is Danish. Bilingual
 * and English surfaces get a dot. For what a person reads only — anything sent
 * to the tutor or stored keeps the dot form, which every reader can parse.
 */
export function formatDecimal(n: number, mode: LocaleMode): string {
  const plain = String(Number(n.toPrecision(6)));
  return mode === "da" ? plain.replace(".", ",") : plain;
}
