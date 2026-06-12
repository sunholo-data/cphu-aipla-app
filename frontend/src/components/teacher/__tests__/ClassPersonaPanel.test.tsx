import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchPersonaCatalogue = vi.fn();
const setClassPersona = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/lib/teacherApi", () => ({
  fetchPersonaCatalogue: () => fetchPersonaCatalogue(),
  setClassPersona: (...a: unknown[]) => setClassPersona(...a),
}));

import { ClassPersonaPanel } from "../ClassPersonaPanel";

const CATALOGUE = {
  personas: [
    { id: "sofie", name: "Sofie", title: "Allround fysiklærer", avatar: "/personas/sofie.webp", language: "da", interactionStyle: "warm", bio: null },
    { id: "astrid", name: "Astrid", title: "Senior underviser", avatar: "/personas/astrid.webp", language: "da", interactionStyle: "rigorous", bio: null },
  ],
  defaultId: "sofie",
};

afterEach(() => vi.clearAllMocks());

describe("ClassPersonaPanel", () => {
  it("renders one card per persona once loaded (no synthetic default card)", async () => {
    fetchPersonaCatalogue.mockResolvedValue(CATALOGUE);
    render(<ClassPersonaPanel classId="c1" />);
    await waitFor(() => expect(screen.getByText("Sofie")).toBeInTheDocument());
    expect(screen.getByText("Astrid")).toBeInTheDocument();
    // No redundant "Default (Sofie)" entry.
    expect(screen.queryByText(/Default \(Sofie\)/)).not.toBeInTheDocument();
  });

  it("badges the global default persona", async () => {
    fetchPersonaCatalogue.mockResolvedValue(CATALOGUE);
    render(<ClassPersonaPanel classId="c1" />);
    await waitFor(() => expect(screen.getByText("Sofie")).toBeInTheDocument());
    // The "Default" badge appears exactly once, next to Sofie.
    expect(screen.getByText("Default")).toBeInTheDocument();
  });

  it("surfaces each persona's teaching style for transparency", async () => {
    fetchPersonaCatalogue.mockResolvedValue(CATALOGUE);
    render(<ClassPersonaPanel classId="c1" />);
    await waitFor(() => expect(screen.getByText("Sofie")).toBeInTheDocument());
    expect(screen.getByText("Warm")).toBeInTheDocument();
    expect(screen.getByText("Rigorous")).toBeInTheDocument();
  });

  it("picking a non-default persona persists its id", async () => {
    fetchPersonaCatalogue.mockResolvedValue(CATALOGUE);
    render(<ClassPersonaPanel classId="c1" />);
    fireEvent.click(await screen.findByText("Astrid"));
    await waitFor(() => expect(setClassPersona).toHaveBeenCalledWith("c1", "astrid"));
  });

  it("picking the default persona stores null (inherit)", async () => {
    fetchPersonaCatalogue.mockResolvedValue(CATALOGUE);
    render(<ClassPersonaPanel classId="c1" />);
    fireEvent.click(await screen.findByText("Sofie"));
    await waitFor(() => expect(setClassPersona).toHaveBeenCalledWith("c1", null));
  });

  it("shows the custom-persona coming-soon affordance", async () => {
    fetchPersonaCatalogue.mockResolvedValue(CATALOGUE);
    render(<ClassPersonaPanel classId="c1" />);
    await waitFor(() => expect(screen.getByText("Custom persona")).toBeInTheDocument());
  });

  it("surfaces an explicit error when the catalogue fails (NOT silent)", async () => {
    fetchPersonaCatalogue.mockRejectedValue(new Error("HTTP 500"));
    render(<ClassPersonaPanel classId="c1" />);
    await waitFor(() => expect(screen.getByText(/Couldn.t load personas/i)).toBeInTheDocument());
    expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
  });
});
