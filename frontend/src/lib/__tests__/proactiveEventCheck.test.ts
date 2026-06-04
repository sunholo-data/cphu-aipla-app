/**
 * Tests for the proactive-event-check client + artefact-kind mapper
 * (sprint PROACTIVE-SIM-REACTIVE M9).
 *
 * Asserts:
 *   - mapArtefactKindToMeaningful resolves Boldkast's emit() kinds to
 *     the right backend allowlist entries (and returns null for
 *     non-meaningful kinds like boldkast.reset / boldkast.state-change)
 *   - fetchProactiveEventCheck POSTs the correct request shape
 *   - shouldFire=false / shouldFire=true response handling is correct
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MEANINGFUL_EVENT_KINDS,
  fetchProactiveEventCheck,
  isMeaningfulEventKind,
  mapArtefactKindToMeaningful,
} from "@/lib/proactiveEventCheck";

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "@/lib/apiClient";
const mockFetchWithAuth = vi.mocked(fetchWithAuth);

describe("MEANINGFUL_EVENT_KINDS", () => {
  it("matches the backend allowlist exactly (drift guard)", () => {
    // If this set drifts from backend/protocols/proactive_routes.py
    // MEANINGFUL_EVENT_KINDS, the FE would either hide proactive turns
    // (FE kind not in BE set) or pay for round-trips that always 200
    // skipped (BE kind not in FE set).
    expect([...MEANINGFUL_EVENT_KINDS].sort()).toEqual([
      "measurement_commit",
      "sim_run",
      "step_advance",
    ]);
  });
});

describe("isMeaningfulEventKind", () => {
  it("returns true for allowlist entries", () => {
    expect(isMeaningfulEventKind("sim_run")).toBe(true);
    expect(isMeaningfulEventKind("step_advance")).toBe(true);
    expect(isMeaningfulEventKind("measurement_commit")).toBe(true);
  });

  it("returns false for everything else", () => {
    expect(isMeaningfulEventKind("slider_drag")).toBe(false);
    expect(isMeaningfulEventKind("reset")).toBe(false);
    expect(isMeaningfulEventKind("")).toBe(false);
    expect(isMeaningfulEventKind("SIM_RUN")).toBe(false); // case-sensitive
  });
});

describe("mapArtefactKindToMeaningful — Boldkast", () => {
  it("maps boldkast.play to sim_run", () => {
    expect(mapArtefactKindToMeaningful("boldkast.play")).toBe("sim_run");
  });

  it("maps boldkast.show_value to measurement_commit", () => {
    expect(mapArtefactKindToMeaningful("boldkast.show_value")).toBe(
      "measurement_commit",
    );
  });

  it("returns null for boldkast.reset (explicitly excluded by design)", () => {
    expect(mapArtefactKindToMeaningful("boldkast.reset")).toBe(null);
  });

  it("returns null for boldkast.pause (not progress)", () => {
    expect(mapArtefactKindToMeaningful("boldkast.pause")).toBe(null);
  });

  it("returns null for boldkast.state-change (noise from state syncs)", () => {
    expect(mapArtefactKindToMeaningful("boldkast.state-change")).toBe(null);
  });

  it("returns null for boldkast.open (artefact lifecycle, not progress)", () => {
    expect(mapArtefactKindToMeaningful("boldkast.open")).toBe(null);
  });
});

describe("mapArtefactKindToMeaningful — convention patterns", () => {
  it("recognises *.run / *.play / *.simulate as sim_run", () => {
    expect(mapArtefactKindToMeaningful("kinebot.run")).toBe("sim_run");
    expect(mapArtefactKindToMeaningful("ledplanck.simulate")).toBe("sim_run");
    expect(mapArtefactKindToMeaningful("anything.play")).toBe("sim_run");
  });

  it("recognises *.step / *.next / *.advance as step_advance", () => {
    expect(mapArtefactKindToMeaningful("ledplanck.step")).toBe("step_advance");
    expect(mapArtefactKindToMeaningful("kinebot.next")).toBe("step_advance");
    expect(mapArtefactKindToMeaningful("any.advance")).toBe("step_advance");
  });

  it("recognises *.measure / *.record / *.commit as measurement_commit", () => {
    expect(mapArtefactKindToMeaningful("ledplanck.measure")).toBe(
      "measurement_commit",
    );
    expect(mapArtefactKindToMeaningful("kinebot.record")).toBe(
      "measurement_commit",
    );
    expect(mapArtefactKindToMeaningful("data.commit")).toBe("measurement_commit");
  });

  it("accepts a bare generic kind directly", () => {
    expect(mapArtefactKindToMeaningful("sim_run")).toBe("sim_run");
    expect(mapArtefactKindToMeaningful("step_advance")).toBe("step_advance");
  });

  it("returns null for unknown kinds", () => {
    expect(mapArtefactKindToMeaningful("random.thing")).toBe(null);
    expect(mapArtefactKindToMeaningful("")).toBe(null);
    expect(mapArtefactKindToMeaningful(null)).toBe(null);
    expect(mapArtefactKindToMeaningful(undefined)).toBe(null);
  });
});

describe("mapArtefactKindToMeaningful — multi-word hyphenated suffixes", () => {
  // Pre-2026-06-04 the mapper compared the WHOLE dot-suffix to single
  // keywords, so multi-word hyphenated kinds (`kinebot.sim-run`,
  // `led-planck.auto-run`, `led-planck.step-change`) all returned null
  // and proactive turns silently never fired for KineBot or LED Planck.
  // Fix: tokenize suffix on `-`/`_`; ANY token matching keyword wins.
  // These tests guard against regressing to the strict-equality form.
  it("KineBot sim-run → sim_run (was the user-reported gap)", () => {
    expect(mapArtefactKindToMeaningful("kinebot.sim-run")).toBe("sim_run");
  });

  it("LED Planck auto-run → sim_run", () => {
    expect(mapArtefactKindToMeaningful("led-planck.auto-run")).toBe("sim_run");
  });

  it("LED Planck step-change → step_advance", () => {
    expect(mapArtefactKindToMeaningful("led-planck.step-change")).toBe(
      "step_advance",
    );
  });

  it("LED Planck component-placed → step_advance", () => {
    expect(mapArtefactKindToMeaningful("led-planck.component-placed")).toBe(
      "step_advance",
    );
  });

  it("LED Planck calibrated → step_advance", () => {
    expect(mapArtefactKindToMeaningful("led-planck.calibrated")).toBe(
      "step_advance",
    );
  });

  it("LED Planck reading / fit / spectrum → measurement_commit", () => {
    expect(mapArtefactKindToMeaningful("led-planck.reading")).toBe(
      "measurement_commit",
    );
    expect(mapArtefactKindToMeaningful("led-planck.fit")).toBe(
      "measurement_commit",
    );
    expect(mapArtefactKindToMeaningful("led-planck.spectrum")).toBe(
      "measurement_commit",
    );
  });

  it("LED Planck state-change → null (noise, not progress)", () => {
    expect(mapArtefactKindToMeaningful("led-planck.state-change")).toBe(null);
  });

  it("LED Planck led-polarity-error → null (error, not progress)", () => {
    expect(mapArtefactKindToMeaningful("led-planck.led-polarity-error")).toBe(
      null,
    );
  });

  it("KineBot state-change → null (noise)", () => {
    expect(mapArtefactKindToMeaningful("kinebot.state-change")).toBe(null);
  });
});

describe("fetchProactiveEventCheck", () => {
  beforeEach(() => {
    mockFetchWithAuth.mockReset();
  });

  afterEach(() => {
    mockFetchWithAuth.mockReset();
  });

  it("POSTs the correct shape to /proactive-event-check", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ shouldFire: false, reason: "cooldown active" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await fetchProactiveEventCheck({
      sessionId: "sess-123",
      skillId: "skill-boldkast",
      eventKind: "sim_run",
    });

    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetchWithAuth.mock.calls[0];
    expect(url).toBe(
      "/api/proxy/api/sessions/sess-123/proactive-event-check",
    );
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      skillId: "skill-boldkast",
      eventKind: "sim_run",
      eventPayload: null,
    });
  });

  it("URL-encodes the session id (defensive against unusual code shapes)", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ shouldFire: false }), { status: 200 }),
    );

    await fetchProactiveEventCheck({
      sessionId: "sess/with/slashes",
      skillId: "s",
      eventKind: "sim_run",
    });

    const [url] = mockFetchWithAuth.mock.calls[0];
    expect(url).toContain("sess%2Fwith%2Fslashes");
  });

  it("forwards eventPayload when provided", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ shouldFire: false }), { status: 200 }),
    );

    await fetchProactiveEventCheck({
      sessionId: "s",
      skillId: "k",
      eventKind: "step_advance",
      eventPayload: { angle: 45, velocity: 15 },
    });

    const body = JSON.parse(
      mockFetchWithAuth.mock.calls[0][1]?.body as string,
    );
    expect(body.eventPayload).toEqual({ angle: 45, velocity: 15 });
  });

  it("returns the parsed response on shouldFire=true with trigger", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          shouldFire: true,
          trigger: "[event_reactive:sim_run]",
          sessionId: "sess-123",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await fetchProactiveEventCheck({
      sessionId: "sess-123",
      skillId: "skill-boldkast",
      eventKind: "sim_run",
    });

    expect(result.shouldFire).toBe(true);
    expect(result.trigger).toBe("[event_reactive:sim_run]");
    expect(result.sessionId).toBe("sess-123");
  });

  it("returns the parsed response on shouldFire=false with reason", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ shouldFire: false, reason: "cap reached" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await fetchProactiveEventCheck({
      sessionId: "sess-123",
      skillId: "skill-boldkast",
      eventKind: "sim_run",
    });

    expect(result.shouldFire).toBe(false);
    expect(result.reason).toBe("cap reached");
    expect(result.trigger).toBeUndefined();
  });

  it("throws on non-OK response so callers can log-and-swallow", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      new Response("server error body", { status: 500 }),
    );

    await expect(
      fetchProactiveEventCheck({
        sessionId: "s",
        skillId: "k",
        eventKind: "sim_run",
      }),
    ).rejects.toThrow(/proactive-event-check failed: 500/);
  });

  it("does NOT call AG-UI directly — pure HTTP client", async () => {
    // The whole point of Path B is that this client is decoupled from
    // AG-UI. It returns the gate decision; the caller decides whether
    // to invoke sendMessage. This test exists so a future "convenience"
    // refactor that bundles AG-UI invocation here gets caught.
    mockFetchWithAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ shouldFire: true, trigger: "x" }), {
        status: 200,
      }),
    );
    await fetchProactiveEventCheck({
      sessionId: "s",
      skillId: "k",
      eventKind: "sim_run",
    });
    // Only the one POST to the gate endpoint — no AG-UI side calls.
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
  });
});
