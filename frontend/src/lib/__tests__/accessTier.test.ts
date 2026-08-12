import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetAccessTierForTests,
  getAccessTier,
  isSpendDenied,
  isVisitor,
  setAccessTier,
  SPEND_DENIED_STATUS,
  subscribeAccessTier,
  TIER_PILOT,
  TIER_VISITOR,
} from "@/lib/accessTier";

/**
 * ACCESS-1 M4. The client never decides eligibility — the backend does, from a
 * signed claim. These pin the two things the client IS responsible for:
 * defaulting to the safe tier, and recognising the gate by status rather than
 * by message text.
 */
describe("accessTier", () => {
  beforeEach(() => {
    __resetAccessTierForTests();
  });

  it("defaults to visitor before the backend has said anything", () => {
    expect(getAccessTier()).toBe(TIER_VISITOR);
    expect(isVisitor()).toBe(true);
  });

  it("records a pilot tier reported by bootstrap", () => {
    setAccessTier("pilot");
    expect(getAccessTier()).toBe(TIER_PILOT);
    expect(isVisitor()).toBe(false);
  });

  it("treats anything unrecognised as visitor", () => {
    setAccessTier("pilot");
    setAccessTier("superuser");
    expect(getAccessTier()).toBe(TIER_VISITOR);
  });

  it("treats an absent tier as visitor", () => {
    setAccessTier("pilot");
    setAccessTier(undefined);
    expect(getAccessTier()).toBe(TIER_VISITOR);
  });

  it("notifies subscribers on change, and only on change", () => {
    const seen = vi.fn();
    subscribeAccessTier(seen);

    setAccessTier("pilot");
    expect(seen).toHaveBeenCalledWith(TIER_PILOT);

    setAccessTier("pilot"); // no change
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes cleanly", () => {
    const seen = vi.fn();
    const off = subscribeAccessTier(seen);
    off();
    setAccessTier("pilot");
    expect(seen).not.toHaveBeenCalled();
  });

  describe("isSpendDenied", () => {
    it("recognises 402 by status, not by message", () => {
      expect(isSpendDenied({ status: SPEND_DENIED_STATUS })).toBe(true);
      expect(SPEND_DENIED_STATUS).toBe(402);
    });

    it("does NOT treat 403 as the spend gate", () => {
      // 403 means "you are the wrong kind of user"; 402 means "you are the
      // right kind, you just are not in the programme". Conflating them would
      // show a join-the-programme nudge to an anonymous student who hit a
      // teacher-only route.
      expect(isSpendDenied({ status: 403 })).toBe(false);
    });

    it("does not fire on success or on unrelated errors", () => {
      expect(isSpendDenied({ status: 200 })).toBe(false);
      expect(isSpendDenied({ status: 401 })).toBe(false);
      expect(isSpendDenied({ status: 500 })).toBe(false);
    });
  });
});
