import { describe, it, expect } from "vitest";

import { formatRelativeTime, formatAbsoluteTime } from "@/lib/relativeTime";

const NOW = Date.parse("2026-06-16T12:00:00Z");
const DAY = 24 * 3600_000;

describe("formatRelativeTime", () => {
  it("'just now' under ~45s (incl. minor future skew)", () => {
    expect(formatRelativeTime(NOW - 10_000, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe("just now");
  });

  it("minutes / hours ago", () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toMatch(/minute/);
    expect(formatRelativeTime(NOW - 3 * 3600_000, NOW)).toMatch(/hour/);
  });

  it("'yesterday' at 1 day, '3 days ago' at 3 days (disambiguates across days)", () => {
    expect(formatRelativeTime(NOW - DAY, NOW)).toMatch(/yesterday/i);
    expect(formatRelativeTime(NOW - 3 * DAY, NOW)).toMatch(/3\s*days?\s*ago/i);
  });

  it("falls back to an absolute short date past a week (not 'N weeks ago')", () => {
    const out = formatRelativeTime(NOW - 30 * DAY, NOW);
    expect(out).not.toMatch(/ago/i);
    expect(out).toMatch(/\d/);
  });

  it("normalises epoch SECONDS identically to ms (history sends seconds)", () => {
    const ms = NOW - 3 * DAY;
    expect(formatRelativeTime(ms / 1000, NOW)).toBe(formatRelativeTime(ms, NOW));
  });
});

describe("formatAbsoluteTime", () => {
  it("renders a full date + time for the tooltip", () => {
    const out = formatAbsoluteTime(NOW);
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });

  it("normalises seconds and ms to the same output", () => {
    expect(formatAbsoluteTime(NOW / 1000)).toBe(formatAbsoluteTime(NOW));
  });
});
