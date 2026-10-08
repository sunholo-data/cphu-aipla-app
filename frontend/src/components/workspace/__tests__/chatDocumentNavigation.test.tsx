// 1.1.147 M3b — a document named in the chat opens it in the workbench.
//
// Both ends, through the same store the chat page owns: the chip in a tutor
// message (ChatMarkdown → InlineCitation → navigateToBlock) and the reader
// (DocumentsPanel), plus the Documents tab coming forward (WorkbenchTabs).
import { act, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { DocumentsPanel, type ActivityMaterial } from "@/components/workspace/DocumentsPanel";
import { WorkbenchTabs } from "@/components/workspace/WorkbenchTabs";
import {
  createDocumentRequestStore,
  DocumentRequestProvider,
  type DocumentRequestStore,
} from "@/components/workspace/documentRequest";

const fetchCurriculumContent = vi.fn();
vi.mock("@/lib/curriculumApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/curriculumApi")>("@/lib/curriculumApi");
  return { ...actual, fetchCurriculumContent: (...a: unknown[]) => fetchCurriculumContent(...a) };
});
const reportDocumentEvent = vi.fn();
vi.mock("@/lib/documentApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/documentApi")>("@/lib/documentApi");
  return { ...actual, reportDocumentEvent: (...a: unknown[]) => reportDocumentEvent(...a) };
});

const materials: ActivityMaterial[] = [
  { docId: "d1", origin: "Fysik C læreplan", studentVisible: true },
  { docId: "d2", origin: "Vejledning til Fysik C", studentVisible: true },
  { docId: "d3", origin: "Prompt for Energi.pdf", studentVisible: false },
];

function Harness({ store, content, tabs = false }: { store: DocumentRequestStore; content: string; tabs?: boolean }) {
  const panel = <DocumentsPanel materials={materials} images={[]} activityId="act-1" sessionId="sess-nav" />;
  return (
    <LocaleProvider locale="en">
      <ChatMarkdown content={content} navigateToBlock={(docId) => store.request(docId)} />
      <DocumentRequestProvider value={store}>
        {tabs ? <WorkbenchTabs work={<p>tools</p>} documents={panel} docCount={2} /> : panel}
      </DocumentRequestProvider>
    </LocaleProvider>
  );
}
const render = (ui: React.ReactElement) => rtlRender(ui);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  fetchCurriculumContent.mockImplementation(async (docId: string) => ({
    docId,
    title: docId,
    available: true,
    text: `Body of ${docId}.`,
    chars: 20,
  }));
});

describe("a document named in the chat", () => {
  it("opens that document in the reader when it is shared", async () => {
    const store = createDocumentRequestStore();
    render(<Harness store={store} content="Se [Vejledning til Fysik C](aitana://doc/d2/block/0)." />);
    await waitFor(() => expect(screen.getByText("Body of d1.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Vejledning til Fysik C/ }));
    await waitFor(() => expect(screen.getByText("Body of d2.")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "Vejledning til Fysik C" })).toHaveAttribute("aria-selected", "true");
    // Clicking a chip IS the student's choice.
    expect(reportDocumentEvent).toHaveBeenCalledWith("sess-nav", { kind: "document.open", docId: "d2" });
    // Consumed: nothing left pending to replay on a remount.
    expect(store.get()).toBeNull();
  });

  it("explains, and fetches nothing, when the teacher has not shared it", async () => {
    const store = createDocumentRequestStore();
    render(<Harness store={store} content="Se [prompten](aitana://doc/d3/block/0)." />);
    await waitFor(() => expect(screen.getByText("Body of d1.")).toBeInTheDocument());
    fetchCurriculumContent.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /prompten/ }));
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("Prompt for Energi.pdf");
    expect(notice).toHaveTextContent(/your teacher has not shared the contents/i);
    expect(fetchCurriculumContent).not.toHaveBeenCalled();
    expect(store.get()).toBeNull();
  });

  // 1.1.147 M3c — the tutor writes these links itself now. The backend teaches
  // exactly `[Title](aitana://doc/{docId}/block/0)` (adk/document_links.py) and
  // reduces a link to a not-shared document to its words before it is streamed
  // or stored. Both shapes, as a finished tutor turn renders them:
  it("M3c: the link the tutor is taught opens the document from a finished tutor turn", async () => {
    const store = createDocumentRequestStore();
    const navigate = vi.fn((docId: string) => store.request(docId));
    rtlRender(
      <LocaleProvider locale="en">
        <MessageBubble
          message={{
            id: "t1",
            role: "assistant",
            content: "Læs i [Vejledning til Fysik C](aitana://doc/d2/block/0) — og se også lærerens egen prompt.",
          }}
          skillId="s"
          userInitial="A"
          userDisplayName="Gruppe"
          toolCalls={[]}
          navigateToBlock={navigate}
          onAction={vi.fn()}
        />
        <DocumentRequestProvider value={store}>
          <DocumentsPanel materials={materials} images={[]} activityId="act-1" sessionId="sess-nav" />
        </DocumentRequestProvider>
      </LocaleProvider>,
    );
    await waitFor(() => expect(screen.getByText("Body of d1.")).toBeInTheDocument());
    // The guard's output — the not-shared document's words — is text, not a control.
    expect(screen.queryByRole("button", { name: /lærerens egen prompt/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Vejledning til Fysik C/ }));
    expect(navigate).toHaveBeenCalledWith("d2", "0");
    await waitFor(() => expect(screen.getByText("Body of d2.")).toBeInTheDocument());
  });

  it("brings the Documents tab forward when the workbench is on its tools", async () => {
    const store = createDocumentRequestStore();
    render(<Harness store={store} content="Se [læreplanen](aitana://doc/d2/block/0)." tabs />);
    expect(screen.getByText("tools")).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /læreplanen/ }));
    });
    await waitFor(() => expect(screen.getByText("Body of d2.")).toBeInTheDocument());
  });
});
