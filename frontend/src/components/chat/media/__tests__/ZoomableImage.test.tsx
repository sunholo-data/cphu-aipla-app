import { describe, it, expect } from "vitest";
import { render as rtlRender, screen, fireEvent, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { LocaleProvider } from "@/i18n";
import { ZoomableImage } from "@/components/chat/media/ZoomableImage";

// 1.1.108: these assertions are about behaviour, written against the English
// labels — render under an English activity. The Danish default is covered by
// the component's own `da` assertions / i18n tests.
const EnglishActivity = ({ children }: { children: ReactNode }) => (
  <LocaleProvider locale="en">{children}</LocaleProvider>
);
const render = (ui: ReactElement, options?: RenderOptions) =>
  rtlRender(ui, { wrapper: EnglishActivity, ...options });


// Radix Dialog portals into document.body; queries below use screen (global).
describe("ZoomableImage", () => {
  it("renders the trigger thumbnail with the caller's className + cursor-zoom-in", () => {
    render(
      <ZoomableImage
        src="data:image/png;base64,AAAA"
        alt="working photo"
        triggerClassName="h-24 w-24 object-cover"
      />,
    );
    const img = screen.getByRole("img", { name: "working photo" });
    expect(img.className).toContain("h-24");
    expect(img.className).toContain("cursor-zoom-in");
  });

  it("opens the full-screen lightbox on click (and exposes a Close control)", () => {
    render(<ZoomableImage src="data:image/png;base64,AAAA" alt="working photo" />);
    // Closed initially — no Close button in the DOM.
    expect(screen.queryByLabelText("Close")).toBeNull();

    fireEvent.click(screen.getByRole("img", { name: "working photo" }));

    // Lightbox open: the Close control appears, and the (now-modal) expanded
    // image is still accessible. Radix marks the background aria-hidden, so the
    // trigger leaves the a11y tree — only the expanded copy remains queryable.
    expect(screen.getByLabelText("Close")).toBeTruthy();
    expect(screen.getByRole("img", { name: "working photo" })).toBeTruthy();
  });

  it("falls back to a broken-image chip on load error", () => {
    render(<ZoomableImage src="data:image/png;base64,bad" alt="missing" />);
    fireEvent.error(screen.getByRole("img", { name: "missing" }));
    expect(screen.queryByRole("img", { name: "missing" })).toBeNull();
    expect(screen.getByText("missing")).toBeTruthy();
  });
});
