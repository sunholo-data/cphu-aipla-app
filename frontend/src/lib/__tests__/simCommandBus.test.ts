import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetSimCommandBusForTests, dispatchSimCommand, subscribeSimCommands } from "../simCommandBus";

/**
 * 1.1.133 M1 — the bus between the chat card and the sim frame.
 *
 * The bug this exists to prevent is the easiest one in the design to ship:
 * a re-rendered chat replaying every jump the tutor ever made, leaving the sim
 * somewhere arbitrary. Each toolCallId applies exactly once.
 */
const jump = (toolCallId = "tc-1") => ({
  toolCallId,
  artefactId: "sol-jord-maane",
  command: "jump",
  args: { event: "solform" },
});

describe("simCommandBus", () => {
  beforeEach(() => __resetSimCommandBusForTests());

  it("delivers a command to the sim it names", () => {
    const sol = vi.fn();
    const other = vi.fn();
    subscribeSimCommands("sol-jord-maane", sol);
    subscribeSimCommands("boldkast", other);
    expect(dispatchSimCommand(jump())).toBe(true);
    expect(sol).toHaveBeenCalledWith(jump());
    expect(other).not.toHaveBeenCalled();
  });

  it("applies a toolCallId exactly once — a replay is ignored", () => {
    const sol = vi.fn();
    subscribeSimCommands("sol-jord-maane", sol);
    dispatchSimCommand(jump("tc-1"));
    expect(dispatchSimCommand(jump("tc-1"))).toBe(false);
    dispatchSimCommand(jump("tc-2"));
    expect(sol).toHaveBeenCalledTimes(2);
  });

  it("holds a command for a closed sim and delivers it when the sim opens", () => {
    dispatchSimCommand(jump("tc-1"));
    const sol = vi.fn();
    subscribeSimCommands("sol-jord-maane", sol);
    expect(sol).toHaveBeenCalledTimes(1);
    // …once: re-opening the sim does not replay it.
    const again = vi.fn();
    subscribeSimCommands("sol-jord-maane", again);
    expect(again).not.toHaveBeenCalled();
  });

  it("holds at most five commands for a closed sim, keeping the latest", () => {
    for (let i = 0; i < 8; i++) dispatchSimCommand(jump(`tc-${i}`));
    const sol = vi.fn();
    subscribeSimCommands("sol-jord-maane", sol);
    expect(sol.mock.calls.map((c) => c[0].toolCallId)).toEqual(["tc-3", "tc-4", "tc-5", "tc-6", "tc-7"]);
  });

  it("stops delivering after unsubscribe", () => {
    const sol = vi.fn();
    const off = subscribeSimCommands("sol-jord-maane", sol);
    off();
    dispatchSimCommand(jump());
    expect(sol).not.toHaveBeenCalled();
  });

  it("ignores a command with no toolCallId — it could never be deduplicated", () => {
    const sol = vi.fn();
    subscribeSimCommands("sol-jord-maane", sol);
    expect(dispatchSimCommand({ ...jump(), toolCallId: "" })).toBe(false);
    expect(sol).not.toHaveBeenCalled();
  });
});
