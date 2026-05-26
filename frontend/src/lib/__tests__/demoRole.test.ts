import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDemoRole, setDemoRole } from "@/lib/demoRole";

describe("demoRole helper", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(getDemoRole()).toBeNull();
  });

  it("round-trips student", () => {
    setDemoRole("student");
    expect(getDemoRole()).toBe("student");
  });

  it("round-trips teacher", () => {
    setDemoRole("teacher");
    expect(getDemoRole()).toBe("teacher");
  });

  it("returns null for unrecognised stored values", () => {
    window.sessionStorage.setItem("aipla_demo_role", "admin");
    expect(getDemoRole()).toBeNull();
  });
});
