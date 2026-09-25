// CONCEPT-1 M3 — the visible checkpoint record in the student chat.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CheckpointCard, parseCheckpointResult } from "../CheckpointCard";

const PASSED = JSON.stringify({
  ok: true,
  node: { id: "vektorer", label: "Vektorer" },
  status: "demonstrated",
  evidence: "Dekomponerede 30°-kastet i vx og vy uden hjælp.",
  nodeStates: { vektorer: "demonstrated" },
});

describe("parseCheckpointResult", () => {
  it("parses a passed checkpoint", () => {
    expect(parseCheckpointResult(PASSED)).toEqual({
      nodeLabel: "Vektorer",
      status: "demonstrated",
      evidence: "Dekomponerede 30°-kastet i vx og vy uden hjælp.",
      kind: "checkpoint",
    });
  });

  it("treats a result with no kind as a checkpoint (CONCEPT-2 M2)", () => {
    // Every result written before the field existed was one. Defaulting the
    // other way would relabel the whole pilot's checkpoints as passive reads.
    const legacy = JSON.stringify({ ok: true, node: { label: "X" }, status: "partial", evidence: "" });
    expect(parseCheckpointResult(legacy)?.kind).toBe("checkpoint");
  });

  it("returns null for denied / malformed / non-checkpoint results (falls back to the chip)", () => {
    expect(parseCheckpointResult(JSON.stringify({ ok: false, error: "unknown node" }))).toBeNull();
    expect(parseCheckpointResult("not json")).toBeNull();
    expect(parseCheckpointResult(null)).toBeNull();
    expect(parseCheckpointResult(JSON.stringify({ ok: true, node: { label: "X" }, status: "weird" }))).toBeNull();
  });
});

describe("CheckpointCard", () => {
  it("renders a passed checkpoint as 'forstået' with the evidence", () => {
    render(<CheckpointCard result={parseCheckpointResult(PASSED)!} />);
    expect(screen.getByTestId("checkpoint-card")).toHaveTextContent("Vektorer — forstået");
    expect(screen.getByTestId("checkpoint-card")).toHaveTextContent("Dekomponerede 30°-kastet");
  });

  it("renders a non-pass as 'på vej' (progress, never failure)", () => {
    render(<CheckpointCard result={{ nodeLabel: "Projektil", status: "partial", evidence: "" }} />);
    expect(screen.getByTestId("checkpoint-card")).toHaveTextContent("Projektil — på vej");
  });

  it("renders a passive mark as 'bemærket', not as a checkpoint result (CONCEPT-2 M2)", () => {
    // The card must not claim the stronger provenance for the weaker mark: a
    // passive read says what the tutor noticed, a checkpoint says what was
    // checked, and the store ranks them accordingly.
    render(
      <CheckpointCard
        result={{ nodeLabel: "Vektorer", status: "demonstrated", evidence: "brugte cos og sin selv", kind: "observed" }}
      />,
    );
    const card = screen.getByTestId("checkpoint-card");
    expect(card).toHaveTextContent("Vektorer — bemærket");
    expect(card).not.toHaveTextContent("forstået");
    expect(card).toHaveTextContent("brugte cos og sin selv");
  });
});
