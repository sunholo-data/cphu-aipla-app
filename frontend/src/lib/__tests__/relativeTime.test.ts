import { describe, it, expect, vi } from "vitest";

import {
  formatRelativeTime,
  formatRelativeTimeCompact,
  formatAbsoluteTime,
} from "@/lib/relativeTime";

const NOW = Date.parse("2026-06-16T12:00:00Z");
const DAY = 24 * 3600_000;

describe("formatRelativeTime (en)", () => {
  it("'just now' under ~45s (incl. minor future skew)", () => {
    expect(formatRelativeTime(NOW - 10_000, NOW, "en")).toBe("just now");
    expect(formatRelativeTime(NOW + 5_000, NOW, "en")).toBe("just now");
  });

  it("minutes / hours ago", () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW, "en")).toMatch(/minute/);
    expect(formatRelativeTime(NOW - 3 * 3600_000, NOW, "en")).toMatch(/hour/);
  });

  it("'yesterday' at 1 day, '3 days ago' at 3 days (disambiguates across days)", () => {
    expect(formatRelativeTime(NOW - DAY, NOW, "en")).toMatch(/yesterday/i);
    expect(formatRelativeTime(NOW - 3 * DAY, NOW, "en")).toMatch(/3\s*days?\s*ago/i);
  });

  it("falls back to an absolute short date past a week (not 'N weeks ago')", () => {
    const out = formatRelativeTime(NOW - 30 * DAY, NOW, "en");
    expect(out).not.toMatch(/ago/i);
    expect(out).toMatch(/\d/);
  });

  it("normalises epoch SECONDS identically to ms (history sends seconds)", () => {
    const ms = NOW - 3 * DAY;
    expect(formatRelativeTime(ms / 1000, NOW, "en")).toBe(formatRelativeTime(ms, NOW, "en"));
  });

  it("accepts an ISO string (the session lists store ISO timestamps)", () => {
    const iso = new Date(NOW - 5 * 60_000).toISOString();
    expect(formatRelativeTime(iso, NOW, "en")).toMatch(/minute/);
  });

  it("returns '' on an unparseable input rather than 'NaN ...'", () => {
    expect(formatRelativeTime("not-a-date", NOW, "en")).toBe("");
  });
});

describe("formatRelativeTime (da) — 1.1.108: the activity's language, not the browser's", () => {
  it("defaults to Danish when no locale is given", () => {
    expect(formatRelativeTime(NOW - 10_000, NOW)).toBe("lige nu");
  });

  it("speaks Danish for minutes, hours and days", () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW, "da")).toMatch(/minutter siden/);
    expect(formatRelativeTime(NOW - 3 * 3600_000, NOW, "da")).toMatch(/timer siden/);
    expect(formatRelativeTime(NOW - DAY, NOW, "da")).toMatch(/i går/i);
    expect(formatRelativeTime(NOW - 3 * DAY, NOW, "da")).toMatch(/3 dage siden/);
  });

  it("formats the past-a-week fallback date in Danish", () => {
    expect(formatRelativeTime(NOW - 30 * DAY, NOW, "da")).toMatch(/maj/);
    expect(formatRelativeTime(NOW - 30 * DAY, NOW, "en")).toMatch(/May/);
  });

  it("never reads the browser's language", () => {
    // Same input, same locale → same output, whatever navigator says.
    const before = formatRelativeTime(NOW - 3 * DAY, NOW, "en");
    const spy = vi.spyOn(navigator, "language", "get").mockReturnValue("da-DK");
    expect(formatRelativeTime(NOW - 3 * DAY, NOW, "en")).toBe(before);
    spy.mockRestore();
  });
});

describe("formatRelativeTimeCompact", () => {
  it("'just now' under a minute", () => {
    expect(formatRelativeTimeCompact(NOW - 30_000, NOW)).toBe("just now");
  });

  it("compact units: Xm / Xh / Xd ago", () => {
    expect(formatRelativeTimeCompact(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(formatRelativeTimeCompact(NOW - 3 * 3600_000, NOW)).toBe("3h ago");
    expect(formatRelativeTimeCompact(NOW - 2 * DAY, NOW)).toBe("2d ago");
  });

  it("does NOT fall back to an absolute date past a week (stays 'Nd ago')", () => {
    expect(formatRelativeTimeCompact(NOW - 30 * DAY, NOW)).toBe("30d ago");
  });

  it("accepts an ISO string and returns '' on garbage", () => {
    const iso = new Date(NOW - 2 * 3600_000).toISOString();
    expect(formatRelativeTimeCompact(iso, NOW)).toBe("2h ago");
    expect(formatRelativeTimeCompact("nope", NOW)).toBe("");
  });
});

describe("formatAbsoluteTime", () => {
  it("renders a full date + time for the tooltip", () => {
    const out = formatAbsoluteTime(NOW, "en");
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/\d{1,2}:\d{2}/);
    // Danish writes the time with a dot (15.42) and abbreviates the month.
    expect(formatAbsoluteTime(NOW, "da")).toMatch(/2026.*\d{1,2}\.\d{2}/);
  });

  it("normalises seconds and ms to the same output", () => {
    expect(formatAbsoluteTime(NOW / 1000)).toBe(formatAbsoluteTime(NOW));
  });
});
