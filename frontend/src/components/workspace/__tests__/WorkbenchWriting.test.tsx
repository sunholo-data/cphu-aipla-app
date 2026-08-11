import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WRITING_CARD_DEBOUNCE_MS,
  WRITING_PUSH_CHAR_CAP,
  WRITING_SAVE_DEBOUNCE_MS,
  WorkbenchWriting,
  clipForPush,
  countWords,
  type WritingElementDef,
} from "../WorkbenchWriting";

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
}));
import { fetchWithAuth } from "@/lib/apiClient";

// The "shared with the AI" trust card — the wiring that keeps getting dropped
// on this axis (calculator and table both shipped without it).
const dispatch = vi.fn();
vi.mock("@/hooks/useHumanToolEvents", () => ({ useHumanToolEvents: () => ({ dispatch }) }));

// The proactive trigger is how "Bed om feedback" sends a real chat turn.
const onProactiveTrigger = vi.fn();
vi.mock("@/contexts/ProactiveSimContext", () => ({
  useOptionalProactiveSimOptsRef: () => ({ current: { skillId: "s", onProactiveTrigger } }),
}));

const WRITING: WritingElementDef = {
  id: "writing-1",
  title: "Konklusion",
  prompt: "Skriv jeres konklusion",
  minWords: 150,
};

/** Requests the component makes, split by endpoint. */
function calls() {
  const all = vi.mocked(fetchWithAuth).mock.calls;
  return {
    saves: all.filter(([url]) => String(url).includes("/writing") && !String(url).includes("iframe-context")),
    pushes: all.filter(([url]) => String(url).includes("iframe-context")),
  };
}

function pushBody(i = 0) {
  const [, opts] = calls().pushes[i];
  return JSON.parse((opts as RequestInit).body as string);
}

async function type(text: string) {
  const box = screen.getByLabelText("Konklusion");
  fireEvent.change(box, { target: { value: text } });
  return box;
}

/** Let the initial store load settle so the component is `loaded`. */
async function renderLoaded(props: Partial<Parameters<typeof WorkbenchWriting>[0]> = {}) {
  render(<WorkbenchWriting skillId="skill-1" activityId="act-1" writing={[WRITING]} {...props} />);
  await waitFor(() => expect(screen.getByLabelText("Konklusion")).toBeInTheDocument());
  await act(async () => {});
  vi.mocked(fetchWithAuth).mockClear();
}

describe("WorkbenchWriting — pure helpers", () => {
  it("counts words the same way the server does", () => {
    expect(countWords("  et   to  tre ")).toBe(3);
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });

  it("does not clip text within the push cap", () => {
    const short = "a".repeat(WRITING_PUSH_CHAR_CAP);
    expect(clipForPush(short)).toEqual({ text: short, truncated: false });
  });

  it("keeps the opening AND the tail when clipping, and says it clipped", () => {
    // The tail is what the student is working on now; the opening is what the
    // piece set out to be. Keeping only one of them makes the tutor's comment
    // confidently wrong about the other half.
    const long = `${"START".padEnd(3000, "x")}${"END".padStart(3000, "y")}`;
    const out = clipForPush(long);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThan(long.length);
    expect(out.text.startsWith("START")).toBe(true);
    expect(out.text.endsWith("END")).toBe(true);
  });
});

