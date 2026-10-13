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
  fetchSimPreview: vi.fn(),
}));
vi.mock("@/lib/simDraftsApi", () => api);
const simsApi = vi.hoisted(() => ({
  listMyTeacherSims: vi.fn(),
  publishSimVersion: vi.fn(),
  requestLibrary: vi.fn(),
  withdrawTeacherSim: vi.fn(),
  listLibraryRequests: vi.fn(),
  decideLibrary: vi.fn(),
  TeacherSimError: class extends Error {
    constructor(
      m: string,
      readonly reasons: string[],
    ) {
      super(m);
    }
  },
}));
vi.mock("@/lib/teacherSimsApi", () => simsApi);
const me = vi.hoisted(() => ({ researcher: false }));
vi.mock("@/lib/teacherFeaturesApi", () => ({
  fetchMyFeatures: () => Promise.resolve({ features: { simWorkshop: true }, researcher: me.researcher }),
}));

import SimWorkshopPage from "@/app/teacher/sims/page";

function render(ui: ReactElement) {
  return rtlRender(<LocaleProvider locale="en">{ui}</LocaleProvider>);
}

beforeEach(() => {
  me.researcher = false;
  simsApi.listMyTeacherSims.mockResolvedValue([]);
  simsApi.listLibraryRequests.mockResolvedValue([]);
  feature.on = true;
  feature.access = "on";
  frames.loads = [];
  process.env.NEXT_PUBLIC_MCP_SANDBOX_URL = "https://sandbox.example/sandbox.html";
  api.fetchSimScreenshot.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  api.fetchSimFile.mockResolvedValue(new Blob(["<html>"], { type: "application/octet-stream" }));
  api.fetchSimPreview.mockResolvedValue(new Blob(["<html><head></head>"], { type: "text/plain" }));
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
    // with the real bridge stamped (server) and the no-network lockdown (client)
    const html = await frames.loads[0]();
    expect(api.fetchSimPreview).toHaveBeenCalledWith("d1", 2);
    expect(html).toContain("connect-src 'none'");
  });

  it("shows what each sim has cost so far, and a draft still being written", async () => {
    api.listSimDrafts.mockResolvedValue([
      {
        id: "d2",
        title: null,
        latestVersion: 0,
        latestLevel: null,
        artefactId: null,
        updatedAt: "x",
        usage: { tokensIn: 250_000, tokensOut: 30_000, tokensThinking: 32_000, costUsd: 0.4231, calls: 4 },
      },
    ]);
    api.getSimDraft.mockResolvedValue({ id: "d2", title: null, artefactId: null, versions: [] });
    render(<SimWorkshopPage />);
    expect(await screen.findByTestId("draft-cost")).toHaveTextContent("≈ $0.42 so far · 312k tokens");
    expect(screen.getByText("Being written…")).toBeInTheDocument();
  });

  it("shows an error when the drafts cannot be loaded", async () => {
    api.listSimDrafts.mockRejectedValue(new Error("500"));
    render(<SimWorkshopPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your drafts.");
  });

  it("publishes a level-3 version only after the teacher's approval, and says where to find it", async () => {
    api.listSimDrafts.mockResolvedValue([
      { id: "d1", title: "Pendul", latestVersion: 2, latestLevel: 3, artefactId: "pendul", updatedAt: "x" },
    ]);
    api.getSimDraft.mockResolvedValue({
      id: "d1",
      title: "Pendul",
      artefactId: "pendul",
      versions: [{ version: 2, level: 3, reasons: [], createdAt: "x", screenshots: [] }],
    });
    simsApi.publishSimVersion.mockResolvedValue({
      id: "pendul",
      displayName: "Pendul",
      version: 1,
      scope: "classes",
      status: "live",
      draftId: "d1",
      draftVersion: 2,
      approvedBy: "t1@example.dk",
      approvedAt: "x",
      libraryRequested: false,
      librarySignoff: null,
      libraryDeclined: null,
    });
    render(<SimWorkshopPage />);
    const button = await screen.findByTestId("sim-publish-button");
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByTestId("sim-publish-approve"));
    fireEvent.click(button);
    await waitFor(() => expect(simsApi.publishSimVersion).toHaveBeenCalledWith("d1", 2));
    expect(await screen.findByTestId("sim-published")).toHaveTextContent("version 1 (from draft version 2)");
    expect(screen.getByText(/Pick it under Simulation/)).toBeInTheDocument();
    expect(screen.queryByTestId("sim-publish-button")).toBeNull();
  });

  it("will not offer publishing below level 3, and shows the server's reasons when it refuses", async () => {
    api.listSimDrafts.mockResolvedValue([
      { id: "d1", title: "Pendul", latestVersion: 1, latestLevel: 2, artefactId: "pendul", updatedAt: "x" },
    ]);
    api.getSimDraft.mockResolvedValue({
      id: "d1",
      title: "Pendul",
      artefactId: "pendul",
      versions: [{ version: 1, level: 2, reasons: ["did not move"], createdAt: "x", screenshots: [] }],
    });
    render(<SimWorkshopPage />);
    expect(await screen.findByText(/Only a version at level 3/)).toBeInTheDocument();
    expect(screen.queryByTestId("sim-publish-button")).toBeNull();

    api.getSimDraft.mockResolvedValue({
      id: "d1",
      title: "Pendul",
      artefactId: "pendul",
      versions: [{ version: 2, level: 3, reasons: [], createdAt: "x", screenshots: [] }],
    });
    simsApi.publishSimVersion.mockRejectedValue(
      new simsApi.TeacherSimError("publish sim: 422", ["A.no_external_fetch: line 3: https://x.example/"]),
    );
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    fireEvent.click(await screen.findByTestId("sim-publish-approve"));
    fireEvent.click(screen.getByTestId("sim-publish-button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("A.no_external_fetch");
  });

  it("asks for the library and shows that it is waiting", async () => {
    const live = {
      id: "pendul",
      displayName: "Pendul",
      version: 1,
      scope: "classes" as const,
      status: "live" as const,
      draftId: "d1",
      draftVersion: 1,
      approvedBy: "t1@example.dk",
      approvedAt: "x",
      libraryRequested: false,
      librarySignoff: null,
      libraryDeclined: null,
    };
    simsApi.listMyTeacherSims.mockResolvedValue([live]);
    simsApi.requestLibrary.mockResolvedValue({ ...live, libraryRequested: true });
    api.listSimDrafts.mockResolvedValue([
      { id: "d1", title: "Pendul", latestVersion: 1, latestLevel: 3, artefactId: "pendul", updatedAt: "x" },
    ]);
    api.getSimDraft.mockResolvedValue({
      id: "d1",
      title: "Pendul",
      artefactId: "pendul",
      versions: [{ version: 1, level: 3, reasons: [], createdAt: "x", screenshots: [] }],
    });
    render(<SimWorkshopPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask to share it with all teachers" }));
    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
    await waitFor(() => expect(simsApi.requestLibrary).toHaveBeenCalledWith("pendul", ""));
    expect(await screen.findByTestId("sim-library-requested")).toBeInTheDocument();
  });

  it("shows researchers the library requests, and teachers do not see them", async () => {
    api.listSimDrafts.mockResolvedValue([]);
    simsApi.listLibraryRequests.mockResolvedValue([
      {
        id: "pendul",
        displayName: "Pendul",
        version: 1,
        scope: "classes",
        status: "live",
        draftId: "d1",
        draftVersion: 1,
        approvedBy: "t1@example.dk",
        approvedAt: "x",
        libraryRequested: true,
        librarySignoff: null,
        libraryDeclined: null,
        request: { note: "used it twice", at: "2026-10-13T20:00:00Z", version: 1 },
      },
    ]);
    simsApi.decideLibrary.mockResolvedValue({});
    const { unmount } = render(<SimWorkshopPage />);
    await screen.findByTestId("sim-workshop-empty");
    expect(screen.queryByTestId("sim-library-review")).toBeNull();
    unmount();

    me.researcher = true;
    render(<SimWorkshopPage />);
    expect(await screen.findByTestId("sim-review-pendul")).toHaveTextContent("used it twice");
    fireEvent.click(screen.getByRole("button", { name: "Approve for the library" }));
    await waitFor(() => expect(simsApi.decideLibrary).toHaveBeenCalledWith("pendul", true, ""));
  });
});
