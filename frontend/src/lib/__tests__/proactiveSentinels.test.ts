/**
 * Tests for proactive sentinel detection (sprint PROACTIVE-SIM-REACTIVE M9).
 *
 * The detector is the single point of truth used by useSkillAgent's
 * toSkillMessage filter to drop sentinel-shaped user messages from
 * rendering. Without these tests, a future refactor could silently let
 * `[event_reactive:sim_run]` render as a literal student chat bubble.
 */

import { describe, expect, it } from "vitest";
import {
  PROACTIVE_GREET_SENTINEL,
  eventReactiveSentinel,
  isProactiveSentinel,
} from "@/lib/proactiveSentinels";

describe("isProactiveSentinel", () => {
  it("recognises the Phase A greet sentinel", () => {
    expect(isProactiveSentinel("[session_start]")).toBe(true);
    expect(isProactiveSentinel(PROACTIVE_GREET_SENTINEL)).toBe(true);
  });

  it("recognises the three Phase B event-reactive sentinels", () => {
    expect(isProactiveSentinel("[event_reactive:sim_run]")).toBe(true);
    expect(isProactiveSentinel("[event_reactive:step_advance]")).toBe(true);
    expect(isProactiveSentinel("[event_reactive:measurement_commit]")).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isProactiveSentinel("  [session_start]  ")).toBe(true);
    expect(isProactiveSentinel("\n[event_reactive:sim_run]\n")).toBe(true);
  });

  it("does NOT match regular student chat messages", () => {
    expect(isProactiveSentinel("Hej! Hvad er rækkevidden?")).toBe(false);
    expect(isProactiveSentinel("What's the answer to part b?")).toBe(false);
    expect(isProactiveSentinel("session_start")).toBe(false); // missing brackets
    expect(isProactiveSentinel("[session_start] extra noise")).toBe(false);
  });

  it("does NOT match malformed event-reactive shapes", () => {
    // Defensive: uppercase, hyphens, spaces inside the kind are all
    // malformed and must NOT trip the sentinel filter. Otherwise a
    // student typing brackets could accidentally suppress their own
    // message.
    expect(isProactiveSentinel("[event_reactive:Sim_Run]")).toBe(false);
    expect(isProactiveSentinel("[event_reactive: sim_run]")).toBe(false);
    expect(isProactiveSentinel("[event_reactive:sim-run]")).toBe(false);
    expect(isProactiveSentinel("[event_reactive:]")).toBe(false);
    expect(isProactiveSentinel("[event_reactive]")).toBe(false);
  });

  it("returns false for empty / null / undefined", () => {
    expect(isProactiveSentinel("")).toBe(false);
    expect(isProactiveSentinel(null)).toBe(false);
    expect(isProactiveSentinel(undefined)).toBe(false);
    expect(isProactiveSentinel("   ")).toBe(false);
  });
});

describe("eventReactiveSentinel", () => {
  it("builds the expected sentinel string for each meaningful kind", () => {
    expect(eventReactiveSentinel("sim_run")).toBe("[event_reactive:sim_run]");
    expect(eventReactiveSentinel("step_advance")).toBe("[event_reactive:step_advance]");
    expect(eventReactiveSentinel("measurement_commit")).toBe(
      "[event_reactive:measurement_commit]",
    );
  });

  it("round-trips through isProactiveSentinel", () => {
    for (const kind of ["sim_run", "step_advance", "measurement_commit"]) {
      expect(isProactiveSentinel(eventReactiveSentinel(kind))).toBe(true);
    }
  });
});
