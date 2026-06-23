import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ACTIVITY_TEMPLATES } from "@/lib/activityTemplates";

import { TemplatePicker } from "../TemplatePicker";

describe("TemplatePicker", () => {
  it("renders every template", () => {
    render(<TemplatePicker onPick={vi.fn()} />);
    for (const t of ACTIVITY_TEMPLATES) {
      expect(screen.getByText(t.name)).toBeInTheDocument();
    }
  });

  it("calls onPick with the chosen template", () => {
    const onPick = vi.fn();
    render(<TemplatePicker onPick={onPick} />);
    const target = ACTIVITY_TEMPLATES[1];
    fireEvent.click(screen.getByText(target.name));
    expect(onPick).toHaveBeenCalledWith(target);
  });
});
