/**
 * Voice pronunciation rules — English.
 *
 * Sibling: units.da.ts — every `id` here MUST exist there too.
 * Asserted at module-init by the parity check in index.ts.
 *
 * Order matters: longer patterns first so "m/s²" matches before "m/s"
 * and "²" individually.
 *
 * Word-boundary lookaheads `(?![a-z])` on single-letter units (N, J,
 * W, g, m, s) prevent matching mid-word ("Newton", "magnetic" etc.) —
 * they only fire after a digit + optional space.
 *
 * Authoring guide: docs/ops/voice-pronunciation-runbook.md (1.1.14).
 */

import type { PronunciationRuleset } from "./types";

export const EN_RULESET: PronunciationRuleset = {
  version: 1,
  language: "en",
  rules: [
    // --- Speed + acceleration (longer matches first) ---
    {
      id: "m_per_s2",
      category: "kinematics",
      pattern: "(\\d[\\d.]*)\\s*m\\/s²",
      replacement: "$1 meters per second squared",
    },
    {
      id: "m_per_s2_caret",
      category: "kinematics",
      pattern: "(\\d[\\d.]*)\\s*m\\/s\\^2",
      replacement: "$1 meters per second squared",
    },
    {
      id: "km_per_h",
      category: "kinematics",
      pattern: "(\\d[\\d.]*)\\s*km\\/h",
      replacement: "$1 kilometers per hour",
    },
    {
      id: "m_per_s",
      category: "kinematics",
      pattern: "(\\d[\\d.]*)\\s*m\\/s",
      replacement: "$1 meters per second",
    },
    // --- Force + energy + power ---
    {
      id: "kN",
      category: "force",
      pattern: "(\\d[\\d.]*)\\s*kN",
      replacement: "$1 kilonewtons",
    },
    {
      id: "N",
      category: "force",
      pattern: "(\\d[\\d.]*)\\s*N(?![a-z])",
      replacement: "$1 newtons",
    },
    {
      id: "kJ",
      category: "energy",
      pattern: "(\\d[\\d.]*)\\s*kJ",
      replacement: "$1 kilojoules",
    },
    {
      id: "J",
      category: "energy",
      pattern: "(\\d[\\d.]*)\\s*J(?![a-z])",
      replacement: "$1 joules",
    },
    {
      id: "kW",
      category: "power",
      pattern: "(\\d[\\d.]*)\\s*kW",
      replacement: "$1 kilowatts",
    },
    {
      id: "W",
      category: "power",
      pattern: "(\\d[\\d.]*)\\s*W(?![a-z])",
      replacement: "$1 watts",
    },
    // --- Mass + distance + time ---
    {
      id: "kg",
      category: "mass",
      pattern: "(\\d[\\d.]*)\\s*kg(?![a-z])",
      replacement: "$1 kilograms",
    },
    {
      id: "g",
      category: "mass",
      pattern: "(\\d[\\d.]*)\\s*g(?![a-z])",
      replacement: "$1 grams",
    },
    {
      id: "km",
      category: "distance",
      pattern: "(\\d[\\d.]*)\\s*km(?![a-z])",
      replacement: "$1 kilometers",
    },
    {
      id: "cm",
      category: "distance",
      pattern: "(\\d[\\d.]*)\\s*cm(?![a-z])",
      replacement: "$1 centimeters",
    },
    {
      id: "mm",
      category: "distance",
      pattern: "(\\d[\\d.]*)\\s*mm(?![a-z])",
      replacement: "$1 millimeters",
    },
    {
      id: "m",
      category: "distance",
      pattern: "(\\d[\\d.]*)\\s*m(?![a-z\\/])",
      replacement: "$1 meters",
    },
    {
      id: "min",
      category: "time",
      pattern: "(\\d[\\d.]*)\\s*min(?![a-z])",
      replacement: "$1 minutes",
    },
    {
      id: "s",
      category: "time",
      pattern: "(\\d[\\d.]*)\\s*s(?![a-z])",
      replacement: "$1 seconds",
    },
    // --- Temperature ---
    {
      id: "celsius",
      category: "temperature",
      pattern: "(\\d[\\d.]*)\\s*°C",
      replacement: "$1 degrees Celsius",
    },
    {
      id: "degrees",
      category: "temperature",
      pattern: "(\\d[\\d.]*)\\s*°",
      replacement: "$1 degrees",
    },
    // --- Standalone math decorators ---
    {
      id: "superscript_2",
      category: "math",
      pattern: "²",
      replacement: " squared",
    },
    {
      id: "superscript_3",
      category: "math",
      pattern: "³",
      replacement: " cubed",
    },
    {
      id: "plus_minus",
      category: "math",
      pattern: "±",
      replacement: " plus or minus ",
    },
    {
      id: "approximately",
      category: "math",
      pattern: "≈",
      replacement: " approximately ",
    },
    {
      id: "not_equal",
      category: "math",
      pattern: "≠",
      replacement: " not equal to ",
    },
    {
      id: "less_or_equal",
      category: "math",
      pattern: "≤",
      replacement: " less than or equal to ",
    },
    {
      id: "greater_or_equal",
      category: "math",
      pattern: "≥",
      replacement: " greater than or equal to ",
    },
    {
      id: "times",
      category: "math",
      pattern: "×",
      replacement: " times ",
    },
    {
      id: "divided_by",
      category: "math",
      pattern: "÷",
      replacement: " divided by ",
    },
  ],
};
