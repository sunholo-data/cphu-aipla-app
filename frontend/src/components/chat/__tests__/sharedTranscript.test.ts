import { describe, expect, it } from "vitest";
import type { SkillMessage } from "@/hooks/useSkillAgent";
import { buildSharedTranscript } from "../sharedTranscript";

const h = (i: number, role: "user" | "assistant", content: string): SkillMessage => ({
  id: `hist-${i}`,
  role,
  content,
});
const l = (id: string, role: "user" | "assistant", content: string): SkillMessage => ({
  id,
  role,
  content,
});

describe("buildSharedTranscript (1.1.145 M2)", () => {
  it("folds this device's live messages into their persisted copies, in history order", () => {
    const history = [
      h(0, "user", "A asks"),
      h(1, "assistant", "answer A"),
      h(2, "user", "B asks"),
      h(3, "assistant", "answer B"),
    ];
    const live = [l("u1", "user", "A asks"), l("a1", "assistant", "answer A")];
    const items = buildSharedTranscript(history, live, 0);
    expect(items.map((it) => it.message.id)).toEqual(["u1", "a1", "hist-2", "hist-3"]);
    expect(items.filter((it) => it.kind === "history" && it.fromGroup).map((it) => it.message.id)).toEqual([
      "hist-2",
    ]);
  });

  it("interleaves a groupmate's turn BETWEEN this device's turns, not after them", () => {
    const history = [
      h(0, "user", "mine 1"),
      h(1, "assistant", "reply 1"),
      h(2, "user", "theirs"),
      h(3, "assistant", "reply theirs"),
      h(4, "user", "mine 2"),
      h(5, "assistant", "reply 2"),
    ];
    const live = [
      l("u1", "user", "mine 1"),
      l("a1", "assistant", "reply 1"),
      l("u2", "user", "mine 2"),
      l("a2", "assistant", "reply 2"),
    ];
    const ids = buildSharedTranscript(history, live, 0).map((it) => it.message.id);
    expect(ids).toEqual(["u1", "a1", "hist-2", "hist-3", "u2", "a2"]);
  });

  it("a live turn not yet persisted follows the transcript", () => {
    const history = [h(0, "user", "theirs")];
    const live = [l("u1", "user", "just sent")];
    const ids = buildSharedTranscript(history, live, 0).map((it) => it.message.id);
    expect(ids).toEqual(["hist-0", "u1"]);
  });

  it("matches across whitespace differences (a reply persisted as joined parts)", () => {
    const history = [h(0, "assistant", "Line one.\n\nLine  two.")];
    const live = [l("a1", "assistant", "Line one. Line two.")];
    const items = buildSharedTranscript(history, live, 0);
    expect(items).toHaveLength(1);
    expect(items[0].message.id).toBe("a1");
  });

  it("history from before this mount never absorbs a live message with the same text", () => {
    // A student typed "ja" before a reload and again now.
    const history = [h(0, "user", "ja"), h(1, "assistant", "ok"), h(2, "user", "ja")];
    const live = [l("u1", "user", "ja")];
    const items = buildSharedTranscript(history, live, 2);
    expect(items.map((it) => it.message.id)).toEqual(["hist-0", "hist-1", "u1"]);
    // Nothing labelled: the baseline is not "new", and index 2 is this device's.
    expect(items.some((it) => it.kind === "history" && it.fromGroup)).toBe(false);
  });

  it("never labels assistant turns, only a groupmate's user turns", () => {
    const history = [h(0, "user", "theirs"), h(1, "assistant", "reply")];
    const items = buildSharedTranscript(history, [], 0);
    expect(items.map((it) => (it.kind === "history" ? it.fromGroup : null))).toEqual([true, false]);
  });

  it("a live tool-only assistant turn (no text) keeps its place", () => {
    const history = [h(0, "user", "mine"), h(1, "assistant", "text reply")];
    const live = [l("u1", "user", "mine"), l("t1", "assistant", ""), l("a1", "assistant", "text reply")];
    const ids = buildSharedTranscript(history, live, 0).map((it) => it.message.id);
    expect(ids).toEqual(["u1", "t1", "a1"]);
  });
});
