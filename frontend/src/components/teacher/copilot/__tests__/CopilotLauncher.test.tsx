import { act, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";
import {
  CopilotEntryProvider,
  CopilotLauncherClearance,
  useCopilotBottomInset,
} from "@/components/teacher/copilot/CopilotEntryContext";
import { NUDGE_DELAY_MS, NUDGE_VISIBLE_MS, nudgeStorageKey } from "@/components/teacher/copilot/CopilotLauncher";
import { FloatingCopilot } from "@/components/teacher/copilot/FloatingCopilot";

function render(ui: ReactElement) {
  return rtlRender(<LocaleProvider locale="en">{ui}</LocaleProvider>);
}

// The nudge's "seen" mark is a per-viewer convenience in localStorage. Supply a
// fresh in-memory one per test: on CI's Node 22 jsdom's storage persists across
// a file's tests, on Node >= 25 it does not persist at all (CLAUDE.md footgun).
const store = new Map<string, string>();
function memoryStorage() {
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}
function throwingStorage() {
  const boom = () => {
    throw new Error("SecurityError: storage disabled");
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}
function setStorage(value: unknown) {
  Object.defineProperty(window, "localStorage", { configurable: true, value });
}
function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

const NUDGE = "I can suggest a goal, tools and a concept map.";

function Copilot({ kind = "activity-authoring-assistant" }: { kind?: string }) {
  return (
    <FloatingCopilot title="Build helper" nudge={NUDGE} nudgeKind={kind}>
      <p>chat body</p>
    </FloatingCopilot>
  );
}

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  store.clear();
  setStorage(memoryStorage());
  setReducedMotion(false);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the work co-pilot's launcher (2026-11-12)", () => {
  it("shows a pill only when a work co-pilot is registered in the shell", () => {
    const { unmount } = render(
      <CopilotEntryProvider>
        <p>a page with no co-pilot</p>
      </CopilotEntryProvider>,
    );
    expect(screen.queryByTestId("copilot-fab")).not.toBeInTheDocument();
    unmount();

    render(
      <CopilotEntryProvider>
        <Copilot />
      </CopilotEntryProvider>,
    );
    const pill = screen.getByTestId("copilot-fab");
    expect(pill).toHaveTextContent("Build helper");
  });

  it("opens the panel, and the pill hides while it is open", () => {
    render(
      <CopilotEntryProvider>
        <Copilot />
      </CopilotEntryProvider>,
    );
    fireEvent.click(screen.getByTestId("copilot-fab"));
    expect(screen.getByTestId("copilot-panel").classList.contains("hidden")).toBe(false);
    expect(screen.queryByTestId("copilot-fab")).not.toBeInTheDocument();
  });

  it("nudges once per kind: after the delay, then never again for that kind", () => {
    const first = render(
      <CopilotEntryProvider>
        <Copilot />
      </CopilotEntryProvider>,
    );
    // Not with the page: it waits.
    expect(screen.queryByTestId("copilot-nudge")).not.toBeInTheDocument();
    wait(NUDGE_DELAY_MS);
    expect(screen.getByTestId("copilot-nudge")).toHaveTextContent(NUDGE);
    // Announced once, politely; the visible copy is not read a second time.
    const announcer = screen.getByTestId("copilot-nudge-announcer");
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveTextContent(NUDGE);
    // Never steals focus.
    expect(screen.getByTestId("copilot-nudge")).not.toContainElement(document.activeElement as HTMLElement);
    expect(store.get(nudgeStorageKey("activity-authoring-assistant"))).toBe("1");
    first.unmount();

    // Same kind again (the editor after the wizard): no nudge.
    const second = render(
      <CopilotEntryProvider>
        <Copilot />
      </CopilotEntryProvider>,
    );
    wait(NUDGE_DELAY_MS + NUDGE_VISIBLE_MS);
    expect(screen.queryByTestId("copilot-nudge")).not.toBeInTheDocument();
    expect(screen.getByTestId("copilot-nudge-announcer")).toBeEmptyDOMElement();
    second.unmount();

    // A different kind of helper gets its own first time.
    render(
      <CopilotEntryProvider>
        <Copilot kind="manage-class" />
      </CopilotEntryProvider>,
    );
    wait(NUDGE_DELAY_MS);
    expect(screen.getByTestId("copilot-nudge")).toBeInTheDocument();
  });

  it("folds back into the pill on its own after a while", () => {
    render(
      <CopilotEntryProvider>
        <Copilot />
      </CopilotEntryProvider>,
    );
    wait(NUDGE_DELAY_MS);
    expect(screen.getByTestId("copilot-nudge")).toBeInTheDocument();
    wait(NUDGE_VISIBLE_MS);
    expect(screen.queryByTestId("copilot-nudge")).not.toBeInTheDocument();
    expect(screen.getByTestId("copilot-fab")).toBeInTheDocument();
  });

  it("goes on dismiss, and at the first interaction anywhere", () => {
    const { unmount } = render(
      <CopilotEntryProvider>
        <Copilot />
      </CopilotEntryProvider>,
    );
    wait(NUDGE_DELAY_MS);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss tip" }));
    expect(screen.queryByTestId("copilot-nudge")).not.toBeInTheDocument();
    unmount();

    store.clear();
    render(
      <CopilotEntryProvider>
        <Copilot />
        <input aria-label="goal" />
      </CopilotEntryProvider>,
    );
    wait(NUDGE_DELAY_MS);
    expect(screen.getByTestId("copilot-nudge")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("goal"), { key: "a" });
    expect(screen.queryByTestId("copilot-nudge")).not.toBeInTheDocument();
  });

  it("does not nudge once the teacher opened the helper themselves", () => {
    render(
      <CopilotEntryProvider>
        <Copilot />
      </CopilotEntryProvider>,
    );
    fireEvent.click(screen.getByTestId("copilot-fab"));
    wait(NUDGE_DELAY_MS + NUDGE_VISIBLE_MS);
    expect(screen.queryByTestId("copilot-nudge")).not.toBeInTheDocument();
    expect(store.get(nudgeStorageKey("activity-authoring-assistant"))).toBe("1");
  });

  it("fails quiet when storage throws: no nudge, the pill still shows", () => {
    setStorage(throwingStorage());
    render(
      <CopilotEntryProvider>
        <Copilot />
      </CopilotEntryProvider>,
    );
    wait(NUDGE_DELAY_MS + NUDGE_VISIBLE_MS);
    expect(screen.queryByTestId("copilot-nudge")).not.toBeInTheDocument();
    expect(screen.getByTestId("copilot-fab")).toBeInTheDocument();
  });

  it("with reduced motion, just appears — no slide", () => {
    setReducedMotion(true);
    render(
      <CopilotEntryProvider>
        <Copilot />
      </CopilotEntryProvider>,
    );
    wait(NUDGE_DELAY_MS);
    const nudge = screen.getByTestId("copilot-nudge");
    expect(nudge).toHaveAttribute("data-motion", "none");
    expect(nudge.className).not.toMatch(/slide-in|animate-in/);
  });

  it("slides in when motion is fine", () => {
    render(
      <CopilotEntryProvider>
        <Copilot />
      </CopilotEntryProvider>,
    );
    wait(NUDGE_DELAY_MS);
    expect(screen.getByTestId("copilot-nudge")).toHaveAttribute("data-motion", "slide");
  });

  it("outside the teacher shell there is the plain pill and no nudge", () => {
    render(<Copilot />);
    wait(NUDGE_DELAY_MS);
    expect(screen.getByTestId("copilot-fab")).toBeInTheDocument();
    expect(screen.queryByTestId("copilot-nudge")).not.toBeInTheDocument();
    expect(store.size).toBe(0);
  });

  it("sits above a bar the page keeps at its bottom edge, pill and panel alike", () => {
    // jsdom lays nothing out; give the footer the height a real one has.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { height: this.dataset.testid === "footer" ? 72 : 0 } as DOMRect;
    });
    function StickyFooter() {
      return <div data-testid="footer" ref={useCopilotBottomInset<HTMLDivElement>()} />;
    }
    const { rerender } = render(
      <CopilotEntryProvider>
        <Copilot />
        <StickyFooter />
        <CopilotLauncherClearance />
      </CopilotEntryProvider>,
    );
    const launcher = screen.getByTestId("copilot-launcher");
    expect(launcher.style.getPropertyValue("--copilot-bottom-offset")).toBe("72px");
    expect(launcher.className).toContain("bottom-[calc(1rem+var(--copilot-bottom-offset,0px))]");
    const panel = screen.getByTestId("copilot-panel");
    expect(panel.style.getPropertyValue("--copilot-bottom-offset")).toBe("72px");
    expect(panel.className).toContain("sm:bottom-[calc(1rem+var(--copilot-bottom-offset,0px))]");

    // The footer goes (the teacher left the wizard): the offset goes with it.
    rerender(
      <LocaleProvider locale="en">
        <CopilotEntryProvider>
          <Copilot />
        </CopilotEntryProvider>
      </LocaleProvider>,
    );
    expect(screen.getByTestId("copilot-launcher").style.getPropertyValue("--copilot-bottom-offset")).toBe("0px");
  });
});
