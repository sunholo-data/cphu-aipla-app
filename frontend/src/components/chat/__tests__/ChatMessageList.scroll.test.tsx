// 1.1.147 M1 — the chat follows the conversation.
//
// The old rule measured "near bottom" AFTER content grew, so one growth step
// over 100 px read as "the student scrolled up". jsdom has no layout, so this
// file fakes the three numbers that matter (scrollHeight, clientHeight,
// scrollTop) on the scroll container and installs a ResizeObserver it can
// fire. Assertions are on scrollTop — where the student is looking — never on
// a scroll call having been made.
import { act, fireEvent, render as rtlRender, screen, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";
import type { SkillMessage } from "@/hooks/useSkillAgent";
import { ChatMessageList } from "../ChatMessageList";

vi.mock("@/components/protocols/A2UIRenderer", () => ({ A2UIRenderer: () => null }));
vi.mock("@/components/protocols/MCPAppToolCallRouter", () => ({ MCPAppToolCallRouter: () => null }));

const English = ({ children }: { children: ReactNode }) => <LocaleProvider locale="en">{children}</LocaleProvider>;
const render = (ui: ReactElement, options?: RenderOptions) => rtlRender(ui, { wrapper: English, ...options });

// ── fake layout ─────────────────────────────────────────────────────────

const SCROLLER = "overflow-y-auto";
const layout = { scrollHeight: 1000, clientHeight: 400, autoScrollEvent: true };
const scrollTops = new WeakMap<Element, number>();
const isScroller = (el: Element) => el.classList.contains(SCROLLER);
const maxTop = () => Math.max(0, layout.scrollHeight - layout.clientHeight);

const saved: Record<string, PropertyDescriptor | undefined> = {};
function stubLayout() {
  for (const key of ["scrollHeight", "clientHeight", "scrollTop", "scrollTo"]) {
    saved[key] = Object.getOwnPropertyDescriptor(Element.prototype, key);
  }
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get(this: Element) {
      return isScroller(this) ? layout.scrollHeight : 0;
    },
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: Element) {
      return isScroller(this) ? layout.clientHeight : 0;
    },
  });
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: Element, v: number) {
      const next = Math.min(Math.max(0, v), maxTop());
      const changed = next !== (scrollTops.get(this) ?? 0);
      scrollTops.set(this, next);
      // A browser fires `scroll` for programmatic scrolls too.
      if (changed && layout.autoScrollEvent) this.dispatchEvent(new Event("scroll"));
    },
  });
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value(this: Element, opts: ScrollToOptions) {
      (this as HTMLElement).scrollTop = opts.top ?? 0;
    },
  });
}
function restoreLayout() {
  for (const [key, desc] of Object.entries(saved)) {
    if (desc) Object.defineProperty(Element.prototype, key, desc);
    else delete (Element.prototype as unknown as Record<string, unknown>)[key];
  }
}

// ── controllable ResizeObserver ─────────────────────────────────────────

let observers: Array<() => void> = [];
const OriginalRO = global.ResizeObserver;
class ControlledResizeObserver {
  cb: () => void;
  constructor(cb: () => void) {
    this.cb = cb;
    observers.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    observers = observers.filter((o) => o !== this.cb);
  }
}
/** Content (or container) changed size: what the browser would report. */
function grow(byPx: number) {
  act(() => {
    layout.scrollHeight += byPx;
    observers.forEach((o) => o());
  });
}

// ── helpers ─────────────────────────────────────────────────────────────

const baseProps = {
  toolCalls: [],
  thinkingContent: "",
  isThinking: false,
  isLoading: false,
  error: null,
  skillId: "my-skill",
  userInitial: "M",
  userDisplayName: "Mark",
  onAction: () => {},
  sessionId: "sess-1",
};
const msg = (id: string, role: SkillMessage["role"], content: string): SkillMessage => ({ id, role, content });
const scroller = (container: HTMLElement) => container.querySelector(`.${SCROLLER}`) as HTMLElement;
function studentScrollsTo(el: HTMLElement, top: number) {
  act(() => {
    layout.autoScrollEvent = false;
    el.scrollTop = top;
    layout.autoScrollEvent = true;
    fireEvent.scroll(el);
  });
}

