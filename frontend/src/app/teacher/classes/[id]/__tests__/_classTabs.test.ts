import { describe, expect, it } from "vitest";

import { LIVE_WINDOW_MS, pickDefaultClassTab } from "../_classTabs";
import { type GroupLiveSignals, groupStatus } from "../_GroupsTable";

const NOW = Date.parse("2026-11-11T10:00:00Z");
const ago = (ms: number) => ({ lastMessageAt: new Date(NOW - ms).toISOString() });

describe("pickDefaultClassTab", () => {
  it("opens on Lesson when a group was active within the live window", () => {
    expect(pickDefaultClassTab({ now: NOW, sessions: [ago(5 * 60_000)] })).toBe("lesson");
    expect(pickDefaultClassTab({ now: NOW, sessions: [ago(LIVE_WINDOW_MS)] })).toBe("lesson");
  });

  it("opens on After once the last activity is older than 90 minutes", () => {
    expect(pickDefaultClassTab({ now: NOW, sessions: [ago(LIVE_WINDOW_MS + 1)] })).toBe("after");
  });

  it("a live group wins even when the session list is stale", () => {
    expect(pickDefaultClassTab({ now: NOW, sessions: [ago(3 * 86_400_000)], liveGroupCount: 1 })).toBe("lesson");
  });

  it("opens on Setup for a class with no sessions at all", () => {
    expect(pickDefaultClassTab({ now: NOW, sessions: [] })).toBe("setup");
  });

  it("treats a failed read as unknown, not as a new class", () => {
    expect(pickDefaultClassTab({ now: NOW, sessions: null })).toBe("lesson");
  });

  it("ignores an unparseable timestamp rather than treating it as now", () => {
    expect(pickDefaultClassTab({ now: NOW, sessions: [{ lastMessageAt: "not a date" }] })).toBe("after");
  });
});

describe("groupStatus", () => {
  const g = (over: Partial<GroupLiveSignals["groups"][number]> = {}) => ({
    groupId: "a-1",
    status: "active",
    turns: 3,
    lastActivityAt: "",
    idleSeconds: 30,
    stuck: false,
    activityTitle: "",
    ...over,
  });

  it("says it does not know when the live poll has not answered", () => {
    expect(groupStatus("a-1", null)).toEqual({ kind: "unknown" });
  });

  it("a raised hand wins over activity", () => {
    expect(groupStatus("a-1", { calls: [{ groupId: "a-1" }], groups: [g()] })).toEqual({ kind: "hand" });
  });

  it("active, quiet (with the stuck flag kept), or not started", () => {
    expect(groupStatus("a-1", { calls: [], groups: [g()] })).toEqual({ kind: "active" });
    expect(groupStatus("a-1", { calls: [], groups: [g({ status: "idle", idleSeconds: 725, stuck: true })] })).toEqual({
      kind: "quiet",
      minutes: 12,
      stuck: true,
    });
    expect(groupStatus("b-2", { calls: [], groups: [g()] })).toEqual({ kind: "not-started" });
  });
});
