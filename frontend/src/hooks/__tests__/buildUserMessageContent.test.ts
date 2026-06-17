import { describe, expect, it } from "vitest";

import { buildUserMessageContent } from "../useSkillAgent";

const img = (data: string, mimeType = "image/jpeg") => ({ mimeType, data, name: "x.jpg" });

describe("buildUserMessageContent", () => {
  it("returns a plain string when there are no attachments", () => {
    expect(buildUserMessageContent("hello")).toBe("hello");
    expect(buildUserMessageContent("hello", [])).toBe("hello");
  });

  it("builds a native AG-UI multimodal array with a text part + image parts", () => {
    const out = buildUserMessageContent("what is this?", [img("QUJD")]);
    expect(Array.isArray(out)).toBe(true);
    const parts = out as Array<Record<string, unknown>>;
    expect(parts[0]).toEqual({ type: "text", text: "what is this?" });
    expect(parts[1]).toEqual({
      type: "image",
      source: { type: "data", value: "QUJD", mimeType: "image/jpeg" },
    });
  });

  it("omits the text part on an image-only turn", () => {
    const parts = buildUserMessageContent("", [img("QUJD")]) as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(1);
    expect((parts[0] as { type: string }).type).toBe("image");
  });

  it("preserves order and mime for multiple images", () => {
    const parts = buildUserMessageContent("two", [
      img("AAA", "image/png"),
      img("BBB", "image/webp"),
    ]) as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(3);
    expect((parts[1] as { source: { mimeType: string } }).source.mimeType).toBe("image/png");
    expect((parts[2] as { source: { value: string } }).source.value).toBe("BBB");
  });

  it("emits an audio part for an audio/* attachment (1.1.37 — the tutor hears it)", () => {
    const parts = buildUserMessageContent("", [
      { mimeType: "audio/wav", data: "QUlV", name: "voice.wav" },
    ]) as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({
      type: "audio",
      source: { type: "data", value: "QUlV", mimeType: "audio/wav" },
    });
  });

  it("chooses the part type per attachment mime (image vs audio) in one turn", () => {
    const parts = buildUserMessageContent("see + hear", [
      img("IMG", "image/png"),
      { mimeType: "audio/wav", data: "AUD", name: "v.wav" },
    ]) as Array<Record<string, unknown>>;
    expect((parts[1] as { type: string }).type).toBe("image");
    expect((parts[2] as { type: string }).type).toBe("audio");
  });
});
