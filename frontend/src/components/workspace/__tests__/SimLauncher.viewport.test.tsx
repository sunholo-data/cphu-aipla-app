import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SimLauncher } from "@/components/workspace/SimLauncher";
import type { ActivityArtefact } from "@/components/workspace/GenericArtefactFrame";

/**
 * MOBILE-1 — LED-Planck lays its bench out at fixed coordinates and is unusable
 * below ~720px. The decision (2026-08-13) was to LABEL it rather than rescale
 * it: "some lessons are device-limited" is acceptable, "the sim opens and half
 * the circuit is off-screen" is not.
 *
 * jsdom has no layout and no real media queries, so `matchMedia` is stubbed to
 * answer for a chosen viewport width. That is the same seam the component uses
 * in a browser, so the test exercises the real branch.
 */
function stubViewport(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const m = /max-width:\s*(\d+)px/.exec(query);
    const max = m ? Number(m[1]) : Infinity;
    return {
      matches: width <= max,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  });
}

const ledPlanck: ActivityArtefact = {
  id: "led-planck",
  displayName: "LED Planck",
  artefactPath: "led-planck/v1",
  minViewportPx: 720,
};

const boldkast: ActivityArtefact = {
  id: "boldkast",
  displayName: "Boldkast",
  artefactPath: "boldkast/v1",
  // No minimum — the one artefact written mobile-first.
};

afterEach(() => vi.unstubAllGlobals());

describe("SimLauncher — device capability (MOBILE-1)", () => {
  it("on a phone, replaces the launch button with a plain explanation", () => {
    stubViewport(390);
    render(<SimLauncher artefact={ledPlanck} onOpen={vi.fn()} />);
    expect(screen.getByText(/kræver en større skærm/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Åbn LED Planck/i })).toBeNull();
  });

  it("tells the student the chat still works, so the activity is not a dead end", () => {
    // Half the lesson is the tutor. A bare "not supported" would read as
    // "close this tab" when the conversation is still perfectly usable.
    stubViewport(390);
    render(<SimLauncher artefact={ledPlanck} onOpen={vi.fn()} />);
    expect(screen.getByText(/chatte med tutoren/i)).toBeInTheDocument();
  });

  it("on an iPad it launches normally", () => {
    stubViewport(810);
    const onOpen = vi.fn();
    render(<SimLauncher artefact={ledPlanck} onOpen={onOpen} />);
    expect(screen.getByRole("button", { name: /Åbn LED Planck/i })).toBeInTheDocument();
    expect(screen.queryByText(/større skærm/i)).toBeNull();
  });

  it("never gates an artefact that declares no minimum, even on a phone", () => {
    stubViewport(390);
    render(<SimLauncher artefact={boldkast} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Åbn Boldkast/i })).toBeInTheDocument();
  });
});
