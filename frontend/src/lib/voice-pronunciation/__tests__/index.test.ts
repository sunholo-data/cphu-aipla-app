import { describe, expect, it } from "vitest";

import {
  allRuleIds,
  RULES_VERSION,
  rulesForLang,
} from "@/lib/voice-pronunciation";
import { COMMON_RULESET } from "@/lib/voice-pronunciation/units.common";
import { DA_RULESET } from "@/lib/voice-pronunciation/units.da";
import { EN_RULESET } from "@/lib/voice-pronunciation/units.en";

describe("voice-pronunciation loader", () => {
  it("module-init parity check passed (loader imported successfully)", () => {
    // If parity is broken the import above throws and this test never
    // runs. Reaching it means assertParity in index.ts is happy.
    expect(EN_RULESET.rules.length).toBeGreaterThan(0);
    expect(DA_RULESET.rules.length).toBeGreaterThan(0);
  });

  it("EN and DA have the same set of rule ids", () => {
    const enIds = new Set(EN_RULESET.rules.map((r) => r.id));
    const daIds = new Set(DA_RULESET.rules.map((r) => r.id));
    expect([...enIds].sort()).toEqual([...daIds].sort());
  });

  it("every rule id is unique within its language file", () => {
    for (const rs of [COMMON_RULESET, EN_RULESET, DA_RULESET]) {
      const ids = rs.rules.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("every regex pattern compiles", () => {
    for (const rs of [COMMON_RULESET, EN_RULESET, DA_RULESET]) {
      for (const r of rs.rules) {
        expect(() => new RegExp(r.pattern, "g")).not.toThrow();
      }
    }
  });

  it("rulesForLang('da') returns common rules first then DA rules in declared order", () => {
    const rules = rulesForLang("da");
    expect(rules.length).toBe(COMMON_RULESET.rules.length + DA_RULESET.rules.length);
    expect(rules[0]?.id).toBe(COMMON_RULESET.rules[0]?.id);
    expect(rules[COMMON_RULESET.rules.length]?.id).toBe(DA_RULESET.rules[0]?.id);
  });

  it("rulesForLang('da-DK') (full BCP-47) still maps to DA rules via prefix match", () => {
    const rules = rulesForLang("da-DK");
    const daSpecificId = DA_RULESET.rules[0]?.id;
    expect(rules.some((r) => r.id === daSpecificId)).toBe(true);
  });

  it("rulesForLang('en') returns common rules first then EN rules", () => {
    const rules = rulesForLang("en");
    expect(rules[0]?.id).toBe(COMMON_RULESET.rules[0]?.id);
    expect(rules[COMMON_RULESET.rules.length]?.id).toBe(EN_RULESET.rules[0]?.id);
  });

  it("rulesForLang('zu') unknown lang falls through to EN (documented behavior)", () => {
    const rules = rulesForLang("zu");
    expect(rules[COMMON_RULESET.rules.length]?.id).toBe(EN_RULESET.rules[0]?.id);
  });

  it("RULES_VERSION is a non-empty string", () => {
    expect(typeof RULES_VERSION).toBe("string");
    expect(RULES_VERSION.length).toBeGreaterThan(0);
  });

  it("allRuleIds returns a sorted unique list spanning EN + DA", () => {
    const ids = allRuleIds();
    expect(ids).toEqual([...ids].sort());
    // No duplicates.
    expect(new Set(ids).size).toBe(ids.length);
    // Sanity: covers a well-known rule.
    expect(ids).toContain("m_per_s2");
  });

  it("known physics units are present in both files", () => {
    const ids = allRuleIds();
    for (const expected of ["m_per_s2", "kg", "N", "celsius", "superscript_2", "plus_minus"]) {
      expect(ids).toContain(expected);
    }
  });
});
