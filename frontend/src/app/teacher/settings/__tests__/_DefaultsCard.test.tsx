// SETTINGS-1 M1 — the Defaults card (teacher account defaults).
// Headline: defaults SEED, never override — and saving is a partial PUT.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithTeacherAuth: (...args: unknown[]) => mockFetch(...args),
}));

const mockCatalogue = vi.fn();
vi.mock("@/lib/teacherApi", () => ({
  fetchPersonaCatalogue: () => mockCatalogue(),
}));

import { DefaultsCard } from "../_DefaultsCard";

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
  mockCatalogue.mockResolvedValue({
    personas: [
      { id: "astrid", name: "Astrid" },
      { id: "niels", name: "Niels" },
    ],
    defaultId: null,
    interactionStyles: [],
  });
});

describe("DefaultsCard", () => {
  it("loads prefs and reflects them in the selects", async () => {
    mockFetch.mockResolvedValue(ok({ defaultLanguage: "en", defaultPersonaId: "astrid" }));
    render(<DefaultsCard />);
    await waitFor(() => {
      expect(screen.getByLabelText("Default activity language")).toHaveValue("en");
    });
    expect(screen.getByLabelText("Default tutor for new classes")).toHaveValue("astrid");
  });

  it("saving the language PUTs a partial update", async () => {
    mockFetch.mockResolvedValue(ok({}));
    render(<DefaultsCard />);
    await screen.findByLabelText("Default activity language");

    mockFetch.mockClear();
    mockFetch.mockResolvedValue(ok({ defaultLanguage: "en" }));
    fireEvent.change(screen.getByLabelText("Default activity language"), { target: { value: "en" } });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/proxy/api/teacher/prefs",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ defaultLanguage: "en" }) }),
      );
    });
  });

  it("offers the concept-map default ON, and turning it off PUTs false (CONCEPT-2 M3)", async () => {
    mockFetch.mockResolvedValue(ok({}));
    render(<DefaultsCard />);
    const box = await screen.findByLabelText("Start new activities with a concept map");
    // Unset reads as ON — the control exists to turn the default OFF, which is
    // what makes it a default rather than an opt-in nobody finds.
    expect(box).toBeChecked();

    mockFetch.mockClear();
    mockFetch.mockResolvedValue(ok({ defaultConceptMap: false }));
    fireEvent.click(box);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/proxy/api/teacher/prefs",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ defaultConceptMap: false }) }),
      );
    });
  });

  it("shows the designed beta empty state when no flag is in 'beta' (dev)", async () => {
    mockFetch.mockResolvedValue(ok({}));
    render(<DefaultsCard />);
    expect(await screen.findByTestId("beta-empty")).toHaveTextContent("No beta features");
  });

  it("degrades to defaults when the prefs fetch fails (never blocks the pane)", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    render(<DefaultsCard />);
    await waitFor(() => {
      expect(screen.getByLabelText("Default activity language")).toHaveValue("");
    });
  });
});
