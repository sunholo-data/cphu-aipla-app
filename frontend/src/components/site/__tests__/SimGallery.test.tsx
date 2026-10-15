import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";
import type { PublicSim } from "@/lib/simLibrary";

import { SimGallery } from "../SimGallery";

const SIMS: PublicSim[] = [
  {
    id: "sort-hul",
    displayName: "Kredsløb om et sort hul",
    description: "Tidsforlængelse og Einstein-ringe.",
    topics: ["relativitetsteori", "sorte huller", "astrofysik", "gravitationslinser"],
    levels: ["A"],
    language: "da",
    source: "builtin",
  },
  { id: "pendul", displayName: "Pendul", description: "", topics: [], levels: [], language: "da", source: "teacher" },
];

const renderEn = (sims: PublicSim[]) =>
  render(
    <LocaleProvider locale="en">
      <SimGallery sims={sims} />
    </LocaleProvider>,
  );

describe("SimGallery", () => {
  it("shows each library sim by its public screenshot, read-only", () => {
    renderEn(SIMS);
    expect(screen.getByText("Simulations in the library")).toBeInTheDocument();
    const img = screen.getByAltText("Screenshot of Kredsløb om et sort hul");
    expect(img).toHaveAttribute("src", "/api/proxy/api/public/sims/sort-hul/screenshot/700");
    expect(screen.queryByRole("link")).toBeNull(); // nothing to open or run
    expect(screen.getByText("stx A")).toBeInTheDocument();
    expect(screen.queryByText("gravitationslinser")).toBeNull(); // a card shows three topics
  });

  it("opens a larger look with the after-use screenshot and every topic", () => {
    renderEn(SIMS);
    fireEvent.click(screen.getByTestId("sim-gallery-sort-hul"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("gravitationslinser");
    expect(dialog.querySelector("img")).toHaveAttribute("src", "/api/proxy/api/public/sims/sort-hul/screenshot/driven");
  });

  it("says when a sim was made by a teacher", () => {
    renderEn(SIMS);
    fireEvent.click(screen.getByTestId("sim-gallery-pendul"));
    expect(screen.getByRole("dialog")).toHaveTextContent("Made by a teacher");
  });

  it("renders nothing for an empty library", () => {
    const { container } = renderEn([]);
    expect(container).toBeEmptyDOMElement();
  });

  describe("the carousel", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    function setup(reduce = false) {
      vi.useFakeTimers();
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), media: q }));
      const scrollTo = vi.fn();
      Element.prototype.scrollTo = scrollTo as unknown as Element["scrollTo"];
      renderEn(SIMS);
      return scrollTo;
    }

    it("turns by itself", () => {
      const scrollTo = setup();
      act(() => vi.advanceTimersByTime(5000));
      expect(scrollTo).toHaveBeenCalled();
    });

    it("holds still under reduced motion", () => {
      const scrollTo = setup(true);
      act(() => vi.advanceTimersByTime(20000));
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it("holds still while the larger look is open", () => {
      const scrollTo = setup();
      fireEvent.click(screen.getByTestId("sim-gallery-sort-hul"));
      act(() => vi.advanceTimersByTime(20000));
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it("an arrow moves it at once, then leaves it be for a while", () => {
      const scrollTo = setup();
      fireEvent.click(screen.getByRole("button", { name: "Next simulation" }));
      expect(scrollTo).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(9000));
      expect(scrollTo).toHaveBeenCalledTimes(1);
    });
  });
});
