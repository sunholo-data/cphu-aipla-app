import { describe, expect, it } from "vitest";
import { normalizeGroupCode, safePreviewNext } from "../anonymousGroupAuth";

// 1.1.133
describe("normalizeGroupCode", () => {
  it("keeps a typed code", () => {
    expect(normalizeGroupCode("  bright-fox-42 ")).toBe("BRIGHT-FOX-42");
  });
  it("reduces a pasted join link to its code (prod, 2026-09-22)", () => {
    expect(normalizeGroupCode("https://aipla.ku.dk/group?code=merry-grove-47")).toBe("MERRY-GROVE-47");
    expect(normalizeGroupCode("https://aipla.ku.dk/group?code=preview-a-b-01&next=%2Fchat%2Fx")).toBe(
      "PREVIEW-A-B-01",
    );
  });
});

describe("safePreviewNext", () => {
  it.each([
    ["/chat/concept-dialogue?activity_id=act-1", "/chat/concept-dialogue?activity_id=act-1"],
    [null, null],
    ["/lessons", null],
    ["//evil.example/chat/x", null],
    ["https://evil.example/chat/x", null],
    ["javascript:alert(1)", null],
    ["/chat/\\\\evil", null],
  ])("%s → %s", (input, expected) => {
    expect(safePreviewNext(input)).toBe(expected);
  });
});
