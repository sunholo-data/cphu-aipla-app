/**
 * Voice pronunciation rule shape.
 *
 * One rule = one find-and-replace pass applied to the message text
 * before it reaches Cloud TTS. Each language has its own rule list;
 * the same `id` MUST exist in every language's list (parity, asserted
 * at module-init).
 *
 * See voice-pronunciation-config.md (SEQUENCE 1.1.14) for the rationale.
 */
export interface PronunciationRule {
  /** Snake-case canonical key, same across languages. e.g. `m_per_s2`. */
  id: string;
  /** Coarse grouping for the CLI's `--category` filter. */
  category:
    | "kinematics"
    | "mass"
    | "force"
    | "energy"
    | "power"
    | "math"
    | "temperature"
    | "distance"
    | "time";
  /** Regex source string. Compiled with `new RegExp(pattern, "g")`. */
  pattern: string;
  /** Replacement string. Supports backreferences ($1, $2, ...). */
  replacement: string;
}

export interface PronunciationRuleset {
  version: 1;
  language: string;
  rules: PronunciationRule[];
}
