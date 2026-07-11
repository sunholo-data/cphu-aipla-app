// RUBRIC-1 M3 — the researcher judge-lens panel in /teacher/settings.
// Headline: researcher-only (renders NOTHING for a plain teacher) and
// abstains render as designed states.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsResearcher = vi.fn(() => false);
vi.mock("@/hooks/useIsResearcher", () => ({
  useIsResearcher: () => mockIsResearcher(),
}));

const mockFetch = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithTeacherAuth: (...args: unknown[]) => mockFetch(...args),
}));

import { LensConfigPanel } from "../_LensConfigPanel";

const LENSES = {
  lenses: [
    {
      lens_id: "maps",
      label: "MAPS problem solving (Docktor 2016)",
      model: "gemini-2.5-flash",
      prompt_version: "maps-r1",
      enabled: true,
      prompt_override: null,
      default_prompt: "You are a physics-education research judge scoring a student's problem-solving PROCESS with the MAPS rubric.",
    },
    {
      lens_id: "saar",
      label: "SAAR scientific abilities (Etkina 2006)",
      model: "gemini-2.5-flash",
      prompt_version: "saar-r1",
      enabled: true,
      prompt_override: null,
      default_prompt: "You are a physics-education research judge scoring a student's INQUIRY PROCESS.",
    },
  ],
};

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

beforeEach(() => {
  mockIsResearcher.mockReturnValue(false);
  mockFetch.mockReset();
});

describe("LensConfigPanel — the researcher gate", () => {
  it("renders NOTHING for a plain teacher (and never calls the API)", () => {
    const { container } = render(<LensConfigPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("renders both lens cards for a researcher", async () => {
    mockIsResearcher.mockReturnValue(true);
    mockFetch.mockResolvedValue(ok(LENSES));
    render(<LensConfigPanel />);
    expect(await screen.findByTestId("lens-card-maps")).toBeInTheDocument();
    expect(screen.getByTestId("lens-card-saar")).toBeInTheDocument();
    expect(screen.getByText("maps-r1")).toBeInTheDocument();
  });
});

describe("LensConfigPanel — editing", () => {
  it("saving a prompt PUTs the override and reloads (version bump comes from the server)", async () => {
    mockIsResearcher.mockReturnValue(true);
    mockFetch.mockResolvedValue(ok(LENSES));
    render(<LensConfigPanel />);
    await screen.findByTestId("lens-card-maps");

    fireEvent.change(screen.getByLabelText("Prompt override for maps"), {
      target: { value: "Stricter judge." },
    });
    mockFetch.mockClear();
    mockFetch.mockResolvedValue(ok({ lens: LENSES.lenses[0] }));
    fireEvent.click(screen.getAllByRole("button", { name: /save prompt/i })[0]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/proxy/api/research/lens-configs/maps",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ promptOverride: "Stricter judge." }),
        }),
      );
    });
  });

  it("shows the default prompt and copies it into the editor to edit from", async () => {
    mockIsResearcher.mockReturnValue(true);
    mockFetch.mockResolvedValue(ok(LENSES));
    render(<LensConfigPanel />);
    await screen.findByTestId("lens-card-maps");

    // the default preamble is visible (read-only reference)
    expect(screen.getByTestId("lens-default-text-maps")).toHaveTextContent("problem-solving PROCESS");
    // the override editor starts empty…
    const editor = screen.getByLabelText("Prompt override for maps") as HTMLTextAreaElement;
    expect(editor.value).toBe("");
    // …and "Copy into editor" seeds it with the default so you edit from it
    fireEvent.click(screen.getAllByRole("button", { name: /copy into editor/i })[0]);
    expect(editor.value).toContain("problem-solving PROCESS");
  });
});

describe("LensConfigPanel — the experiment box", () => {
  it("runs a session through a lens and renders an abstain as a designed state", async () => {
    mockIsResearcher.mockReturnValue(true);
    mockFetch.mockResolvedValue(ok(LENSES));
    render(<LensConfigPanel />);
    await screen.findByTestId("lens-experiment-box");

    fireEvent.change(screen.getByLabelText("Session id"), { target: { value: "s-42" } });
    mockFetch.mockClear();
    mockFetch.mockResolvedValue(
      ok({
        lensId: "maps",
        promptVersion: "maps-r1",
        model: "gemini-2.5-flash",
        abstained: true,
        abstainReason: "uncalibrated: no anchor pack for activity 'act-1'",
        profile: {},
        partitionSummary: { student_initiated: 2, tutor_prompted: 5 },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /run judge/i }));

    const abstain = await screen.findByTestId("lens-abstain");
    expect(abstain).toHaveTextContent("Abstained");
    expect(abstain).toHaveTextContent("no anchor pack");
    expect(screen.getByTestId("lens-experiment-result")).toHaveTextContent("tutor-prompted 5 (excluded)");
  });

  it("renders a category profile table for a scored session", async () => {
    mockIsResearcher.mockReturnValue(true);
    mockFetch.mockResolvedValue(ok(LENSES));
    render(<LensConfigPanel />);
    await screen.findByTestId("lens-experiment-box");

    fireEvent.change(screen.getByLabelText("Session id"), { target: { value: "s-42" } });
    mockFetch.mockClear();
    mockFetch.mockResolvedValue(
      ok({
        lensId: "maps",
        promptVersion: "maps-r2",
        model: "gemini-2.5-flash",
        abstained: false,
        profile: {
          physics_approach: { score: 5, rationale: "energy conservation chosen" },
          mathematical_procedures: { score: "NA_solver", rationale: "no independent math" },
        },
        partitionSummary: { student_initiated: 3, tutor_prompted: 1 },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /run judge/i }));

    const result = await screen.findByTestId("lens-experiment-result");
    expect(result).toHaveTextContent("physics_approach");
    expect(result).toHaveTextContent("NA_solver");
    expect(result).toHaveTextContent("maps-r2");
  });
});
