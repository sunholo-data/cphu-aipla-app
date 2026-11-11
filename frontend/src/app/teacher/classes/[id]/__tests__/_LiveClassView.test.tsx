import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listClassLive = vi.fn();
const ackClassSignal = vi.fn();

vi.mock("@/lib/teacherApi", () => ({
  listClassLive: (...a: unknown[]) => listClassLive(...a),
  ackClassSignal: (...a: unknown[]) => ackClassSignal(...a),
}));

import { LiveSummary, RaisedHands, useLiveClass } from "../_LiveClassView";
import { notify } from "@/components/ui/toast";
import { LocaleProvider } from "@/i18n";

// 1.1.108 M2 — these tests assert the English copy; the teacher UI defaults to
// Danish (the teacher's own DA | EN choice), so render inside an English locale.
function EnglishLocale({ children }: { children: React.ReactNode }) {
  return <LocaleProvider locale="en">{children}</LocaleProvider>;
}
const render = ((ui: React.ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: EnglishLocale, ...options })) as typeof rtlRender;

const NOW = new Date().toISOString();

function payload(over: Record<string, unknown> = {}) {
  return { calls: [], groups: [], summary: null, generatedAt: NOW, ...over };
}

/** The class page's Lektion view, minus the groups table (its own tests). */
function Harness() {
  const live = useLiveClass("c1", 1_000_000);
  return (
    <div>
      <span data-testid="state">{live.error ? "error" : live.data ? "ok" : "loading"}</span>
      <RaisedHands calls={live.data?.calls ?? []} acking={live.acking} onAck={(g) => void live.ack(g)} />
      <LiveSummary summary={live.data?.summary ?? null} />
    </div>
  );
}

beforeEach(() => {
  listClassLive.mockReset().mockResolvedValue(payload());
  ackClassSignal.mockReset().mockResolvedValue(undefined);
});

describe("useLiveClass + RaisedHands + LiveSummary", () => {
  it("renders a raised hand and acknowledges it", async () => {
    listClassLive
      .mockResolvedValueOnce(
        payload({ calls: [{ groupId: "g1", activityId: "", activityTitle: "Energi", raisedHandAt: NOW }] }),
      )
      .mockResolvedValue(payload());
    render(<Harness />);
    const button = await screen.findByRole("button", { name: "Acknowledge g1" });
    expect(screen.getByTestId("raised-hands")).toHaveTextContent(/g1\s*raised a hand/);
    fireEvent.click(button);
    await waitFor(() => expect(ackClassSignal).toHaveBeenCalledWith("c1", "g1"));
    // Re-polled after the ack, so the hand goes away.
    await waitFor(() => expect(screen.queryByTestId("raised-hands")).toBeNull());
  });

  it("says so when Acknowledge fails, instead of an unhandled rejection", async () => {
    const error = vi.spyOn(notify, "error");
    ackClassSignal.mockRejectedValue(new Error("boom"));
    listClassLive.mockResolvedValue(
      payload({ calls: [{ groupId: "g1", activityId: "", activityTitle: "", raisedHandAt: NOW }] }),
    );
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge g1" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("Could not acknowledge g1. Try again."));
  });

  it("renders nothing for hands or summary when there are none", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("ok"));
    expect(screen.queryByTestId("raised-hands")).toBeNull();
    expect(screen.queryByTestId("live-summary")).toBeNull();
  });

  it("renders the summary panel only when present (M1 graceful absence)", async () => {
    listClassLive.mockResolvedValue(
      payload({ summary: { text: "Most groups working.", framework: "AIPLA live-summary v0", generatedAt: NOW } }),
    );
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("live-summary")).toBeInTheDocument());
    expect(screen.getByText(/Most groups working/)).toBeInTheDocument();
    expect(screen.getByText("The class right now")).toBeInTheDocument();
  });

  it("reports a failed poll, so the groups table can say it does not know", async () => {
    listClassLive.mockReset().mockRejectedValue(new Error("boom"));
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("error"));
  });
});
