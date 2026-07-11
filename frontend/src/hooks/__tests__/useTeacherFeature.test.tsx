// SETTINGS-1 M2 — the tri-state feature hook + the language seed rule.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithTeacherAuth: (...args: unknown[]) => mockFetch(...args),
}));

import { useTeacherFeature } from "../useTeacherFeature";
import { languageSeed } from "../useTeacherPrefs";

beforeEach(() => mockFetch.mockReset());

describe("useTeacherFeature (tri-state, 1.1.58)", () => {
  it("'1' is on for everyone and never fetches prefs", () => {
    const { result } = renderHook(() => useTeacherFeature("x", "1"));
    expect(result.current).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("'' / unset is off for everyone and never fetches", () => {
    expect(renderHook(() => useTeacherFeature("x", "")).result.current).toBe(false);
    expect(renderHook(() => useTeacherFeature("x", undefined)).result.current).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("'beta' follows the teacher's opt-in", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ features: { x: true } }) } as Response);
    const { result } = renderHook(() => useTeacherFeature("x", "beta"));
    expect(result.current).toBe(false); // until prefs resolve
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("'beta' without an opt-in (or on fetch failure) stays off", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ features: {} }) } as Response);
    const { result } = renderHook(() => useTeacherFeature("x", "beta"));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});

describe("languageSeed (the anti-fight rule)", () => {
  const UNTOUCHED = { language: "da", title: "", teachingGoal: "" };

  it("seeds an untouched form from the default", () => {
    expect(languageSeed({ defaultLanguage: "en" }, UNTOUCHED)).toBe("en");
  });

  it("never seeds without a default, or when nothing would change", () => {
    expect(languageSeed({}, UNTOUCHED)).toBeNull();
    expect(languageSeed({ defaultLanguage: "da" }, UNTOUCHED)).toBeNull();
  });

  it("never overrides a touched form (explicit choice or typed content)", () => {
    expect(languageSeed({ defaultLanguage: "en" }, { ...UNTOUCHED, language: "en" })).toBeNull();
    expect(languageSeed({ defaultLanguage: "en" }, { ...UNTOUCHED, title: "Kast" })).toBeNull();
    expect(languageSeed({ defaultLanguage: "en" }, { ...UNTOUCHED, teachingGoal: "..." })).toBeNull();
  });
});
