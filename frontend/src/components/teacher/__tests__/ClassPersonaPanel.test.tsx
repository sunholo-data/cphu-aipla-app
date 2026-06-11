import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchPersonaList = vi.fn();
const setClassPersona = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/lib/teacherApi", () => ({
  fetchPersonaList: () => fetchPersonaList(),
  setClassPersona: (...a: unknown[]) => setClassPersona(...a),
}));

import { ClassPersonaPanel } from "../ClassPersonaPanel";

const PERSONAS = [
  { id: "astrid", name: "Astrid", title: "Senior", avatar: "/personas/astrid.webp", language: "da", interactionStyle: "rigorous", bio: null },
  { id: "frida", name: "Frida", title: "Gym", avatar: "/personas/frida.webp", language: "da", interactionStyle: "warm", bio: null },
];

afterEach(() => vi.clearAllMocks());

describe("ClassPersonaPanel", () => {
  it("renders the default + persona cards once loaded", async () => {
    fetchPersonaList.mockResolvedValue(PERSONAS);
    render(<ClassPersonaPanel classId="c1" />);
    await waitFor(() => expect(screen.getByText("Astrid")).toBeInTheDocument());
    expect(screen.getByText(/Default \(Sofie\)/)).toBeInTheDocument();
    expect(screen.getByText("Frida")).toBeInTheDocument();
  });

  it("picking a persona persists via setClassPersona", async () => {
    fetchPersonaList.mockResolvedValue(PERSONAS);
    render(<ClassPersonaPanel classId="c1" />);
    fireEvent.click(await screen.findByText("Astrid"));
    await waitFor(() => expect(setClassPersona).toHaveBeenCalledWith("c1", "astrid"));
  });

  it("surfaces an explicit error when the catalogue fails (NOT silent)", async () => {
    fetchPersonaList.mockRejectedValue(new Error("HTTP 500"));
    render(<ClassPersonaPanel classId="c1" />);
    await waitFor(() => expect(screen.getByText(/Couldn.t load personas/i)).toBeInTheDocument());
    expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
  });
});
