import { describe, expect, it } from "vitest";

import { TEACHER_SIM_CSP, teacherSimPageUrl, withTeacherSimLockdown } from "@/lib/teacherSimPage";

describe("teacher sim page", () => {
  it("puts the no-network CSP first in <head>, before any script", () => {
    const out = withTeacherSimLockdown('<!doctype html><html><head><script>x()</script></head></html>');
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<script>"));
    expect(out).toContain(TEACHER_SIM_CSP);
    expect(TEACHER_SIM_CSP).toContain("connect-src 'none'");
  });

  it("still leads the page when there is no <head>", () => {
    expect(withTeacherSimLockdown("<!doctype html><script>x()</script>")).toMatch(
      /^<!doctype html><meta http-equiv="Content-Security-Policy"/,
    );
  });

  it("maps only a teacher-sim path to the backend page route", () => {
    expect(teacherSimPageUrl("teacher-sims/otto-mine/v2")).toBe("/api/proxy/api/teacher-sims/otto-mine/v2/index.html");
    expect(teacherSimPageUrl("boldkast/v1")).toBeNull();
    expect(teacherSimPageUrl("teacher-sims/../x/v1")).toBeNull();
  });
});
