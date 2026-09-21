import { describe, expect, it } from "vitest";

import { classStage, describeStage, stageTone } from "@/lib/onboardingStage";

describe("onboardingStage (1.1.124)", () => {
  it("says the stage and how long they have sat there", () => {
    expect(describeStage({ stage: "demo_only", since: null, days: 9, nextStep: "x" })).toBe("Demo only — 9 days");
    expect(describeStage({ stage: "invited", since: null, days: 0, nextStep: "x" })).toBe("Invited — not signed in — today");
    expect(describeStage({ stage: "waiting", since: null, days: 1, nextStep: "x" })).toBe("Waiting for students — 1 day");
    expect(describeStage({ stage: "live", since: null, days: 4, nextStep: null })).toBe("Live");
    expect(describeStage({ stage: "no_code", since: null, days: null, nextStep: "x" })).toBe("No join code");
  });

  it("colours the stuck-shaped stages amber, waiting neutral, live green", () => {
    expect(stageTone("invited")).toBe("amber");
    expect(stageTone("no_activity")).toBe("amber");
    expect(stageTone("waiting")).toBe("muted");
    expect(stageTone("live")).toBe("green");
  });

  it("derives a single class's stage from what the row holds", () => {
    const base = { name: "Fysik", groupCodes: [] as string[], activityIds: [] as string[] };
    expect(classStage({ ...base, demo: true }, undefined)).toBe("demo_only");
    expect(classStage({ ...base, name: "Demo class" }, undefined)).toBe("demo_only");
    expect(classStage(base, undefined)).toBe("no_code");
    expect(classStage({ ...base, groupCodes: ["k"] }, undefined)).toBe("no_activity");
    expect(classStage({ ...base, groupCodes: ["k"], activityIds: ["a"] }, { turns: 0 })).toBe("waiting");
    expect(classStage({ ...base, groupCodes: ["k"], activityIds: ["a"] }, { turns: 3 })).toBe("live");
  });
});
