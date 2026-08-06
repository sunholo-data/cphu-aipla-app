import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ProgressChecklist } from "../ProgressChecklist";

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
}));
import { fetchWithAuth } from "@/lib/apiClient";

const dispatchMock = vi.fn();
vi.mock("@/hooks/useHumanToolEvents", () => ({
  useHumanToolEvents: () => ({ events: [], dispatch: dispatchMock, clear: vi.fn() }),
}));

const ITEMS = [
  { id: "a", label: "Sub-part A" },
  { id: "b", label: "Sub-part B" },
];
const KEY = "aipla.progress:skill-1";

describe("ProgressChecklist", () => {
  beforeEach(() => {
    window.sessionStorage.removeItem(KEY);
    vi.mocked(fetchWithAuth).mockClear();
    dispatchMock.mockClear();
  });

  it("renders all items unchecked by default", () => {
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} />);
    expect(screen.getByText("Sub-part A")).toBeInTheDocument();
    expect(screen.getByText("Sub-part B")).toBeInTheDocument();
    expect(screen.getByText("0/2")).toBeInTheDocument();
    // Both buttons start in aria-pressed=false state
    const buttons = screen.getAllByRole("button");
    buttons.forEach((b) => expect(b).toHaveAttribute("aria-pressed", "false"));
  });

  it("toggles done state on click", () => {
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} />);
    fireEvent.click(screen.getByText("Sub-part A"));
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("persists state to sessionStorage", () => {
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} />);
    fireEvent.click(screen.getByText("Sub-part A"));
    expect(window.sessionStorage.getItem(KEY)).toBe(JSON.stringify({ a: true }));
    fireEvent.click(screen.getByText("Sub-part B"));
    expect(JSON.parse(window.sessionStorage.getItem(KEY) || "{}")).toEqual({
      a: true,
      b: true,
    });
  });

  it("restores state from sessionStorage on mount", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ a: true }));
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} />);
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("scopes by skillId so different skills don't share state", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ a: true }));
    render(<ProgressChecklist skillId="skill-2" items={ITEMS} />);
    expect(screen.getByText("0/2")).toBeInTheDocument();
  });

  it("ignores garbage sessionStorage data without crashing", () => {
    window.sessionStorage.setItem(KEY, "{not json");
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} />);
    expect(screen.getByText("0/2")).toBeInTheDocument();
  });

  it("does NOT push to iframe-context when sessionId is null", () => {
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} sessionId={null} />);
    fireEvent.click(screen.getByText("Sub-part A"));
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("pushes a self-describing snapshot to iframe-context on toggle", () => {
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} sessionId="sess-123" />);
    fireEvent.click(screen.getByText("Sub-part A"));

    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchWithAuth).mock.calls[0];
    expect(url).toBe("/api/proxy/api/sessions/sess-123/iframe-context");
    expect(init?.method).toBe("POST");
    const body = JSON.parse((init?.body as string) ?? "{}");
    expect(body.serverId).toBe("progress");
    expect(body.toolName).toBe("state");
    // Snapshot is self-describing — agent sees done IDs + sub-part labels.
    expect(body.structuredContent.done).toEqual(["a"]);
    expect(body.structuredContent.items).toEqual([
      { id: "a", label: "Sub-part A" },
      { id: "b", label: "Sub-part B" },
    ]);
    expect(body.structuredContent.total).toBe(2);
  });

  it("subsequent toggles push the updated done-set", () => {
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} sessionId="sess-123" />);
    fireEvent.click(screen.getByText("Sub-part A"));
    fireEvent.click(screen.getByText("Sub-part B"));
    expect(fetchWithAuth).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(
      (vi.mocked(fetchWithAuth).mock.calls[1][1]?.body as string) ?? "{}",
    );
    expect(secondBody.structuredContent.done).toEqual(["a", "b"]);
  });

  it("un-toggle (mark-done → mark-undone) pushes the shrunk done-set", () => {
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} sessionId="sess-123" />);
    fireEvent.click(screen.getByText("Sub-part A"));  // a → done
    fireEvent.click(screen.getByText("Sub-part A"));  // a → undone
    expect(fetchWithAuth).toHaveBeenCalledTimes(2);
    const lastBody = JSON.parse(
      (vi.mocked(fetchWithAuth).mock.calls[1][1]?.body as string) ?? "{}",
    );
    expect(lastBody.structuredContent.done).toEqual([]);
  });

  it("catch-up push when sessionId arrives after pre-session interactions", () => {
    // Simulate the order: student loads page (no session), ticks a sub-part
    // (sessionStorage persists; push is no-op because sessionId is null),
    // then sends their first chat message → sessionId arrives.
    window.sessionStorage.setItem(KEY, JSON.stringify({ a: true }));

    // First render: no session — no push, but UI reflects the stored state.
    const { rerender } = render(
      <ProgressChecklist skillId="skill-1" items={ITEMS} sessionId={null} />,
    );
    expect(fetchWithAuth).not.toHaveBeenCalled();
    expect(screen.getByText("1/2")).toBeInTheDocument();

    // Second render: session arrives. Catch-up effect fires.
    rerender(
      <ProgressChecklist skillId="skill-1" items={ITEMS} sessionId="sess-late" />,
    );
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchWithAuth).mock.calls[0];
    expect(url).toBe("/api/proxy/api/sessions/sess-late/iframe-context");
    const body = JSON.parse((init?.body as string) ?? "{}");
    expect(body.structuredContent.done).toEqual(["a"]);
  });

  it("catch-up does NOT push when nothing was ticked pre-session", () => {
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} sessionId="sess-late" />);
    // No ticks happened. Catch-up effect runs but should bail (no done items).
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("dispatches a human-tool-use card with Danish label when toggling on", () => {
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} sessionId="sess-123" />);
    fireEvent.click(screen.getByText("Sub-part A"));
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const arg = dispatchMock.mock.calls[0][0];
    expect(arg.label).toBe("Markerede 'Sub-part A' som klar");
    expect(typeof arg.push).toBe("function");
  });

  it("dispatches a 'Fjernede ...' card when toggling off", () => {
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} sessionId="sess-123" />);
    fireEvent.click(screen.getByText("Sub-part A")); // on
    fireEvent.click(screen.getByText("Sub-part A")); // off
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock.mock.calls[1][0].label).toBe("Fjernede 'Sub-part A' fra klare");
  });

  it("does NOT dispatch a card on the catch-up path (silent re-sync)", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ a: true }));
    const { rerender } = render(
      <ProgressChecklist skillId="skill-1" items={ITEMS} sessionId={null} />,
    );
    expect(dispatchMock).not.toHaveBeenCalled();
    rerender(<ProgressChecklist skillId="skill-1" items={ITEMS} sessionId="sess-late" />);
    // catch-up fired (fetchWithAuth called) but no card dispatched
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("does NOT dispatch a card when sessionId is null (no push possible)", () => {
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} sessionId={null} />);
    fireEvent.click(screen.getByText("Sub-part A"));
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

