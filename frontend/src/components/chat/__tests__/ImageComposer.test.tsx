import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImageUploadButtons } from "@/components/chat/ImageComposer";

/**
 * MOBILE-1 (2026-08-13) regression net.
 *
 * The camera button shipped with `hidden sm:inline-flex`, which hid it below
 * 640px — on every phone in portrait, and therefore on the only devices where
 * `capture="environment"` does anything at all. It survived unnoticed because
 * nothing rendered this component at a phone width: the desktop dev loop always
 * clears `sm`, so the button was always visible to whoever was looking.
 *
 * These assertions are deliberately about the RESPONSIVE CLASSES rather than
 * about visibility, because jsdom has no viewport and computes no media
 * queries — `toBeVisible()` would pass with the bug still present.
 */
describe("ImageUploadButtons — camera reachability on phones", () => {
  const setup = () => render(<ImageUploadButtons onFiles={vi.fn()} />);

  it("renders a camera button that requests the rear camera", () => {
    const { container } = setup();
    expect(screen.getByLabelText("Take photo")).toBeInTheDocument();
    const capture = container.querySelector('input[type="file"][capture]');
    expect(capture, "the camera input must set capture").not.toBeNull();
    expect(capture?.getAttribute("capture")).toBe("environment");
  });

  it("never hides the camera or the attach button behind a min-width breakpoint", () => {
    setup();
    for (const label of ["Take photo", "Attach image"]) {
      const cls = screen.getByLabelText(label).className;
      // `hidden sm:*` is the exact shape of the original bug: invisible on
      // phones, visible everywhere the developer was looking.
      expect(cls.split(/\s+/), `${label} is hidden at small widths`).not.toContain("hidden");
    }
  });

  it("gives both buttons a 44px touch target on phones", () => {
    // Apple HIG minimum. The composer is used outdoors, on a phone shared by
    // three students, with cold or wet fingers; the previous 34x34 target was
    // sized for a mouse. Desktop reverts to the compact icon button.
    setup();
    for (const label of ["Take photo", "Attach image"]) {
      const cls = screen.getByLabelText(label).className;
      expect(cls, `${label} touch target`).toContain("min-h-[44px]");
      expect(cls, `${label} touch target`).toContain("min-w-[44px]");
    }
  });

  it("goes inert but stays present once the per-turn image cap is reached", () => {
    // Disappearing controls are worse than disabled ones — the student cannot
    // tell "no camera here" from "you already attached three photos".
    render(<ImageUploadButtons onFiles={vi.fn()} full />);
    expect(screen.getByLabelText("Take photo")).toBeDisabled();
    expect(screen.getByLabelText("Take photo")).toBeInTheDocument();
  });
});
