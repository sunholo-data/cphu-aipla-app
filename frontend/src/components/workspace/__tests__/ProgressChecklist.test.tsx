import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ProgressChecklist } from "../ProgressChecklist";

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
}));
import { fetchWithAuth } from "@/lib/apiClient";

const ITEMS = [
  { id: "a", label: "Sub-part A" },
  { id: "b", label: "Sub-part B" },
];
const KEY = "aipla.progress:skill-1";

describe("ProgressChecklist", () => {
  beforeEach(() => {
    window.sessionStorage.removeItem(KEY);
    vi.mocked(fetchWithAuth).mockClear();
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
});
