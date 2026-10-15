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

  it("marks teacher-made sims: the teacher's own, and reviewed library ones", async () => {
    listArtefactsMock.mockResolvedValue([
      ...CATALOGUE,
      { ...CATALOGUE[0], id: "pendul", displayName: "Pendul", source: "teacher", scope: "classes" },
      { ...CATALOGUE[0], id: "otto-mine", displayName: "Otto", source: "teacher", scope: "library" },
    ]);
    render(<SimPicker value={null} onChange={vi.fn()} />);
    expect(await screen.findByTestId("sim-picker-teacher-pendul")).toHaveTextContent("Your sim");
    expect(screen.getByTestId("sim-picker-teacher-otto-mine")).toHaveTextContent("reviewed");
    expect(screen.queryByTestId("sim-picker-teacher-boldkast")).toBeNull();
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

  it("filters a long library by search and level, and says when nothing matches", async () => {
    const many = Array.from({ length: 8 }, (_, n) => ({
      ...CATALOGUE[0],
      id: `sim-${n}`,
      displayName: `Sim ${n}`,
      topics: n === 3 ? ["sorte huller"] : ["mekanik"],
      levels: (n % 2 ? ["A"] : ["B"]) as never[],
    }));
    listArtefactsMock.mockResolvedValue(many);
    render(<SimPicker value={null} onChange={vi.fn()} />);
    const search = await screen.findByRole("searchbox");
    fireEvent.change(search, { target: { value: "sorte" } });
    expect(screen.getByTestId("sim-picker-sim-3")).toBeInTheDocument();
    expect(screen.queryByTestId("sim-picker-sim-1")).toBeNull();

    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "stx A" }));
    expect(screen.getByTestId("sim-picker-sim-1")).toBeInTheDocument();
    expect(screen.queryByTestId("sim-picker-sim-2")).toBeNull();

    fireEvent.change(search, { target: { value: "nothing like this" } });
    expect(screen.getByText("No simulations match.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByTestId("sim-picker-sim-2")).toBeInTheDocument();
  });

  it("shows no filter for a short catalogue", async () => {
    render(<SimPicker value={null} onChange={vi.fn()} />);
    await screen.findByTestId("sim-picker-boldkast");
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
