import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_RATIOS,
  RATIO_DEFAULT,
  RATIO_MAX,
  RATIO_MIN,
  readStoredRatio,
  useResizableWorkspaceRatio,
} from "../useResizableWorkspaceRatio";

describe("useResizableWorkspaceRatio", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("starts at the per-skill default when no value is stored", () => {
    const { result } = renderHook(() =>
      useResizableWorkspaceRatio("led-planck-tutor"),
    );
    expect(result.current.ratio).toBe(DEFAULT_RATIOS["led-planck-tutor"]);
  });

  it("falls back to RATIO_DEFAULT for an unknown skillId", () => {
    const { result } = renderHook(() =>
      useResizableWorkspaceRatio("some-unknown-skill"),
    );
    expect(result.current.ratio).toBe(RATIO_DEFAULT);
  });

  it("reads a previously stored ratio on mount", () => {
    window.sessionStorage.setItem("aipla.workspaceRatio:led-planck-tutor", "0.72");
    const { result } = renderHook(() =>
      useResizableWorkspaceRatio("led-planck-tutor"),
    );
    expect(result.current.ratio).toBe(0.72);
  });

  it("setRatio writes to sessionStorage", () => {
    const { result } = renderHook(() =>
      useResizableWorkspaceRatio("problem-set-hints"),
    );
    act(() => {
      result.current.setRatio(0.85);
    });
    expect(result.current.ratio).toBe(0.85);
    expect(
      window.sessionStorage.getItem("aipla.workspaceRatio:problem-set-hints"),
    ).toBe("0.85");
  });

  it("clamps setRatio writes into [RATIO_MIN, RATIO_MAX]", () => {
    const { result } = renderHook(() =>
      useResizableWorkspaceRatio("problem-set-hints"),
    );
    act(() => {
      result.current.setRatio(2.0); // overshoot
    });
    expect(result.current.ratio).toBe(RATIO_MAX);
    act(() => {
      result.current.setRatio(0.1); // undershoot
    });
    expect(result.current.ratio).toBe(RATIO_MIN);
  });

  it("ignores malformed stored values + uses default fallback", () => {
    window.sessionStorage.setItem(
      "aipla.workspaceRatio:problem-set-hints",
      "not-a-number",
    );
    const { result } = renderHook(() =>
      useResizableWorkspaceRatio("problem-set-hints"),
    );
    expect(result.current.ratio).toBe(DEFAULT_RATIOS["problem-set-hints"]);
  });

  it("ignores stored values outside [RATIO_MIN, RATIO_MAX]", () => {
    window.sessionStorage.setItem(
      "aipla.workspaceRatio:problem-set-hints",
      "1.5",
    );
    const { result } = renderHook(() =>
      useResizableWorkspaceRatio("problem-set-hints"),
    );
    expect(result.current.ratio).toBe(DEFAULT_RATIOS["problem-set-hints"]);
  });

  it("readStoredRatio returns null when no value is stored", () => {
    expect(readStoredRatio("anything")).toBeNull();
  });

  it("DEFAULT_RATIOS contains the three live skills", () => {
    expect(DEFAULT_RATIOS["problem-set-hints"]).toBe(0.5);
    expect(DEFAULT_RATIOS["led-planck-tutor"]).toBe(0.55);
    expect(DEFAULT_RATIOS["kinebot"]).toBe(0.65);
  });
});
