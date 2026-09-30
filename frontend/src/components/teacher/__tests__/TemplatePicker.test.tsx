import { fireEvent, render as rtlRender, screen, within, type RenderOptions } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ACTIVITY_TEMPLATES } from "@/lib/activityTemplates";

import { TemplatePicker, templateFamily } from "../TemplatePicker";

import { LocaleProvider } from "@/i18n";

// 1.1.108 M2 — these tests assert the English copy; the teacher UI defaults to
// Danish, so render inside an English locale (the teacher chose EN).
function EnglishUI({ children }: { children: React.ReactNode }) {
  return <LocaleProvider locale="en">{children}</LocaleProvider>;
}
const render = (ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: EnglishUI, ...options });

describe("TemplatePicker", () => {
  it("renders every template", () => {
    render(<TemplatePicker onPick={vi.fn()} />);
    for (const t of ACTIVITY_TEMPLATES) {
      expect(screen.getByText(t.name)).toBeInTheDocument();
    }
  });

  it("calls onPick with the chosen template and marks it as loaded", () => {
    const onPick = vi.fn();
    render(<TemplatePicker onPick={onPick} />);
    const target = ACTIVITY_TEMPLATES[1];
    const card = screen.getByRole("button", { name: new RegExp(target.name) });
    fireEvent.click(card);
    expect(onPick).toHaveBeenCalledWith(target);
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByText("Loaded")).toBeInTheDocument();
  });

  it("filters the strip by lesson shape and shows every template under All", () => {
    render(<TemplatePicker onPick={vi.fn()} />);
    const strip = screen.getByRole("list", { name: "Activity templates" });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(ACTIVITY_TEMPLATES.length);

    const filters = screen.getByRole("group", { name: /filter templates/i });
    fireEvent.click(within(filters).getByRole("button", { name: /^Simulation/ }));
    const sims = ACTIVITY_TEMPLATES.filter((t) => t.artefactId);
    expect(sims.length).toBeGreaterThan(0);
    expect(within(strip).getAllByRole("listitem")).toHaveLength(sims.length);
    for (const t of sims) expect(within(strip).getByText(t.name)).toBeInTheDocument();

    fireEvent.click(within(filters).getByRole("button", { name: /^All/ }));
    expect(within(strip).getAllByRole("listitem")).toHaveLength(ACTIVITY_TEMPLATES.length);
  });

  it("offers a start-from-scratch card in every filter when onStartBlank is given", () => {
    const onStartBlank = vi.fn();
    render(<TemplatePicker onPick={vi.fn()} onStartBlank={onStartBlank} />);
    const filters = screen.getByRole("group", { name: /filter templates/i });
    fireEvent.click(within(filters).getByRole("button", { name: /Writing & feedback/ }));
    const blank = screen.getByRole("button", { name: /Start from scratch/ });
    fireEvent.click(blank);
    expect(onStartBlank).toHaveBeenCalledTimes(1);
    expect(blank).toHaveAttribute("aria-pressed", "true");
  });

  it("derives a family for every template so the filter can never hide one", () => {
    const covered = new Set(ACTIVITY_TEMPLATES.map((t) => templateFamily(t).id));
    expect([...covered].sort()).toEqual(["dialogue", "lab", "sim", "writing"]);
  });
});
