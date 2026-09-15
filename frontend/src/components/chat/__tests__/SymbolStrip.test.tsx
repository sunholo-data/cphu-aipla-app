import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import {
  PHYSICS_SYMBOLS,
  SYMBOL_STRIP_WINK_KEY,
  SYMBOL_STRIP_WINK_MS,
  SymbolStrip,
  SymbolStripToggle,
  useSymbolStrip,
} from "../SymbolStrip";
import { insertAtCaret, restoreCaret } from "@/lib/insertAtCaret";

/** The shape both call sites use: parent owns value + open state. */
function Composer({ wink = false, lang }: { wink?: boolean; lang?: string }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement | null>(null);
  const strip = useSymbolStrip({ wink });
  return (
    <div>
      <SymbolStrip
        id="strip"
        open={strip.open}
        lang={lang}
        onInsert={(g) => {
          const el = ref.current;
          const r = insertAtCaret(value, g, el?.selectionStart, el?.selectionEnd);
          setValue(r.value);
          restoreCaret(el, r.caret);
        }}
      />
      <input ref={ref} aria-label="msg" value={value} onChange={(e) => setValue(e.target.value)} />
      <SymbolStripToggle controlsId="strip" open={strip.open} onToggle={strip.toggle} lang={lang} />
    </div>
  );
}

// jsdom's localStorage is not usable in this project's vitest setup (see
// useAutoReadAloud.test.ts) — stub an in-memory shim, and let a test swap in
// a throwing one.
let storage: Record<string, string>;
function installStorage(stub?: Partial<Storage>) {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (k in storage ? storage[k] : null),
      setItem: (k: string, v: string) => {
        storage[k] = v;
      },
      removeItem: (k: string) => {
        delete storage[k];
      },
      clear: () => {
        storage = {};
      },
      key: () => null,
      length: 0,
      ...stub,
    },
  });
}

beforeEach(() => {
  storage = {};
  installStorage();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SymbolStrip", () => {
  it("is closed by default and the toggle opens it with aria-expanded", () => {
    render(<Composer />);
    expect(screen.queryByRole("toolbar")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Vis fysiksymboler" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("toolbar", { name: "Fysiksymboler" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skjul fysiksymboler" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button").length).toBe(PHYSICS_SYMBOLS.length + 1);
  });

  it("inserts at the caret, not the end, and keeps focus in the field", () => {
    render(<Composer />);
    fireEvent.click(screen.getByRole("button", { name: /fysiksymboler/i }));
    const input = screen.getByLabelText("msg") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "v = 3 m/s" } });
    input.focus();
    input.setSelectionRange(0, 0);

    const chip = screen.getByRole("button", { name: "Δ — delta" });
    // The mousedown must be cancelled so the input never blurs.
    const md = fireEvent.mouseDown(chip);
    expect(md).toBe(false);
    fireEvent.click(chip);
    expect(input.value).toBe("Δv = 3 m/s");

    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);

    // A second glyph goes after the first — the caret moved with it.
    fireEvent.click(screen.getByRole("button", { name: "θ — theta" }));
    expect(input.value).toBe("Δθv = 3 m/s");
  });

  it("names the operators in English for an English activity", () => {
    render(<Composer lang="en-GB" />);
    fireEvent.click(screen.getByRole("button", { name: "Show physics symbols" }));
    expect(screen.getByRole("button", { name: "² — squared" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Δ — delta" })).toBeInTheDocument();
  });

  it("winks open on a first visit, closes after the wink, and never winks again on that device", () => {
    const { unmount } = render(<Composer wink />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(window.localStorage.getItem(SYMBOL_STRIP_WINK_KEY)).toBe("1");
    act(() => {
      vi.advanceTimersByTime(SYMBOL_STRIP_WINK_MS + 1);
    });
    expect(screen.queryByRole("toolbar")).toBeNull();
    unmount();

    render(<Composer wink />);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("a tap during the wink keeps the strip open instead of closing it", () => {
    render(<Composer wink />);
    fireEvent.click(screen.getByRole("button", { name: "Skjul fysiksymboler" }));
    act(() => {
      vi.advanceTimersByTime(SYMBOL_STRIP_WINK_MS + 1);
    });
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });

  it("does not wink without the flag (the writing element)", () => {
    render(<Composer />);
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(window.localStorage.getItem(SYMBOL_STRIP_WINK_KEY)).toBeNull();
  });

  it("survives storage that throws", () => {
    const boom = () => {
      throw new Error("private mode");
    };
    installStorage({ getItem: boom, setItem: boom });
    render(<Composer wink />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });
});
