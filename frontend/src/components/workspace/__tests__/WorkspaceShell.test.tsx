import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { WorkspaceShell } from "../WorkspaceShell";

const COLLAPSE_KEY = "aipla.workspace.collapsed";

describe("WorkspaceShell", () => {
  beforeEach(() => {
    window.sessionStorage.removeItem(COLLAPSE_KEY);
  });

  it("renders children when expanded (default)", () => {
    render(
      <WorkspaceShell>
        <p>workspace body</p>
      </WorkspaceShell>,
    );
    expect(screen.getByText("workspace body")).toBeInTheDocument();
    expect(screen.getByLabelText(/Collapse workspace/i)).toBeInTheDocument();
  });

  it("uses default Danish title", () => {
    render(
      <WorkspaceShell>
        <p>x</p>
      </WorkspaceShell>,
    );
    expect(screen.getByText(/Arbejdsområde/i)).toBeInTheDocument();
  });

  it("accepts a custom title", () => {
    render(
      <WorkspaceShell title="Custom Workspace">
        <p>x</p>
      </WorkspaceShell>,
    );
    expect(screen.getByText("Custom Workspace")).toBeInTheDocument();
  });

  it("collapses on toggle click and hides children", () => {
    render(
      <WorkspaceShell>
        <p>workspace body</p>
      </WorkspaceShell>,
    );
    const collapseBtn = screen.getByLabelText(/Collapse workspace/i);
    fireEvent.click(collapseBtn);
    expect(screen.queryByText("workspace body")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Expand workspace/i)).toBeInTheDocument();
  });

  it("persists collapse state to sessionStorage", () => {
    render(
      <WorkspaceShell>
        <p>x</p>
      </WorkspaceShell>,
    );
    fireEvent.click(screen.getByLabelText(/Collapse workspace/i));
    expect(window.sessionStorage.getItem(COLLAPSE_KEY)).toBe("1");
    fireEvent.click(screen.getByLabelText(/Expand workspace/i));
    expect(window.sessionStorage.getItem(COLLAPSE_KEY)).toBe("0");
  });

  it("restores collapsed state from sessionStorage on mount", () => {
    window.sessionStorage.setItem(COLLAPSE_KEY, "1");
    render(
      <WorkspaceShell>
        <p>workspace body</p>
      </WorkspaceShell>,
    );
    expect(screen.queryByText("workspace body")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Expand workspace/i)).toBeInTheDocument();
  });

  it("hideOnMobile=false (default): aside has `flex`, no `hidden` — visible at all breakpoints", () => {
    const { container } = render(
      <WorkspaceShell>
        <p>x</p>
      </WorkspaceShell>,
    );
    const aside = container.querySelector("aside")!;
    expect(aside.className).toMatch(/\bflex\b/);
    expect(aside.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it("hideOnMobile=true: aside has `hidden md:flex` so mobile-tab pattern can gate it", () => {
    const { container } = render(
      <WorkspaceShell hideOnMobile>
        <p>x</p>
      </WorkspaceShell>,
    );
    const aside = container.querySelector("aside")!;
    expect(aside.className).toMatch(/\bhidden\b/);
    expect(aside.className).toMatch(/md:flex/);
  });
});
