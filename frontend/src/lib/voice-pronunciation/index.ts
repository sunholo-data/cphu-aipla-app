/**
 * Voice pronunciation ruleset loader + DA/EN parity guard.
 *
 * Public surface:
 *   - `rulesForLang(lang)` — returns the rules to apply (common first,
 *     then language-specific) for a BCP-47 lang code
 *   - `RULES_VERSION` — string identifier baked at build time, useful
 *     as the `voice.pronunciation_rules_version` OTel span attr
 *
 * Module-init asserts DA/EN parity. If a rule ID is missing from one
 * file, the module throws at import time — the dev server / build
 * fails immediately with the missing-ID list, not at first read-aloud
 * click. This is the build-time validation step from
 * voice-pronunciation-config.md (1.1.14).
 *
 * If you add a new unit:
 *   1. Add to units.en.ts with English replacement
 *   2. Add to units.da.ts with Danish replacement (SAME `id`)
 *   3. Run `npm run test` — the parity test catches missing pairs
 *   4. See docs/ops/voice-pronunciation-runbook.md for the full guide
 */

import type { PronunciationRule, PronunciationRuleset } from "./types";
import { COMMON_RULESET } from "./units.common";
import { DA_RULESET } from "./units.da";
import { EN_RULESET } from "./units.en";

export type { PronunciationRule, PronunciationRuleset } from "./types";

/** Version stamp for telemetry — bump manually when shipping a ruleset
 *  change you want to track on OTel spans. We don't auto-derive from
 *  git because the build doesn't have access to the SHA without extra
 *  webpack config. */
export const RULES_VERSION = "2026-06-04-1";

function assertParity(en: PronunciationRuleset, da: PronunciationRuleset): void {
  const enIds = new Set(en.rules.map((r) => r.id));
  const daIds = new Set(da.rules.map((r) => r.id));
  const missingInDa: string[] = [];
  for (const id of enIds) if (!daIds.has(id)) missingInDa.push(id);
  const missingInEn: string[] = [];
  for (const id of daIds) if (!enIds.has(id)) missingInEn.push(id);
  if (missingInDa.length || missingInEn.length) {
    throw new Error(
      "voice-pronunciation: DA/EN parity check failed. " +
        `Missing in DA: [${missingInDa.join(", ") || "none"}]. ` +
        `Missing in EN: [${missingInEn.join(", ") || "none"}]. ` +
        "Every rule id MUST exist in both units.en.ts and units.da.ts.",
    );
  }
}

function assertUniqueIds(rs: PronunciationRuleset): void {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const r of rs.rules) {
    if (seen.has(r.id)) dupes.push(r.id);
    seen.add(r.id);
  }
  if (dupes.length) {
    throw new Error(
      `voice-pronunciation: duplicate ids in ${rs.language}: [${dupes.join(", ")}]`,
    );
  }
}

function assertRegexCompiles(rs: PronunciationRuleset): void {
  for (const r of rs.rules) {
    try {
      new RegExp(r.pattern, "g");
    } catch (err) {
      throw new Error(
        `voice-pronunciation: rule "${r.id}" in ${rs.language} has invalid regex pattern ${JSON.stringify(r.pattern)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

assertUniqueIds(COMMON_RULESET);
assertUniqueIds(EN_RULESET);
assertUniqueIds(DA_RULESET);
assertRegexCompiles(COMMON_RULESET);
assertRegexCompiles(EN_RULESET);
assertRegexCompiles(DA_RULESET);
assertParity(EN_RULESET, DA_RULESET);

/** Return the rules to apply for a BCP-47 lang. Common rules come
 *  first (decimal-comma → period), then language-specific rules in
 *  their declared order (longer patterns first). */
export function rulesForLang(lang: string): PronunciationRule[] {
  const langRules = lang.startsWith("da") ? DA_RULESET.rules : EN_RULESET.rules;
  return [...COMMON_RULESET.rules, ...langRules];
}

/** All defined ids across both languages — useful for the CLI's
 *  `list` command and for tests asserting coverage of specific units. */
export function allRuleIds(): string[] {
  return Array.from(
    new Set([...EN_RULESET.rules, ...DA_RULESET.rules].map((r) => r.id)),
  ).sort();
}
