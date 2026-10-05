import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { DocumentsPanel } from "@/components/workspace/DocumentsPanel";
import type React from "react";
import { LocaleProvider } from "@/i18n";

// 1.1.108 — these assertions are about the English copy, so render in English
// (the component default with no provider is Danish, the activity default).
function render(ui: React.ReactElement) {
  return rtlRender(ui, {
    wrapper: ({ children }) => <LocaleProvider locale="en">{children}</LocaleProvider>,
  });
}


afterEach(() => vi.clearAllMocks());

// A fresh in-memory localStorage per test (1.1.147 M3 remembers the chosen
// document). Node >= 25 ships a global localStorage that shadows jsdom's, and
// on the CI's Node 22 jsdom's would persist across this file's tests — either
// way, a test must not inherit the previous one's choice.
let store: Map<string, string>;
function installStorage(impl?: Partial<Storage>) {
  store = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      ...impl,
    },
  });
}

beforeEach(() => {
  installStorage();
  fetchCurriculumContent.mockImplementation(async (docId: string) => ({
    docId,
    title: docId,
    available: true,
    text: `Body of ${docId}.`,
    chars: 9 + docId.length,
  }));
});

const fetchCurriculumContent = vi.fn();
vi.mock("@/lib/curriculumApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/curriculumApi")>(
    "@/lib/curriculumApi",
  );
  return {
    ...actual,
    fetchCurriculumContent: (...a: unknown[]) => fetchCurriculumContent(...a),
  };
});

const fetchActivityImageObjectUrl = vi.fn();
vi.mock("@/lib/activityImageApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/activityImageApi")>(
    "@/lib/activityImageApi",
  );
  return {
    ...actual,
    fetchActivityImageObjectUrl: (...a: unknown[]) => fetchActivityImageObjectUrl(...a),
  };
});

const reportDocumentEvent = vi.fn();
vi.mock("@/lib/documentApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/documentApi")>("@/lib/documentApi");
  return { ...actual, reportDocumentEvent: (...a: unknown[]) => reportDocumentEvent(...a) };
});

// jsdom has no object-URL lifecycle; the component revokes on unmount.
URL.revokeObjectURL = vi.fn();

