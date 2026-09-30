// TUTOR-2 M3/M4/M5 — a tutor's face and voice.
//
// Two properties worth more than the rest: the avatar is CHOSEN from a shipped
// set (never uploaded, so there is no user-generated student-facing imagery to
// moderate), and the delivery prompt SAYS SO when the chosen voice ignores it —
// a control that silently does nothing is the failure this sprint keeps
// finding, and shipping one here would be ironic rather than excusable.

import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { CustomPersona } from "@/lib/teacherApi";
import { AVATAR_CHOICES } from "@/lib/avatarManifest";
import { PersonaEditorPanel } from "@/components/teacher/research/PersonaEditorPanel";

// 1.1.108 — teacher screens follow the person's language, Danish by default.
// These tests assert the English copy, so they render inside an English
// context; the Danish default has its own assertion in teacherResearchLocale.test.tsx.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const result = rtlRender(wrap(ui), options);
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
}

function persona(over: Partial<CustomPersona> = {}): CustomPersona {
  return {
    id: "persona-fru-hansen",
    name: "Fru Hansen",
    title: "Fysiklærer",
    avatar: "/personas/frida.webp",
    language: "da",
    interactionStyle: "socratic",
    source: "firestore",
    canEdit: true,
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(teacherApi, "listCustomPersonas").mockResolvedValue({
    personas: [persona()],
    avatars: AVATAR_CHOICES.map((a) => a.path),
  });
  vi.spyOn(teacherApi, "fetchVoiceList").mockResolvedValue({
    languages: ["da"],
    voices: {
      da: [
        { name: "da-DK-Chirp3-HD-Aoede", provider: "gcp", tier: "chirp3", gender: "female", label: "Aoede (dansk)" },
        { name: "da-DK-Gemini-Zephyr", provider: "gcp_gemini", tier: "gemini", gender: "female", label: "Zephyr" },
      ],
    },
  });
});
afterEach(() => vi.restoreAllMocks());

describe("PersonaEditorPanel", () => {
  it("offers the shipped avatars and nothing else — no upload control", async () => {
    render(<PersonaEditorPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "New face" }));

    for (const a of AVATAR_CHOICES) {
      expect(screen.getByRole("button", { name: a.label })).toBeInTheDocument();
    }
    // ⚠️ No file input anywhere. An uploaded image would be the first
    // user-generated student-facing content in AIPLA and needs a policy nobody
    // has written; the decision was to choose from a set instead.
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("mounts the curated voice catalogue, which had no picker for months", async () => {
    render(<PersonaEditorPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "New face" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Zephyr" })).toBeInTheDocument());
  });

  it("says when the chosen voice will ignore the delivery prompt", async () => {
    // Chirp3-HD rejects prompts. Offering the field with no warning would be a
    // control that silently does nothing — exactly what M6 exists to catch, so
    // shipping one here would be poor form.
    render(<PersonaEditorPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "New face" }));
    await userEvent.selectOptions(screen.getByLabelText("Voice"), "da-DK-Chirp3-HD-Aoede");
    expect(await screen.findByTestId("voice-prompt-ignored")).toBeInTheDocument();
  });

  it("does not warn for a voice that honours the prompt", async () => {
    render(<PersonaEditorPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "New face" }));
    await userEvent.selectOptions(screen.getByLabelText("Voice"), "da-DK-Gemini-Zephyr");
    expect(screen.queryByTestId("voice-prompt-ignored")).not.toBeInTheDocument();
  });

  it("creates a face with the picture and voice that were chosen", async () => {
    const create = vi.spyOn(teacherApi, "createCustomPersona").mockResolvedValue(persona());
    render(<PersonaEditorPanel />);

    await userEvent.click(await screen.findByRole("button", { name: "New face" }));
    await userEvent.type(screen.getByLabelText("Name"), "Fru Hansen");
    await userEvent.click(screen.getByRole("button", { name: AVATAR_CHOICES[0].label }));
    await userEvent.selectOptions(screen.getByLabelText("Voice"), "da-DK-Gemini-Zephyr");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Fru Hansen",
          avatar: AVATAR_CHOICES[0].path,
          voice: { ttsVoice: "da-DK-Gemini-Zephyr" },
        }),
      ),
    );
  });

  it("reads a face with no visibility field as shared, and says what private means", async () => {
    render(<PersonaEditorPanel />);
    expect(await screen.findByTestId("persona-visibility-persona-fru-hansen")).toHaveTextContent("Shared");

    vi.spyOn(teacherApi, "listCustomPersonas").mockResolvedValue({
      personas: [persona({ visibility: "private" })],
      avatars: [],
    });
    render(<PersonaEditorPanel />);
    await waitFor(() => expect(screen.getAllByText(/The research team can/).length).toBeGreaterThan(0));
  });
});
