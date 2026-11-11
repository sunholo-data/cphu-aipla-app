/**
 * /teacher/insights is a redirect since the UI sweep (2026-11-11): Insights
 * opens on Lessons, and the cross-class table it used to show moved to
 * /teacher/insights/classes ("All classes"). Old links must keep working.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

import InsightsIndex from "@/app/teacher/insights/page";

beforeEach(() => redirect.mockReset());

describe("/teacher/insights", () => {
  it("lands on Lessons", async () => {
    await InsightsIndex({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledWith("/teacher/insights/lessons");
  });

  it("sends an old Overview link that carried its window or scope to All classes, keeping them", async () => {
    await InsightsIndex({ searchParams: Promise.resolve({ since: "7d", scope: "all", other: "x" }) });
    expect(redirect).toHaveBeenCalledWith("/teacher/insights/classes?since=7d&scope=all");
  });
});
