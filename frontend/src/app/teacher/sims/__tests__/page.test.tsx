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
// It reports its conversation like the real one: `chat.thread` on mount, and the
// thread of any resume request the page sends it.
const chat = vi.hoisted(() => ({ thread: "d1", resumes: [] as string[], focused: [] as string[] }));
vi.mock("@/components/teacher/copilot", async () => {
  const React = await import("react");
  return {
    TeacherCopilot: (p: {
      skillName: string;
      resume?: { threadId: string; seq: number; focus?: boolean } | null;
      onThreadChange?: (id: string) => void;
    }) => {
      const [thread, setThread] = React.useState(chat.thread);
      React.useEffect(() => {
        if (p.resume) {
          chat.resumes.push(p.resume.threadId);
          if (p.resume.focus) chat.focused.push(p.resume.threadId);
          setThread(p.resume.threadId);
        }
      }, [p.resume]);
      const { onThreadChange } = p;
      React.useEffect(() => onThreadChange?.(thread), [thread, onThreadChange]);
      return (
        <div data-testid="copilot" data-thread={thread}>
          {p.skillName}
        </div>
      );
    },
  };
});
const api = vi.hoisted(() => ({
  listSimDrafts: vi.fn(),
  getSimDraft: vi.fn(),
  fetchSimScreenshot: vi.fn(),
  fetchSimFile: vi.fn(),
  fetchSimPreview: vi.fn(),
  importSimDraft: vi.fn(),
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
  chat.thread = "d1";
  chat.resumes = [];
  chat.focused = [];
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

  it("with no drafts, the empty state IS a big New simulation button that brings the chat forward", async () => {
    api.listSimDrafts.mockResolvedValue([]);
    render(<SimWorkshopPage />);
    const empty = await screen.findByTestId("sim-workshop-empty");
    const button = screen.getByTestId("sim-new");
    expect(empty).toContainElement(button);
    expect(screen.getAllByTestId("sim-new")).toHaveLength(1);
    fireEvent.click(button);
    await waitFor(() => expect(chat.focused).toHaveLength(1));
    expect(chat.focused[0]).not.toBe("d1");
  });

  it("New simulation sits beside the drafts and leaves the open draft's chat for a fresh one", async () => {
    chat.thread = "s1";
    api.listSimDrafts.mockResolvedValue([
      { id: "d1", sessionId: "s1", title: "Pendul", latestVersion: 1, latestLevel: 3, artefactId: "pendul", updatedAt: "y" },
    ]);
    api.getSimDraft.mockResolvedValue({
      id: "d1",
      sessionId: "s1",
      title: "Pendul",
      artefactId: "pendul",
      versions: [{ version: 1, level: 3, reasons: [], createdAt: "x", screenshots: [] }],
    });
    render(<SimWorkshopPage />);
    expect(await screen.findByTestId("draft-chat-link")).toHaveTextContent("use New simulation");
    const button = screen.getByTestId("sim-new");
    expect(screen.getByRole("navigation", { name: "Your drafts" })).toContainElement(button);
    expect(button).not.toHaveAttribute("aria-current");

    fireEvent.click(button);
    await waitFor(() => expect(chat.focused).toHaveLength(1));
    const fresh = chat.focused[0];
    expect(fresh).not.toBe("s1");
    await waitFor(() => expect(screen.getByTestId("copilot")).toHaveAttribute("data-thread", fresh));
    // The old draft is no longer the chat's, and the page says a new sim is under way.
    expect(await screen.findByText(/You are starting a new simulation/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pendul/ })).not.toHaveAttribute("aria-current");
    expect(button).toHaveAttribute("aria-current", "true");
  });

  it("shows the latest version with its level, what stopped it, screenshots and downloads", async () => {
    api.listSimDrafts.mockResolvedValue([
      { id: "d1", sessionId: "d1", title: "Four-stroke engine", latestVersion: 2, latestLevel: 1, artefactId: "otto", updatedAt: "x" },
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
    api.getSimDraft.mockResolvedValue({ id: "d2", sessionId: "d2", title: null, artefactId: null, versions: [] });
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
      { id: "d1", sessionId: "d1", title: "Pendul", latestVersion: 2, latestLevel: 3, artefactId: "pendul", updatedAt: "x" },
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
      { id: "d1", sessionId: "d1", title: "Pendul", latestVersion: 1, latestLevel: 2, artefactId: "pendul", updatedAt: "x" },
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

  it("shows the sim the current chat built, and picking another reopens its chat", async () => {
    chat.thread = "s2";
    api.listSimDrafts.mockResolvedValue([
      { id: "d1", sessionId: "s1", title: "Pendul", latestVersion: 1, latestLevel: 3, artefactId: "pendul", updatedAt: "y" },
      { id: "d2", sessionId: "s2", title: "Carts", latestVersion: 1, latestLevel: 3, artefactId: "carts", updatedAt: "x" },
    ]);
    api.getSimDraft.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        sessionId: id === "d1" ? "s1" : "s2",
        title: id === "d1" ? "Pendul" : "Carts",
        artefactId: id,
        versions: [{ version: 1, level: 3, reasons: [], createdAt: "x", screenshots: [] }],
      }),
    );
    render(<SimWorkshopPage />);
    // Not the newest draft: the one the assistant's open chat built.
    expect(await screen.findByTestId("draft-chat-link")).toBeInTheDocument();
    await waitFor(() => expect(api.getSimDraft).toHaveBeenCalledWith("d2"));
    expect(screen.getByRole("button", { name: /Carts/ })).toHaveAttribute("aria-current", "true");

    fireEvent.click(screen.getByRole("button", { name: /Pendul/ }));
    await waitFor(() => expect(screen.getByTestId("copilot")).toHaveAttribute("data-thread", "s1"));
    expect(chat.resumes).toEqual(["s1"]);
    await waitFor(() => expect(screen.getByRole("button", { name: /Pendul/ })).toHaveAttribute("aria-current", "true"));
    await waitFor(() => expect(api.getSimDraft).toHaveBeenCalledWith("d1"));
  });

  it("a new chat with no sim yet shows how to go back to an earlier one", async () => {
    chat.thread = "fresh";
    api.listSimDrafts.mockResolvedValue([
      { id: "d1", sessionId: "s1", title: "Pendul", latestVersion: 1, latestLevel: 3, artefactId: "pendul", updatedAt: "y" },
    ]);
    render(<SimWorkshopPage />);
    expect(await screen.findByText(/pick it above and its chat reopens/)).toBeInTheDocument();
    expect(api.getSimDraft).not.toHaveBeenCalled();
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
      { id: "d1", sessionId: "d1", title: "Pendul", latestVersion: 1, latestLevel: 3, artefactId: "pendul", updatedAt: "x" },
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

  it("imports a page and its catalogue as a new draft and opens its chat", async () => {
    api.listSimDrafts.mockResolvedValue([]);
    api.importSimDraft.mockResolvedValue({ draftId: "imp-1", version: 1, level: 3, reasons: [] });
    render(<SimWorkshopPage />);
    await screen.findByTestId("sim-workshop-empty");
    const page = new File(["<html>sort hul</html>"], "v9-index.html", { type: "text/html" });
    const entry = new File(["id: sort-hul\n"], "v9.yaml", { type: "application/yaml" });
    fireEvent.change(screen.getByTestId("sim-import-input"), { target: { files: [page, entry] } });
    await waitFor(() => expect(api.importSimDraft).toHaveBeenCalledWith("<html>sort hul</html>", "id: sort-hul\n"));
    expect(await screen.findByText(/Imported as a new draft: version 1, level 3 of 3/)).toBeInTheDocument();
    await waitFor(() => expect(chat.resumes).toContain("imp-1"));
  });

  it("says what to choose when no .html file was picked, and what went wrong on a refusal", async () => {
    api.listSimDrafts.mockResolvedValue([]);
    render(<SimWorkshopPage />);
    await screen.findByTestId("sim-workshop-empty");
    const entry = new File(["id: x\n"], "x.yaml");
    fireEvent.change(screen.getByTestId("sim-import-input"), { target: { files: [entry] } });
    expect(await screen.findByText(/Choose the sim's .html file/)).toBeInTheDocument();
    expect(api.importSimDraft).not.toHaveBeenCalled();
    api.importSimDraft.mockRejectedValue(new Error("the inlined /vendor/three has been changed"));
    fireEvent.change(screen.getByTestId("sim-import-input"), {
      target: { files: [new File(["<html></html>"], "s.html")] },
    });
    expect(await screen.findByText(/Could not import: the inlined/)).toBeInTheDocument();
  });
});