describe("DocumentsPanel", () => {
  it("returns null when there are no materials and no uploads", () => {
    const { container } = render(<DocumentsPanel materials={[]} images={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows shared docs prominently and cites not-shared ones by name (not contents)", () => {
    render(
      <DocumentsPanel
        materials={[
          { docId: "d1", origin: "A-level kinematics", studentVisible: true },
          { docId: "d2", origin: "Teacher worksheet", studentVisible: false },
        ]}
        images={[]}
      />,
    );
    // Shared doc is shown prominently + openable.
    expect(screen.getByText("A-level kinematics")).toBeTruthy();
    // Not-shared doc: its NAME is cited (visible, transparency), but not openable.
    expect(screen.getByText(/also used by the tutor/i)).toBeTruthy();
    expect(screen.getByText("Teacher worksheet")).toBeTruthy();
    // The not-shared name is plain text, NOT a clickable open-content button.
    expect(screen.queryByRole("button", { name: /Teacher worksheet/i })).toBeNull();
  });

  it("cites every not-shared material by name", () => {
    render(
      <DocumentsPanel
        materials={[
          { docId: "a", origin: "One", studentVisible: false },
          { docId: "b", origin: "Two", studentVisible: false },
        ]}
        images={[]}
      />,
    );
    expect(screen.getByText(/also used by the tutor/i)).toBeTruthy();
    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByText("Two")).toBeTruthy();
  });

  it("renders an uploads gallery from session images", () => {
    render(
      <DocumentsPanel
        materials={[]}
        images={[{ mimeType: "image/png", data: "AAAA" }]}
      />,
    );
    expect(screen.getByText(/your uploads/i)).toBeTruthy();
    expect(screen.getByRole("img", { name: "your upload" })).toBeTruthy();
  });

  it("opens the only shared doc by default, with the student token (1.1.147 M3)", async () => {
    fetchCurriculumContent.mockResolvedValue({
      docId: "d1",
      title: "A-level kinematics",
      available: true,
      text: "Newton's second law: F = m a.",
      chars: 29,
    });
    render(
      <DocumentsPanel
        materials={[{ docId: "d1", origin: "A-level kinematics", studentVisible: true }]}
        images={[]}
        activityId="act-1"
      />,
    );
    // Student workbench MUST use the anonymous-group token, not teacher auth
    // (else 401 — a student has no Firebase identity).
    expect(fetchCurriculumContent).toHaveBeenCalledWith("d1", "act-1", { as: "student" });
    await waitFor(() =>
      expect(screen.getByText(/Newton's second law/)).toBeInTheDocument(),
    );
    // One shared document → a reader with its title, no switcher.
    expect(screen.getByRole("heading", { name: "A-level kinematics" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders a teacher-shared image material as an image (1.1.44 M4)", async () => {
    fetchActivityImageObjectUrl.mockResolvedValue("blob:fake-url");
    render(
      <DocumentsPanel
        materials={[
          {
            kind: "image",
            docId: "",
            origin: "",
            studentVisible: true,
            materialId: "img-1",
            mimeType: "image/png",
            alt: "free-body diagram",
          },
        ]}
        images={[]}
        activityId="act-1"
      />,
    );
    // Fetched with the student token (default role) against the bound activity.
    await waitFor(() =>
      expect(fetchActivityImageObjectUrl).toHaveBeenCalledWith("act-1", "img-1", "student"),
    );
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "free-body diagram" })).toBeInTheDocument(),
    );
  });

  it("does NOT fetch a not-shared image; lists it by name only (1.1.44 M4)", () => {
    render(
      <DocumentsPanel
        materials={[
          {
            kind: "image",
            docId: "",
            origin: "",
            studentVisible: false,
            materialId: "img-2",
            mimeType: "image/png",
            alt: "secret graph",
          },
        ]}
        images={[]}
        activityId="act-1"
      />,
    );
    expect(fetchActivityImageObjectUrl).not.toHaveBeenCalled();
    expect(screen.getByText(/also used by the tutor/i)).toBeTruthy();
    expect(screen.getByText("secret graph")).toBeTruthy();
  });

  it("shows a graceful note when a doc has no stored content (M3)", async () => {
    fetchCurriculumContent.mockResolvedValue({
      docId: "d1",
      title: "Old doc",
      available: false,
      text: "",
      chars: 0,
    });
    render(
      <DocumentsPanel
        materials={[{ docId: "d1", origin: "Old doc", studentVisible: true }]}
        images={[]}
        activityId="act-1"
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/isn't available to read here yet/i)).toBeInTheDocument(),
    );
  });
});

describe("DocumentsPanel — a reader that is already open (1.1.147 M3)", () => {
  const two = [
    { docId: "d1", origin: "Fysik C læreplan", studentVisible: true },
    { docId: "d2", origin: "Vejledning til Fysik C", studentVisible: true },
    { docId: "d3", origin: "Prompt for Energi.pdf", studentVisible: false },
  ];

  it("opens the FIRST shared document and shows a tab per shared document", async () => {
    render(<DocumentsPanel materials={two} images={[]} activityId="act-1" sessionId="s-first" />);
    await waitFor(() => expect(screen.getByText("Body of d1.")).toBeInTheDocument());
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["Fysik C læreplan", "Vejledning til Fysik C"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    // The not-shared one is never a tab.
    expect(screen.queryByRole("tab", { name: /Prompt for Energi/ })).toBeNull();
  });

  it("reports document.default_shown for the automatic open — not document.open — once per session", async () => {
    const { unmount } = render(
      <DocumentsPanel materials={two} images={[]} activityId="act-1" sessionId="s-default" />,
    );
    await waitFor(() => expect(screen.getByText("Body of d1.")).toBeInTheDocument());
    expect(reportDocumentEvent).toHaveBeenCalledWith("s-default", {
      kind: "document.default_shown",
      docId: "d1",
      detail: { remembered: false },
    });
    expect(reportDocumentEvent).not.toHaveBeenCalledWith(
      "s-default",
      expect.objectContaining({ kind: "document.open" }),
    );
    unmount();
    // Remounting (the workbench tabs unmount a hidden panel) does not re-emit.
    render(<DocumentsPanel materials={two} images={[]} activityId="act-1" sessionId="s-default" />);
    await waitFor(() => expect(screen.getByText("Body of d1.")).toBeInTheDocument());
    const defaults = reportDocumentEvent.mock.calls.filter(
      ([, e]) => (e as { kind: string }).kind === "document.default_shown",
    );
    expect(defaults).toHaveLength(1);
  });

  it("a tab click opens that document, reports document.open and is remembered for the activity", async () => {
    const { unmount } = render(
      <DocumentsPanel materials={two} images={[]} activityId="act-1" sessionId="s-click" />,
    );
    await waitFor(() => expect(screen.getByText("Body of d1.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Vejledning til Fysik C" }));
    await waitFor(() => expect(screen.getByText("Body of d2.")).toBeInTheDocument());
    expect(reportDocumentEvent).toHaveBeenCalledWith("s-click", { kind: "document.open", docId: "d2" });
    expect(store.get("aipla.documents.selected:act-1")).toBe("d2");
    unmount();
    // On return, the last choice wins over "first".
    render(<DocumentsPanel materials={two} images={[]} activityId="act-1" sessionId="s-click-2" />);
    await waitFor(() => expect(screen.getByText("Body of d2.")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "Vejledning til Fysik C" })).toHaveAttribute("aria-selected", "true");
  });

  it("arrow keys move between tabs", async () => {
    render(<DocumentsPanel materials={two} images={[]} activityId="act-1" />);
    await waitFor(() => expect(screen.getByText("Body of d1.")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText("Body of d2.")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "Vejledning til Fysik C" })).toHaveFocus();
  });

  it("the narrow-screen select switches documents too", async () => {
    render(<DocumentsPanel materials={two} images={[]} activityId="act-1" />);
    await waitFor(() => expect(screen.getByText("Body of d1.")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox", { name: /choose a document/i }), { target: { value: "d2" } });
    await waitFor(() => expect(screen.getByText("Body of d2.")).toBeInTheDocument());
  });

  it("ignores a remembered document that is no longer shared", async () => {
    store.set("aipla.documents.selected:act-1", "d3");
    render(<DocumentsPanel materials={two} images={[]} activityId="act-1" />);
    await waitFor(() => expect(screen.getByText("Body of d1.")).toBeInTheDocument());
    expect(fetchCurriculumContent).not.toHaveBeenCalledWith("d3", expect.anything(), expect.anything());
  });

  it("works when browser storage throws", async () => {
    installStorage({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    render(<DocumentsPanel materials={two} images={[]} activityId="act-1" />);
    await waitFor(() => expect(screen.getByText("Body of d1.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Vejledning til Fysik C" }));
    await waitFor(() => expect(screen.getByText("Body of d2.")).toBeInTheDocument());
  });

  it("M3a: a not-shared material is explained and has no button", () => {
    render(
      <DocumentsPanel
        materials={[{ docId: "d3", origin: "Prompt for Energi.pdf", studentVisible: false }]}
        images={[]}
        activityId="act-1"
      />,
    );
    expect(screen.getByText(/your teacher has not shared the contents/i)).toBeInTheDocument();
    expect(screen.getByText("Prompt for Energi.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Prompt for Energi/ })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("zero shared documents → no empty reader; nothing is fetched", () => {
    const { container } = render(
      <DocumentsPanel
        materials={[
          { docId: "d1", origin: "Fysik C læreplan", studentVisible: false },
          { docId: "d2", origin: "Vejledning til Fysik C", studentVisible: false },
        ]}
        images={[]}
        activityId="act-1"
      />,
    );
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    expect(fetchCurriculumContent).not.toHaveBeenCalled();
    // The not-shared list is open when it is all there is.
    expect(container.querySelector("details")).toHaveAttribute("open");
  });
});