beforeEach(() => {
  layout.scrollHeight = 1000;
  layout.clientHeight = 400;
  layout.autoScrollEvent = true;
  observers = [];
  global.ResizeObserver = ControlledResizeObserver as unknown as typeof ResizeObserver;
  stubLayout();
});
afterEach(() => {
  restoreLayout();
  global.ResizeObserver = OriginalRO;
});

describe("ChatMessageList auto-scroll", () => {
  it("at the bottom, a single 600 px growth keeps the view at the bottom", () => {
    const { container } = render(<ChatMessageList messages={[msg("a1", "assistant", "Hej")]} {...baseProps} />);
    const el = scroller(container);
    expect(el.scrollTop).toBe(600);
    grow(600);
    expect(el.scrollTop).toBe(1200);
    expect(screen.queryByRole("button", { name: /new message/i })).toBeNull();
  });

  it("scrolled up 300 px, growth does not move the view; the badge appears and takes the student down", () => {
    const { container } = render(<ChatMessageList messages={[msg("a1", "assistant", "Hej")]} {...baseProps} />);
    const el = scroller(container);
    studentScrollsTo(el, 300);
    grow(500);
    expect(el.scrollTop).toBe(300);
    const badge = screen.getByRole("button", { name: /new message/i });
    act(() => {
      fireEvent.click(badge);
    });
    expect(el.scrollTop).toBe(layout.scrollHeight - layout.clientHeight);
    expect(screen.queryByRole("button", { name: /new message/i })).toBeNull();
    // ...and it follows again afterwards.
    grow(300);
    expect(el.scrollTop).toBe(layout.scrollHeight - layout.clientHeight);
  });

  it("a resumed session opens at the latest message", () => {
    layout.scrollHeight = 5000;
    const history = Array.from({ length: 30 }, (_, i) =>
      msg(`h${i}`, i % 2 ? "assistant" : "user", `Besked ${i}`),
    );
    const { container } = render(<ChatMessageList messages={[]} initialMessages={history} {...baseProps} />);
    expect(scroller(container).scrollTop).toBe(4600);
  });

  it("a resumed history that arrives after mount still lands at the bottom", () => {
    const { container } = render(<ChatMessageList messages={[]} {...baseProps} />);
    grow(4000);
    expect(scroller(container).scrollTop).toBe(layout.scrollHeight - layout.clientHeight);
  });

  it("sending a message from a scrolled-up position scrolls to the bottom", () => {
    const first = [msg("a1", "assistant", "Hej")];
    const { container, rerender } = render(<ChatMessageList messages={first} {...baseProps} />);
    const el = scroller(container);
    studentScrollsTo(el, 100);
    layout.scrollHeight += 200;
    rerender(<ChatMessageList messages={[...first, msg("u1", "user", "Hvad er E?")]} {...baseProps} />);
    expect(el.scrollTop).toBe(layout.scrollHeight - layout.clientHeight);
  });

  it("a programmatic scroll does not clear the stick state", () => {
    const { container } = render(<ChatMessageList messages={[msg("a1", "assistant", "Hej")]} {...baseProps} />);
    const el = scroller(container);
    // Our own scroll's event arrives late, after more content has landed —
    // the gap it measures is not the student's doing.
    layout.autoScrollEvent = false;
    grow(200);
    layout.scrollHeight += 400;
    act(() => {
      fireEvent.scroll(el);
    });
    layout.autoScrollEvent = true;
    grow(0);
    expect(el.scrollTop).toBe(layout.scrollHeight - layout.clientHeight);
    expect(screen.queryByRole("button", { name: /new message/i })).toBeNull();
  });
});
