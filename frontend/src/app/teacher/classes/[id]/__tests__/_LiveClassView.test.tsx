import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listClassLive = vi.fn();
const ackClassSignal = vi.fn();

vi.mock("@/lib/teacherApi", () => ({
  listClassLive: (...a: unknown[]) => listClassLive(...a),
  ackClassSignal: (...a: unknown[]) => ackClassSignal(...a),
}));

import { LiveClassView } from "../_LiveClassView";

const NOW = new Date().toISOString();

function payload(over: Record<string, unknown> = {}) {
  return { calls: [], groups: [], summary: null, generatedAt: NOW, ...over };
}

const group = (over: Record<string, unknown> = {}) => ({
  groupId: "g1",
  status: "active",
  turns: 5,
  lastActivityAt: NOW,
  idleSeconds: 10,
  stuck: false,
  activityTitle: "Energi",
  skillId: "boldkast",
  ...over,
});

beforeEach(() => {
  listClassLive.mockReset().mockResolvedValue(payload());
  ackClassSignal.mockReset().mockResolvedValue(undefined);
});

describe("LiveClassView", () => {
  it("renders deterministic group rows incl. a stuck flag", async () => {
    listClassLive.mockResolvedValue(
      payload({ groups: [group(), group({ groupId: "g2", status: "idle", stuck: true })] }),
    );
    render(<LiveClassView classId="c1" pollMs={1_000_000} />);
    await waitFor(() => expect(screen.getByText("g1")).toBeInTheDocument());
    expect(screen.getByText("g2")).toBeInTheDocument();
    expect(screen.getByText(/stuck/i)).toBeInTheDocument();
  });

  it("shows the empty state when no groups are online", async () => {
    render(<LiveClassView classId="c1" pollMs={1_000_000} />);
    await waitFor(() => expect(screen.getByText(/no groups online/i)).toBeInTheDocument());
  });

  it("renders a raised hand and acknowledges it", async () => {
    listClassLive
      .mockResolvedValueOnce(
        payload({ calls: [{ groupId: "g1", activityId: "", activityTitle: "Energi", raisedHandAt: NOW }] }),
      )
      .mockResolvedValue(payload());
    render(<LiveClassView classId="c1" pollMs={1_000_000} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /acknowledge/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /acknowledge/i }));
    await waitFor(() => expect(ackClassSignal).toHaveBeenCalledWith("c1", "g1"));
  });

  it("renders the summary panel only when present (M1 graceful absence)", async () => {
    listClassLive.mockResolvedValue(
      payload({ summary: { text: "Most groups working.", framework: "AIPLA live-summary v0", generatedAt: NOW } }),
    );
    render(<LiveClassView classId="c1" pollMs={1_000_000} />);
    await waitFor(() => expect(screen.getByTestId("live-summary")).toBeInTheDocument());
    expect(screen.getByText(/Most groups working/)).toBeInTheDocument();
  });

  it("degrades to an alert if the fetch fails before any data", async () => {
    listClassLive.mockReset().mockRejectedValue(new Error("boom"));
    render(<LiveClassView classId="c1" pollMs={1_000_000} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
