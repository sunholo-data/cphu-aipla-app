/**
 * 1.1.151 F6 — "Gem som noter": a tutor reply saved into the student's own
 * writing surface, by the STUDENT, appended (never overwriting), and shared
 * with the tutor like any edit of that surface — the push AND the trust card.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SaveNotesButton } from "@/components/chat/SaveNotesButton";
import { MessageBubble } from "@/components/chat/MessageBubble";
import type { WritingElement } from "@/lib/elementTypes";
import { WorkbenchWriting } from "../WorkbenchWriting";
import {
  createTutorNotesBridge,
  SaveNotesProvider,
  TutorNotesBridgeProvider,
  useSaveTutorNotes,
} from "../tutorNotes";

vi.mock("@/components/protocols/A2UIRenderer", () => ({ A2UIRenderer: () => null }));
vi.mock("@/components/protocols/MCPAppToolCallRouter", () => ({ MCPAppToolCallRouter: () => null }));

let storedText = "Min egen tekst.";
let saveStatus = 200;
vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn((url: string, opts?: RequestInit) => {
    if (String(url).includes("iframe-context")) return Promise.resolve(new Response(null, { status: 204 }));
    if (String(url).includes("/writing") && (!opts || !opts.method || opts.method === "GET")) {
      return Promise.resolve(
        new Response(JSON.stringify({ docs: { "writing-1": { text: storedText, words: 3, revision: 1, updatedAt: "" } } }), {
          status: 200,
        }),
      );
    }
    if (String(url).includes("/writing")) {
      return Promise.resolve(
        new Response(JSON.stringify({ text: "", words: 0, revision: 2, updatedAt: "" }), { status: saveStatus }),
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  }),
}));
import { fetchWithAuth } from "@/lib/apiClient";

const dispatch = vi.fn();
vi.mock("@/hooks/useHumanToolEvents", () => ({ useHumanToolEvents: () => ({ dispatch }) }));
vi.mock("@/contexts/ProactiveSimContext", () => ({ useOptionalProactiveSimOptsRef: () => null }));

const WRITING: WritingElement = { id: "writing-1", title: "Konklusion" };
const REPLY = "## Opsummering\n\n* **Energien** er bevaret.\n* Se [læreplanen](aitana://doc/d1/block/0).";

function calls() {
  const all = vi.mocked(fetchWithAuth).mock.calls;
  return {
    gets: all.filter(([url, o]) => String(url).includes("/writing") && !(o as RequestInit | undefined)?.method),
    puts: all.filter(([, o]) => (o as RequestInit | undefined)?.method === "PUT"),
    pushes: all.filter(([url]) => String(url).includes("iframe-context")),
  };
}
const body = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

function Harness({
  writing,
  mountWriting = false,
  activityId = "act-1",
}: {
  writing: WritingElement[];
  mountWriting?: boolean;
  activityId?: string;
}) {
  const [bridge] = useState(createTutorNotesBridge);
  const action = useSaveTutorNotes({ bridge, writing, activityId, sessionId: "sess-1" });
  return (
    <SaveNotesProvider value={action}>
      <SaveNotesButton text={REPLY} />
      <TutorNotesBridgeProvider value={bridge}>
        {mountWriting ? (
          <WorkbenchWriting skillId="skill-1" activityId={activityId} sessionId="sess-1" writing={writing} />
        ) : null}
      </TutorNotesBridgeProvider>
    </SaveNotesProvider>
  );
}

function memoryStorage(): Storage {
  let data: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(data).length;
    },
    key: (i: number) => Object.keys(data)[i] ?? null,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = String(v);
    },
    removeItem: (k: string) => {
      delete data[k];
    },
    clear: () => {
      data = {};
    },
  };
}

beforeEach(() => {
  storedText = "Min egen tekst.";
  saveStatus = 200;
  vi.mocked(fetchWithAuth).mockClear();
  dispatch.mockClear();
  // A fresh store per test: Node 22 (CI) keeps jsdom storage across a file's
  // tests, Node ≥ 25 shadows it — see the CLAUDE.md Node-version footgun.
  Object.defineProperty(window, "sessionStorage", { value: memoryStorage(), configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const press = () => fireEvent.click(screen.getByRole("button", { name: /gem dette svar som noter/i }));

describe("Gem som noter — the writing element is mounted", () => {
  it("appends under a heading after the student's own text, and saves it", async () => {
    render(<Harness writing={[WRITING]} mountWriting />);
    const box = (await screen.findByLabelText("Konklusion")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe("Min egen tekst."));
    vi.mocked(fetchWithAuth).mockClear();

    await act(async () => press());

    expect(box.value.startsWith("Min egen tekst.\n\nNoter fra tutoren (")).toBe(true);
    expect(box.value).toContain("Energien er bevaret.");
    // Markdown and the chat-only link target do not land in a textarea.
    expect(box.value).not.toMatch(/\*\*|aitana:\/\/|##/);
    expect(box.value).toContain("Se læreplanen.");
    const { puts } = calls();
    expect(puts).toHaveLength(1);
    expect(body(puts[0]).text).toBe(box.value);
    expect(await screen.findByRole("status")).toHaveTextContent("Gemt nederst i «Konklusion»");
  });

  it("reaches the tutor: one push carrying the new text AND one trust card", async () => {
    render(<Harness writing={[WRITING]} mountWriting />);
    await screen.findByLabelText("Konklusion");
    await act(async () => {});
    vi.mocked(fetchWithAuth).mockClear();

    await act(async () => press());

    const { pushes } = calls();
    expect(pushes).toHaveLength(1);
    const pushed = body(pushes[0]);
    expect(pushed.serverId).toBe("writing");
    expect(pushed.structuredContent.docs[0].text).toContain("Energien er bevaret.");
    expect(pushed.label).toMatch(/gemt som noter i «Konklusion»/);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].label).toBe(pushed.label);
  });

  it("supersedes a pending autosave instead of racing it — nothing the student typed is lost", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Harness writing={[WRITING]} mountWriting />);
      const box = (await screen.findByLabelText("Konklusion")) as HTMLTextAreaElement;
      await waitFor(() => expect(box.value).toBe("Min egen tekst."));
      fireEvent.change(box, { target: { value: "Min egen tekst. Og en ny sætning" } });
      vi.mocked(fetchWithAuth).mockClear();

      await act(async () => press());
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      const { puts } = calls();
      expect(puts).toHaveLength(1);
      expect(body(puts[0]).text.startsWith("Min egen tekst. Og en ny sætning\n\nNoter fra tutoren")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("changes nothing when the notes would not fit under the character limit", async () => {
    render(<Harness writing={[{ ...WRITING, maxChars: 30 }]} mountWriting />);
    const box = (await screen.findByLabelText("Konklusion")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe("Min egen tekst."));
    vi.mocked(fetchWithAuth).mockClear();

    await act(async () => press());

    expect(box.value).toBe("Min egen tekst.");
    expect(calls().puts).toHaveLength(0);
    expect(calls().pushes).toHaveLength(0);
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("ikke plads");
  });
});

describe("Gem som noter — the writing element is NOT mounted (a sim is open)", () => {
  it("reads the store, appends, writes back, pushes and cards", async () => {
    render(<Harness writing={[WRITING]} />);
    await act(async () => press());

    const { gets, puts, pushes } = calls();
    expect(gets).toHaveLength(1);
    expect(puts).toHaveLength(1);
    expect(body(puts[0]).elementId).toBe("writing-1");
    expect(body(puts[0]).text.startsWith("Min egen tekst.\n\nNoter fra tutoren (")).toBe(true);
    expect(pushes).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Gemt nederst i «Konklusion»");
  });

  it("appends to an unsaved buffered edit, which is newer than the store", async () => {
    window.sessionStorage.setItem("aipla.writing:act-1", JSON.stringify({ "writing-1": "Offline-udkast" }));
    render(<Harness writing={[WRITING]} />);
    await act(async () => press());

    const { puts } = calls();
    expect(body(puts[0]).text.startsWith("Offline-udkast\n\nNoter fra tutoren")).toBe(true);
    // The buffer's job is done once the store has it.
    expect(JSON.parse(window.sessionStorage.getItem("aipla.writing:act-1") || "{}")).toEqual({});
  });

  it("keeps the appended text in the buffer when the save fails, and says so", async () => {
    saveStatus = 500;
    render(<Harness writing={[WRITING]} />);
    await act(async () => press());

    const buf = JSON.parse(window.sessionStorage.getItem("aipla.writing:act-1") || "{}");
    expect(buf["writing-1"]).toContain("Energien er bevaret.");
    expect(screen.getByRole("status")).toHaveTextContent("ikke gemt endnu");
  });
});

describe("Gem som noter — the activity has no writing surface", () => {
  it("copies the reply as plain text instead, says so, and shares nothing with the tutor", async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Harness writing={[]} />);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /kopiér dette svar/i })),
    );

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("Energien er bevaret.");
    expect(writeText.mock.calls[0][0]).not.toContain("**");
    expect(vi.mocked(fetchWithAuth)).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("intet skriveområde, så svaret er kopieret");
  });

  it("says what to do when the clipboard refuses", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    render(<Harness writing={[]} />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /kopiér dette svar/i })),
    );
    expect(screen.getByRole("status")).toHaveTextContent("kunne ikke kopieres");
  });
});

describe("Gem som noter — where the button appears", () => {
  const baseProps = {
    skillId: "s",
    userInitial: "A",
    userDisplayName: "Gruppe",
    toolCalls: [],
    navigateToBlock: vi.fn(),
    onAction: vi.fn(),
  };
  const action = { save: vi.fn(), target: "writing" as const };

  it("is offered under a tutor reply in a student activity chat", () => {
    render(
      <SaveNotesProvider value={action}>
        <MessageBubble message={{ id: "b1", role: "assistant", content: "Svar" }} {...baseProps} />
      </SaveNotesProvider>,
    );
    expect(screen.getByRole("button", { name: /gem dette svar som noter/i })).toBeInTheDocument();
  });

  it("is never offered under the student's own message", () => {
    render(
      <SaveNotesProvider value={action}>
        <MessageBubble message={{ id: "u1", role: "user", content: "Spørgsmål" }} {...baseProps} />
      </SaveNotesProvider>,
    );
    expect(screen.queryByRole("button", { name: /gem/i })).toBeNull();
  });

  it("is absent where the page provides no action (teacher chats, the builder preview)", () => {
    render(<MessageBubble message={{ id: "b1", role: "assistant", content: "Svar" }} {...baseProps} />);
    expect(screen.queryByRole("button", { name: /gem dette svar/i })).toBeNull();
  });
});
