import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";

// The preview reads the sandbox origin when its module loads, so set it before any import.
vi.hoisted(() => {
});
const feature = vi.hoisted(() => ({ on: true, access: "on" as "on" | "off" | "loading" }));
vi.mock("@/hooks/useTeacherFeature", () => ({ useTeacherFeature: () => feature.on }));
vi.mock("@/hooks/useMyFeature", () => ({ useMyFeature: () => feature.access }));
// The live preview is the shared sandbox frame (its own suite); stub it and record what it was given.
const frames = vi.hoisted(() => ({ loads: [] as Array<() => Promise<string>> }));
vi.mock("@/components/workspace/StaticArtefactFrame", () => ({
  StaticArtefactFrame: (p: { loadHtml?: () => Promise<string>; title?: string }) => {
    if (p.loadHtml) frames.loads.push(p.loadHtml);
    return <div data-testid="sim-preview">{p.title}</div>;
  },
}));
// The floating assistant is the shared TeacherCopilot (its own suite); stub it here.
vi.mock("@/components/teacher/copilot", () => ({
  TeacherCopilot: (p: { skillName: string }) => <div data-testid="copilot">{p.skillName}</div>,
}));
const api = vi.hoisted(() => ({
  listSimDrafts: vi.fn(),
  getSimDraft: vi.fn(),
  fetchSimScreenshot: vi.fn(),
  fetchSimFile: vi.fn(),
}));
vi.mock("@/lib/simDraftsApi", () => api);

import SimWorkshopPage from "@/app/teacher/sims/page";

function render(ui: ReactElement) {
  return rtlRender(<LocaleProvider locale="en">{ui}</LocaleProvider>);
}

beforeEach(() => {
  feature.on = true;
  feature.access = "on";
  frames.loads = [];
  process.env.NEXT_PUBLIC_MCP_SANDBOX_URL = "https://sandbox.example/sandbox.html";
  api.fetchSimScreenshot.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  api.fetchSimFile.mockResolvedValue(new Blob(["<html>"], { type: "application/octet-stream" }));
  globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.clearAllMocks());

describe("Sim workshop page", () => {
  it("says it is not switched on when the flag is off, and calls nothing", () => {
    feature.on = false;
    render(<SimWorkshopPage />);
    expect(screen.getByText(/not switched on/)).toBeInTheDocument();
    expect(api.listSimDrafts).not.toHaveBeenCalled();
    expect(screen.queryByTestId("copilot")).toBeNull();
  });

  it("shows a teacher without the feature how to ask, and calls nothing", () => {
    feature.access = "off";
    render(<SimWorkshopPage />);
    expect(screen.getByTestId("sim-workshop-locked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask to have it switched on" })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:"),
    );
    expect(api.listSimDrafts).not.toHaveBeenCalled();
    expect(screen.queryByTestId("copilot")).toBeNull();
  });

  it("shows the empty state and the sim-author assistant when there are no drafts", async () => {
    api.listSimDrafts.mockResolvedValue([]);
    render(<SimWorkshopPage />);
    expect(await screen.findByTestId("sim-workshop-empty")).toBeInTheDocument();
    expect(screen.getByTestId("copilot")).toHaveTextContent("sim-author");
  });

  it("shows the latest version with its level, what stopped it, screenshots and downloads", async () => {
    api.listSimDrafts.mockResolvedValue([
      { id: "d1", title: "Four-stroke engine", latestVersion: 2, latestLevel: 1, artefactId: "otto", updatedAt: "x" },
    ]);
    api.getSimDraft.mockResolvedValue({
      id: "d1",
      title: "Four-stroke engine",
      artefactId: "otto",
      versions: [
        { version: 1, level: 3, reasons: [], createdAt: "a", screenshots: ["700", "driven"] },
        { version: 2, level: 1, reasons: ["L2: 700px: overflows by 6px"], createdAt: "b", screenshots: ["700"] },
      ],
    });
    render(<SimWorkshopPage />);
    const latest = await screen.findByTestId("sim-version-2");
    expect(latest).toHaveTextContent("Level 1 of 3");
    expect(latest).toHaveTextContent("overflows by 6px");
    await waitFor(() => expect(api.fetchSimScreenshot).toHaveBeenCalledWith("d1", 2, "700"));
    fireEvent.click(screen.getAllByText("Download index.html")[0]);
    await waitFor(() => expect(api.fetchSimFile).toHaveBeenCalledWith("d1", 2, "index.html"));
    // older versions stay reachable
    expect(screen.getByTestId("sim-version-1")).toBeInTheDocument();
    // the live preview runs the latest version through the shared sandbox frame
    expect(screen.getByTestId("sim-preview")).toHaveTextContent("Preview of version 2");
    await frames.loads[0]();
    expect(api.fetchSimFile).toHaveBeenCalledWith("d1", 2, "index.html");
  });

  it("shows an error when the drafts cannot be loaded", async () => {
    api.listSimDrafts.mockRejectedValue(new Error("500"));
    render(<SimWorkshopPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your drafts.");
  });
});