/**
 * 1.1.62 M3 — server-backed, per-group ticks + AI provenance.
 *
 * Ticks used to live in sessionStorage keyed by skill, i.e. per BROWSER, so
 * three students in one group had three private checklists that died with the
 * tab — wrong ever since 1.1.53 established that the primary classroom shape is
 * one group across separate devices. With `activityId` + `itemStates` supplied
 * the component round-trips the per-group store instead; sessionStorage stays
 * only as the builder-preview fallback.
 */
describe("ProgressChecklist — per-group state and AI marks (1.1.62 M3)", () => {
  beforeEach(() => {
    window.sessionStorage.removeItem(KEY);
    vi.mocked(fetchWithAuth).mockClear();
    dispatchMock.mockClear();
  });

  it("renders server state rather than sessionStorage when group-backed", () => {
    render(
      <ProgressChecklist
        skillId="skill-1"
        activityId="act-1"
        items={ITEMS}
        itemStates={{ a: { done: true, by: "student" } }}
      />,
    );
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("marks an AI-ticked step as the tutor's read, with its reason", () => {
    render(
      <ProgressChecklist
        skillId="skill-1"
        activityId="act-1"
        items={ITEMS}
        itemStates={{ a: { done: true, by: "ai", evidence: "målte tre gange" } }}
      />,
    );
    expect(screen.getByTestId("ai-marked-a")).toBeInTheDocument();
    expect(screen.getByText("målte tre gange")).toBeInTheDocument();
  });

  it("does not label a student's own tick as the AI's", () => {
    render(
      <ProgressChecklist
        skillId="skill-1"
        activityId="act-1"
        items={ITEMS}
        itemStates={{ a: { done: true, by: "student" } }}
      />,
    );
    expect(screen.queryByTestId("ai-marked-a")).not.toBeInTheDocument();
  });

  it("POSTs a tick to the per-group store instead of writing sessionStorage", () => {
    render(<ProgressChecklist skillId="skill-1" activityId="act-1" items={ITEMS} itemStates={{}} />);
    fireEvent.click(screen.getByText("Sub-part A"));

    const posted = vi
      .mocked(fetchWithAuth)
      .mock.calls.find(([url]) => String(url).includes("/checklist-progress"));
    expect(posted).toBeTruthy();
    expect(posted?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(posted?.[1]?.body))).toEqual({ itemId: "a", done: true });
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("lets the student override an AI tick", () => {
    render(
      <ProgressChecklist
        skillId="skill-1"
        activityId="act-1"
        items={ITEMS}
        itemStates={{ a: { done: true, by: "ai", evidence: "looked done" } }}
      />,
    );
    fireEvent.click(screen.getByText("Sub-part A"));

    const posted = vi
      .mocked(fetchWithAuth)
      .mock.calls.find(([url]) => String(url).includes("/checklist-progress"));
    expect(JSON.parse(String(posted?.[1]?.body))).toEqual({ itemId: "a", done: false });
    // Optimistic: the step reads not-done immediately, before the refetch.
    expect(screen.getByText("0/2")).toBeInTheDocument();
  });

  it("still dispatches a trust card for the student's own tick", () => {
    render(
      <ProgressChecklist
        skillId="skill-1"
        activityId="act-1"
        items={ITEMS}
        sessionId="s1"
        itemStates={{}}
      />,
    );
    fireEvent.click(screen.getByText("Sub-part A"));
    expect(dispatchMock).toHaveBeenCalled();
  });

  it("falls back to local state in the builder preview (no group)", () => {
    render(<ProgressChecklist skillId="skill-1" items={ITEMS} />);
    fireEvent.click(screen.getByText("Sub-part A"));
    expect(window.sessionStorage.getItem(KEY)).toContain("\"a\":true");
    expect(
      vi.mocked(fetchWithAuth).mock.calls.some(([url]) => String(url).includes("/checklist-progress")),
    ).toBe(false);
  });

  it("says progress is shared with the group when group-backed", () => {
    render(<ProgressChecklist skillId="skill-1" activityId="act-1" items={ITEMS} itemStates={{}} />);
    expect(screen.getByText(/deles med din gruppe/i)).toBeInTheDocument();
  });
});
