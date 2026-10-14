import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";

const auth = vi.hoisted(() => ({ fetchWithTeacherAuth: vi.fn() }));
vi.mock("@/lib/apiClient", () => auth);

import { SimThumbnail, simScreenshotUrl } from "@/components/teacher/SimThumbnail";

function render(ui: ReactElement) {
  return rtlRender(<LocaleProvider locale="en">{ui}</LocaleProvider>);
}

beforeEach(() => {
  auth.fetchWithTeacherAuth.mockReset();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:shot");
});

describe("SimThumbnail", () => {
  it("fetches a sim's screenshot with the teacher's sign-in and shows it", async () => {
    // A plain stub, not `new Response(blob)`: jsdom's Blob has no stream() on Node 22 (CI).
    auth.fetchWithTeacherAuth.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["png"], { type: "image/png" })),
    });
    render(<SimThumbnail id="boldkast" displayName="Boldkast" thumbnail={simScreenshotUrl("boldkast")} />);
    await waitFor(() => expect(screen.getByTestId("sim-thumbnail-boldkast")).toHaveAttribute("src", "blob:shot"));
    expect(auth.fetchWithTeacherAuth).toHaveBeenCalledWith("/api/proxy/api/artefacts/boldkast/screenshot/700");
  });

  it("without a screenshot: the monogram tile, or nothing for a large preview", async () => {
    auth.fetchWithTeacherAuth.mockResolvedValue({ ok: false, status: 404 });
    const url = simScreenshotUrl("no-shot");
    const { container } = render(
      <>
        <SimThumbnail id="no-shot" displayName="Pendulum lab" thumbnail={url} />
        <span data-testid="big">
          <SimThumbnail id="no-shot" displayName="Pendulum lab" thumbnail={url} fallback="none" />
        </span>
      </>,
    );
    await waitFor(() => expect(screen.getByRole("img", { name: /Pendulum lab/ })).toHaveTextContent("PL"));
    expect(screen.getByTestId("big")).toBeEmptyDOMElement();
    expect(container.querySelector("img")).toBeNull();
    // One request for the sim, however many thumbnails show it.
    expect(auth.fetchWithTeacherAuth).toHaveBeenCalledTimes(1);
  });
});
