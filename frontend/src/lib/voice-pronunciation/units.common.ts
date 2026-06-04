/**
 * Voice pronunciation rules — common (language-agnostic).
 *
 * Applied BEFORE language-specific rules. Currently just decimal-comma
 * normalisation so "9,82" becomes "9.82" and Cloud TTS reads it as
 * "nine point eight two" instead of "nine comma eight two" in either
 * language.
 *
 * Authoring guide: docs/ops/voice-pronunciation-runbook.md (1.1.14).
 */

import type { PronunciationRuleset } from "./types";

export const COMMON_RULESET: PronunciationRuleset = {
  version: 1,
  language: "common",
  rules: [
    {
      id: "decimal_comma_to_period",
      category: "math",
      pattern: "(\\d),(\\d)",
      replacement: "$1.$2",
    },
  ],
};
