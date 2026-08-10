/**
 * The voice line renders on USAGE, not on cost.
 *
 * Both dashboard surfaces gated on `voice_eur > 0`, which hid a real bug for
 * weeks: the Gemini tier carries ~100% of read-aloud traffic and had no rate
 * in the cost table, so it priced to zero, so the line never rendered — and a
 * missing row reads as "no voice used", not as "voice we failed to price".
 *
 * Keying on volume makes a zero visible and therefore fixable, and correctly
 * covers browser TTS, which is genuinely free but genuinely used.
 */

import { describe, expect, it } from "vitest";

import { usedVoice } from "@/lib/costApi";

const none = { voice_eur: 0, voice_units: 0, by_voice_kind: [] };

describe("usedVoice", () => {
  it("is false when no voice was used", () => {
    expect(usedVoice(none)).toBe(false);
  });

  it("is true when voice cost money", () => {
    expect(
      usedVoice({ voice_eur: 1.23, voice_units: 45000, by_voice_kind: [] }),
    ).toBe(true);
  });

  it("is TRUE when voice was used but priced at zero", () => {
    // The regression. A free tier (browser TTS) and a mispriced one are both
    // "someone pressed play"; neither is "nobody did".
    expect(
      usedVoice({ voice_eur: 0, voice_units: 45000, by_voice_kind: [] }),
    ).toBe(true);
  });

  it("finds usage in the per-kind breakdown when the total is missing", () => {
    expect(
      usedVoice({
        voice_eur: 0,
        by_voice_kind: [{ kind: "tts", eur: 0, units: 12000 }],
      }),
    ).toBe(true);
  });

  it("falls back to cost for a backend that predates voice_units", () => {
    // Rolling deploys mean the frontend can be newer than the API for a while.
    expect(usedVoice({ voice_eur: 0.4, by_voice_kind: [] })).toBe(true);
    expect(usedVoice({ voice_eur: 0, by_voice_kind: [] })).toBe(false);
  });
});
