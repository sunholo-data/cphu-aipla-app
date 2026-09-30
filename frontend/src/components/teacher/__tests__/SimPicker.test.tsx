import { fireEvent, render as rtlRender, screen, type RenderOptions } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listArtefactsMock = vi.fn();
vi.mock("@/lib/teacherApi", () => ({
  listArtefacts: () => listArtefactsMock(),
}));

import { SimPicker } from "../SimPicker";

import { LocaleProvider } from "@/i18n";

// 1.1.108 M2 — these tests assert the English copy; the teacher UI defaults to
// Danish, so render inside an English locale (the teacher chose EN).
function EnglishUI({ children }: { children: React.ReactNode }) {
  return <LocaleProvider locale="en">{children}</LocaleProvider>;
}
const render = (ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: EnglishUI, ...options });

const CATALOGUE = [
  {
    id: "boldkast",
    displayName: "Boldkast",
    description: "Projektilbevægelse",
    topics: [],
    levels: [],
    language: "da",
    artefactPath: "boldkast/v1",
    status: "live",
  },
  {
    id: "kinebot",
    displayName: "KineBot",
    description: "Kinematics",
    topics: [],
    levels: [],
    language: "en",
    artefactPath: "kinebot/v1",
    status: "live",
  },
];

describe("SimPicker", () => {
  beforeEach(() => {
    listArtefactsMock.mockReset();
    listArtefactsMock.mockResolvedValue(CATALOGUE);
  });

  it("lists the catalogue and selects one", async () => {
    const onChange = vi.fn();
    render(<SimPicker value={null} onChange={onChange} />);
    fireEvent.click(await screen.findByText("Boldkast"));
    expect(onChange).toHaveBeenCalledWith("boldkast");
  });

  it("shows the selected sim and removes it", async () => {
    const onChange = vi.fn();
    render(<SimPicker value="boldkast" onChange={onChange} />);
    expect(await screen.findByText("Boldkast")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove simulation/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("handles an empty catalogue gracefully", async () => {
    listArtefactsMock.mockResolvedValue([]);
    render(<SimPicker value={null} onChange={vi.fn()} />);
    expect(await screen.findByText(/no simulations available/i)).toBeInTheDocument();
  });
});