describe("WorkbenchWriting", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.sessionStorage.clear();
    vi.mocked(fetchWithAuth).mockClear();
    dispatch.mockClear();
    onProactiveTrigger.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("renders the teacher's prompt, the box, and the word target", async () => {
    await renderLoaded();
    expect(screen.getByText("Skriv jeres konklusion")).toBeInTheDocument();
    expect(screen.getByLabelText("Konklusion")).toBeInTheDocument();
    expect(screen.getByText(/af 150/)).toBeInTheDocument();
  });

  it("counts words as the student types", async () => {
    await renderLoaded();
    await type("et to tre");
    expect(screen.getByText(/^3 ord/)).toBeInTheDocument();
  });

  it("autosaves ONCE per idle burst, not per keystroke", async () => {
    await renderLoaded({ sessionId: "sess-1" });
    await type("f");
    await type("fi");
    await type("first draft");
    expect(calls().saves).toHaveLength(0); // nothing yet — still typing

    await act(async () => {
      vi.advanceTimersByTime(WRITING_SAVE_DEBOUNCE_MS);
    });

    expect(calls().saves).toHaveLength(1);
    const [, opts] = calls().saves[0];
    expect(JSON.parse((opts as RequestInit).body as string)).toEqual({
      elementId: "writing-1",
      text: "first draft",
    });
  });

  it("pushes the text to the tutor so it can comment without a copy-paste", async () => {
    await renderLoaded({ sessionId: "sess-1" });
    await type("Vi konkluderer at bølgelængden er konstant");
    await act(async () => {
      vi.advanceTimersByTime(WRITING_SAVE_DEBOUNCE_MS);
    });

    expect(calls().pushes).toHaveLength(1);
    const body = pushBody();
    expect(body.serverId).toBe("writing");
    // Calculator-shaped: EVERY element in one array, matched by id — not the
    // table's one-snapshot-per-key shape (the 1.1.71 defect).
    expect(body.structuredContent.docs).toHaveLength(1);
    expect(body.structuredContent.docs[0].id).toBe("writing-1");
    expect(body.structuredContent.docs[0].words).toBe(6);
    expect(body.structuredContent.docs[0].truncated).toBe(false);
    expect(body.structuredContent.lastEvent ?? body.lastEvent).toContain("writing");
  });

  it("dispatches exactly ONE trust card per writing burst", async () => {
    // The dropped-card bug, netted. A card per save would spam the chat; no
    // card at all leaves the student unable to see their work reached the tutor.
    await renderLoaded({ sessionId: "sess-1" });

    await type("en sætning");
    await act(async () => {
      vi.advanceTimersByTime(WRITING_SAVE_DEBOUNCE_MS);
    });
    await type("en sætning mere til");
    await act(async () => {
      vi.advanceTimersByTime(WRITING_SAVE_DEBOUNCE_MS);
    });
    expect(dispatch).not.toHaveBeenCalled(); // still within the burst

    await act(async () => {
      vi.advanceTimersByTime(WRITING_CARD_DEBOUNCE_MS);
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].label).toBe("Din tekst delt med vejlederen (4 ord)");
  });

  it("does not card an empty document", async () => {
    await renderLoaded({ sessionId: "sess-1" });
    await type("noget");
    await type("");
    await act(async () => {
      vi.advanceTimersByTime(WRITING_SAVE_DEBOUNCE_MS + WRITING_CARD_DEBOUNCE_MS);
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("the trust card reuses the in-flight push instead of POSTing twice", async () => {
    await renderLoaded({ sessionId: "sess-1" });
    await type("noget skrevet");
    await act(async () => {
      vi.advanceTimersByTime(WRITING_SAVE_DEBOUNCE_MS + WRITING_CARD_DEBOUNCE_MS);
    });
    expect(calls().pushes).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not push at all before a session exists", async () => {
    await renderLoaded(); // no sessionId
    await type("skrevet før første tur");
    await act(async () => {
      vi.advanceTimersByTime(WRITING_SAVE_DEBOUNCE_MS + WRITING_CARD_DEBOUNCE_MS);
    });
    expect(calls().pushes).toHaveLength(0);
    expect(calls().saves).toHaveLength(1); // the SAVE still happens
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("catches up silently when the session arrives, with no card", async () => {
    // Students write before the first chat turn, and a student returning to a
    // saved draft has a NEW session with nothing pushed. The catch-up is not
    // something the student just did, so it must not produce a card.
    const { rerender } = render(
      <WorkbenchWriting skillId="skill-1" activityId="act-1" writing={[WRITING]} sessionId={null} />,
    );
    await waitFor(() => expect(screen.getByLabelText("Konklusion")).toBeInTheDocument());
    await act(async () => {});
    await type("skrevet før session");
    await act(async () => {
      vi.advanceTimersByTime(WRITING_SAVE_DEBOUNCE_MS);
    });
    vi.mocked(fetchWithAuth).mockClear();
    dispatch.mockClear();

    rerender(<WorkbenchWriting skillId="skill-1" activityId="act-1" writing={[WRITING]} sessionId="sess-1" />);
    await act(async () => {});

    expect(calls().pushes).toHaveLength(1);
    expect(pushBody().structuredContent.docs[0].words).toBe(3);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("commits on blur without waiting out the debounce", async () => {
    await renderLoaded({ sessionId: "sess-1" });
    const box = await type("færdig");
    fireEvent.blur(box);
    expect(calls().saves).toHaveLength(1);
  });

  it("says 'ikke gemt' when the save fails, and keeps the text", async () => {
    await renderLoaded({ sessionId: "sess-1" });
    vi.mocked(fetchWithAuth).mockImplementation((url) =>
      String(url).includes("iframe-context")
        ? Promise.resolve(new Response(null, { status: 204 }))
        : Promise.resolve(new Response(null, { status: 500 })),
    );

    const box = await type("vigtig tekst");
    await act(async () => {
      vi.advanceTimersByTime(WRITING_SAVE_DEBOUNCE_MS);
    });

    await waitFor(() => expect(screen.getByText(/ikke gemt/i)).toBeInTheDocument());
    // Never a silent loss: the words are still on screen and in the buffer.
    expect((box as HTMLTextAreaElement).value).toBe("vigtig tekst");
    expect(window.sessionStorage.getItem("aipla.writing:act-1")).toContain("vigtig tekst");
  });

  it("'Bed om feedback' sends the FULL text as a turn, and no card", async () => {
    // Reading is continuous; commenting is on request — so the tutor does not
    // interrupt a half-written sentence. The turn IS the confirmation, so a
    // trust card here would be a second, redundant signal.
    await renderLoaded({ sessionId: "sess-1" });
    const long = "ord ".repeat(2000).trim(); // ~8000 chars, over the push cap
    await type(long);
    dispatch.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /bed om feedback/i }));

    expect(onProactiveTrigger).toHaveBeenCalledTimes(1);
    const sent = onProactiveTrigger.mock.calls[0][0] as string;
    expect(sent).toContain(long); // the WHOLE text, not the clipped push
    expect(sent).toContain("Konklusion");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("disables 'Bed om feedback' with nothing written", async () => {
    await renderLoaded({ sessionId: "sess-1" });
    expect((screen.getByRole("button", { name: /bed om feedback/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps several writing surfaces independent", async () => {
    const two: WritingElementDef[] = [
      { id: "writing-1", title: "Metode" },
      { id: "writing-2", title: "Konklusion" },
    ];
    render(<WorkbenchWriting skillId="skill-1" activityId="act-1" writing={two} sessionId="sess-1" />);
    await waitFor(() => expect(screen.getByLabelText("Metode")).toBeInTheDocument());
    await act(async () => {});
    vi.mocked(fetchWithAuth).mockClear();

    fireEvent.change(screen.getByLabelText("Metode"), { target: { value: "vi målte" } });
    await act(async () => {
      vi.advanceTimersByTime(WRITING_SAVE_DEBOUNCE_MS);
    });

    // One save, scoped to the element the student typed in.
    expect(JSON.parse((calls().saves[0][1] as RequestInit).body as string).elementId).toBe("writing-1");
    // But the push carries BOTH, so the tutor can tell an untouched surface
    // from one it simply has not been told about.
    expect(pushBody().structuredContent.docs.map((d: { id: string }) => d.id)).toEqual(["writing-1", "writing-2"]);
  });
});
