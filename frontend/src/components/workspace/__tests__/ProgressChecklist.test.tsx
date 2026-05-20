import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { ProgressChecklist } from "../ProgressChecklist";

const ITEMS = [
  { id: "a", label: "Sub-part A" },
  { id: "b", label: "Sub-part B" },
];
const KEY = "aipla.progress:skill-1";

describe("ProgressChecklist", () => {
  beforeEach(() => {
    window.sessionStorage.removeItem(KEY);
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
});
