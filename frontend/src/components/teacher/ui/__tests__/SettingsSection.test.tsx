import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingsSection } from "@/components/teacher/ui/SettingsSection";

describe("SettingsSection", () => {
  it("renders title, description, and children", () => {
    render(
      <SettingsSection title="Class settings" description="Per-class options">
        <p>body</p>
      </SettingsSection>,
    );
    expect(screen.getByRole("heading", { name: "Class settings" })).toBeInTheDocument();
    expect(screen.getByText("Per-class options")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("renders non-collapsible without a toggle button", () => {
    render(
      <SettingsSection title="T">
        <p>body</p>
      </SettingsSection>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("collapses and expands when collapsible", () => {
    render(
      <SettingsSection title="T" collapsible defaultOpen>
        <p>body</p>
      </SettingsSection>,
    );
    const toggle = screen.getByRole("button", { expanded: true });
    expect(screen.getByText("body")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });

  it("keeps the header action outside the toggle button (no nested interactives)", () => {
    render(
      <SettingsSection title="T" collapsible action={<button>Add</button>}>
        <p>body</p>
      </SettingsSection>,
    );
    const addBtn = screen.getByRole("button", { name: "Add" });
    const toggle = screen.getByRole("button", { expanded: true });
    expect(toggle.contains(addBtn)).toBe(false);
  });
});
