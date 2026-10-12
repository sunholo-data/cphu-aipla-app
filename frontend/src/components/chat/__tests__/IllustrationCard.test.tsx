import { describe, expect, it } from "vitest";

import { parseIllustrationResult } from "../IllustrationCard";

/**
 * The illustrator's diagram reaches the student from the tool result, because
 * the tutor dropped its pasted copy two times in three in live runs. If this
 * parse returns null, the student gets a chip and no diagram — the feature
 * failing quietly.
 */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160"><line x1="0" y1="0" x2="1" y2="1"/></svg>';

describe("parseIllustrationResult", () => {
  it("reads the AgentTool result shape", () => {
    expect(parseIllustrationResult(JSON.stringify({ result: "```svg\n" + SVG + "\n```" }))).toBe(SVG);
  });

  it("tolerates a bare svg without a fence, and a non-JSON payload", () => {
    expect(parseIllustrationResult(JSON.stringify({ result: SVG }))).toBe(SVG);
    expect(parseIllustrationResult("```svg\n" + SVG + "\n```")).toBe(SVG);
  });

  it("returns null when there is no diagram, so the chip shows instead", () => {
    expect(parseIllustrationResult(JSON.stringify({ result: "I could not draw that." }))).toBeNull();
    expect(parseIllustrationResult(JSON.stringify({ redacted: "server-only tool result" }))).toBeNull();
    expect(parseIllustrationResult(null)).toBeNull();
  });
});
