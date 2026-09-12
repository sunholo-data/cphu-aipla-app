import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TeacherTabs } from "@/components/teacher/ui/TeacherTabs";

const TABS = [
  { id: "a", label: "First", content: <p>panel a</p> },
  { id: "b", label: "Second", hint: "2 constructs", content: <p>panel b</p> },
  { id: "c", label: "Third", content: <p>panel c</p> },
];

function Harness({ orientation }: { orientation?: "horizontal" | "vertical" }) {
  return <TeacherTabs ariaLabel="Sections" active="a" onChange={vi.fn()} orientation={orientation} tabs={TABS} />;
}

describe("TeacherTabs", () => {
  it("puts no display utility on a hidden panel", () => {
    // The bug this asserts against: the panels carried `flex flex-col gap-4`
    // unconditionally. `hidden` is a UA-stylesheet rule, so an author
    // `display: flex` beats it — every panel rendered at once and the tabs
    // looked dead. jsdom loads no Tailwind, so `toBeVisible()` cannot see this;
    // the class list is the only witness available in a unit test.
    render(<Harness />);
    const panels = screen.getAllByRole("tabpanel", { hidden: true });
    const hidden = panels.filter((p) => p.hasAttribute("hidden"));
    expect(hidden).toHaveLength(2);
    for (const p of hidden) {
      expect(p.className).not.toMatch(/\b(flex|grid|block|inline-block|inline-flex|table)\b/);
    }
    // …and the visible one still gets its layout.
    expect(panels.find((p) => !p.hasAttribute("hidden"))!.className).toMatch(/\bflex\b/);
  });

  it("moves selection with the arrow keys in both orientations", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <TeacherTabs ariaLabel="Sections" active="a" onChange={onChange} tabs={TABS} />,
    );

    await user.click(screen.getByRole("tab", { name: "First" }));
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("b");

    // A vertical rail is expected to move with ↑/↓; a dead key there would
    // make the control mouse-only while looking fine.
    rerender(
      <TeacherTabs ariaLabel="Sections" active="a" onChange={onChange} orientation="vertical" tabs={TABS} />,
    );
    await user.click(screen.getByRole("tab", { name: /First/ }));
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith("b");
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("c");
  });

  it("shows a rail entry's hint only in the vertical layout", () => {
    const { rerender } = render(<Harness />);
    expect(screen.queryByText("2 constructs")).not.toBeInTheDocument();
    rerender(<Harness orientation="vertical" />);
    expect(screen.getByText("2 constructs")).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toHaveAttribute("aria-orientation", "vertical");
  });
});
