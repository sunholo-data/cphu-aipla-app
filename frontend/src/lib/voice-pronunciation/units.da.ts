/**
 * Voice pronunciation rules — Danish (da-DK).
 *
 * Sibling: units.en.ts — every `id` there MUST exist here too.
 * Asserted at module-init by the parity check in index.ts.
 *
 * Word-boundary lookaheads `(?![a-zæøå])` cover Danish letters so
 * "Newton" / "joulemåler" etc. don't accidentally trigger the
 * single-letter unit rules.
 *
 * Authoring guide: docs/ops/voice-pronunciation-runbook.md (1.1.14).
 */

import type { PronunciationRuleset } from "./types";

export const DA_RULESET: PronunciationRuleset = {
  version: 1,
  language: "da",
  rules: [
    // --- Speed + acceleration ---
    {
      id: "m_per_s2",
      category: "kinematics",
      pattern: "(\\d[\\d.]*)\\s*m\\/s²",
      replacement: "$1 meter per sekund i anden",
    },
    {
      id: "m_per_s2_caret",
      category: "kinematics",
      pattern: "(\\d[\\d.]*)\\s*m\\/s\\^2",
      replacement: "$1 meter per sekund i anden",
    },
    {
      id: "km_per_h",
      category: "kinematics",
      pattern: "(\\d[\\d.]*)\\s*km\\/h",
      replacement: "$1 kilometer i timen",
    },
    {
      id: "m_per_s",
      category: "kinematics",
      pattern: "(\\d[\\d.]*)\\s*m\\/s",
      replacement: "$1 meter per sekund",
    },
    // --- Force + energy + power ---
    {
      id: "kN",
      category: "force",
      pattern: "(\\d[\\d.]*)\\s*kN",
      replacement: "$1 kilonewton",
    },
    {
      id: "N",
      category: "force",
      pattern: "(\\d[\\d.]*)\\s*N(?![a-zæøå])",
      replacement: "$1 newton",
    },
    {
      id: "kJ",
      category: "energy",
      pattern: "(\\d[\\d.]*)\\s*kJ",
      replacement: "$1 kilojoule",
    },
    {
      id: "J",
      category: "energy",
      pattern: "(\\d[\\d.]*)\\s*J(?![a-zæøå])",
      replacement: "$1 joule",
    },
    {
      id: "kW",
      category: "power",
      pattern: "(\\d[\\d.]*)\\s*kW",
      replacement: "$1 kilowatt",
    },
    {
      id: "W",
      category: "power",
      pattern: "(\\d[\\d.]*)\\s*W(?![a-zæøå])",
      replacement: "$1 watt",
    },
    // --- Mass + distance + time ---
    {
      id: "kg",
      category: "mass",
      pattern: "(\\d[\\d.]*)\\s*kg(?![a-zæøå])",
      replacement: "$1 kilogram",
    },
    {
      id: "g",
      category: "mass",
      pattern: "(\\d[\\d.]*)\\s*g(?![a-zæøå])",
      replacement: "$1 gram",
    },
    {
      id: "km",
      category: "distance",
      pattern: "(\\d[\\d.]*)\\s*km(?![a-zæøå])",
      replacement: "$1 kilometer",
    },
    {
      id: "cm",
      category: "distance",
      pattern: "(\\d[\\d.]*)\\s*cm(?![a-zæøå])",
      replacement: "$1 centimeter",
    },
    {
      id: "mm",
      category: "distance",
      pattern: "(\\d[\\d.]*)\\s*mm(?![a-zæøå])",
      replacement: "$1 millimeter",
    },
    {
      id: "m",
      category: "distance",
      pattern: "(\\d[\\d.]*)\\s*m(?![a-zæøå\\/])",
      replacement: "$1 meter",
    },
    {
      id: "min",
      category: "time",
      pattern: "(\\d[\\d.]*)\\s*min(?![a-zæøå])",
      replacement: "$1 minutter",
    },
    {
      id: "s",
      category: "time",
      pattern: "(\\d[\\d.]*)\\s*s(?![a-zæøå])",
      replacement: "$1 sekunder",
    },
    // --- Temperature ---
    {
      id: "celsius",
      category: "temperature",
      pattern: "(\\d[\\d.]*)\\s*°C",
      replacement: "$1 grader celsius",
    },
    {
      id: "degrees",
      category: "temperature",
      pattern: "(\\d[\\d.]*)\\s*°",
      replacement: "$1 grader",
    },
    // --- Standalone math decorators ---
    {
      id: "superscript_2",
      category: "math",
      pattern: "²",
      replacement: " i anden",
    },
    {
      id: "superscript_3",
      category: "math",
      pattern: "³",
      replacement: " i tredje",
    },
    {
      id: "plus_minus",
      category: "math",
      pattern: "±",
      replacement: " plus minus ",
    },
    {
      id: "approximately",
      category: "math",
      pattern: "≈",
      replacement: " cirka ",
    },
    {
      id: "not_equal",
      category: "math",
      pattern: "≠",
      replacement: " forskellig fra ",
    },
    {
      id: "less_or_equal",
      category: "math",
      pattern: "≤",
      replacement: " mindre end eller lig ",
    },
    {
      id: "greater_or_equal",
      category: "math",
      pattern: "≥",
      replacement: " større end eller lig ",
    },
    {
      id: "times",
      category: "math",
      pattern: "×",
      replacement: " gange ",
    },
    {
      id: "divided_by",
      category: "math",
      pattern: "÷",
      replacement: " divideret med ",
    },
  ],
};
