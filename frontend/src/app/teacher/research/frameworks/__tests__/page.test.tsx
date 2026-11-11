import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { TeachingFrameworkPayload } from "@/lib/teacherApi";
import ResearchFrameworksPage from "@/app/teacher/research/frameworks/page";

// The tab and the rail selection live in the URL (UI sweep 2026-11-11). A small
// reactive stand-in for the app router: `replace` rewrites the query string and
// every `useSearchParams` reader re-renders, so a test can both seed a deep link
// and watch a click write one.
const nav = vi.hoisted(() => ({
  search: "",
  replaced: [] as string[],
  listeners: new Set<() => void>(),
}));
vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/teacher/research/frameworks",
    useRouter: () => ({
      replace: (url: string) => {
        nav.replaced.push(url);
        nav.search = url.split("?")[1] ?? "";
        nav.listeners.forEach((l) => l());
      },
      push: vi.fn(),
    }),
    useSearchParams: () => {
      const search = React.useSyncExternalStore(
        (cb: () => void) => {
          nav.listeners.add(cb);
          return () => nav.listeners.delete(cb);
        },
        () => nav.search,
      );
      return new URLSearchParams(search);
    },
  };
});

// The judge lenses (moved here from Settings) gate themselves on the claim and
// read their config with the teacher token.
const lensState = vi.hoisted(() => ({ isResearcher: false, fetch: vi.fn() }));
vi.mock("@/hooks/useIsResearcher", () => ({ useIsResearcher: () => lensState.isResearcher }));
vi.mock("@/lib/apiClient", async (orig) => ({
  ...(await orig<object>()),
  fetchWithTeacherAuth: (...args: unknown[]) => lensState.fetch(...args),
}));
vi.mock("@/components/skill/ModelSelector", () => ({ default: () => null }));

/** The page's own tablist — the approaches rail is a second one. */
function outerTabs() {
  return within(screen.getByRole("tablist", { name: /Tutors and teaching approaches/ }))
    .getAllByRole("tab")
    .map((tab) => tab.textContent?.replace(/\d+$/, "").trim());
}

// 1.1.108 — teacher screens follow the person's language, Danish by default.
// These tests assert the English copy, so they render inside an English
// context; the Danish default has its own assertion in teacherResearchLocale.test.tsx.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const result = rtlRender(wrap(ui), options);
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
}

const GENERATED = "## Teaching framework: ESRU\n\n### Elicit\n- Ask for an explanation.";

function esru(overrides: Partial<TeachingFrameworkPayload> = {}): TeachingFrameworkPayload {
  return {
    id: "esru",
    label: "ESRU — informal formative assessment cycle",
    summary: "A turn-level assessment conversation.",
    layer: "tp_cycle",
    status: "ready_for_review",
    constructs: [
      {
        name: "elicit",
        summary: null,
        behaviours: [{ text: "Ask for an explanation.", dimension: "epistemic" }],
        avoid: ["Asking a yes/no question."],
      },
    ],
    provenance: [{ citation: "Ruiz-Primo & Furtak (2007). JRST 44(1).", vouchedBy: "M", note: null }],
    instruction: GENERATED,
    defaultInstruction: GENERATED,
    isOverridden: false,
    overrideMode: null,
    defaultConstructs: [
      {
        name: "elicit",
        summary: null,
        behaviours: [{ text: "Ask for an explanation.", dimension: "epistemic" }],
        avoid: ["Asking a yes/no question."],
      },
    ],
    defaultProvenance: [{ citation: "Ruiz-Primo & Furtak (2007). JRST 44(1).", vouchedBy: "M", note: null }],
    defaultSummary: "A turn-level assessment conversation.",
    ...overrides,
  };
}

function poe(): TeachingFrameworkPayload {
  return {
    ...esru(),
    id: "poe",
    label: "Predict-Observe-Explain",
    status: "placeholder",
    constructs: [],
    instruction: "",
    defaultInstruction: "",
  };
}

beforeEach(() => {
  nav.search = "";
  nav.replaced = [];
  lensState.isResearcher = false;
  lensState.fetch.mockReset().mockRejectedValue(new Error("not stubbed"));
  vi.spyOn(teacherApi, "listCustomApproaches").mockResolvedValue([]);
  vi.restoreAllMocks();
  // The page mounts TutorApproachPanel, which fetches on mount. Stubbed for the
  // instruction-editor tests; the panel has its own describe block below.
  vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue({ tutors: [], frameworks: [] });
  vi.spyOn(teacherApi, "previewFrameworkStructure").mockResolvedValue({
    instruction: GENERATED,
    defaultInstruction: GENERATED,
  });
});
afterEach(() => vi.restoreAllMocks());

describe("ResearchFrameworksPage (1.1.91 M1 — researcher edits the tutor instruction)", () => {
  it("shows the catalogue and badges a generated instruction as un-edited", async () => {
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru(), poe()]);
    render(<ResearchFrameworksPage />);

    await screen.findByRole("tab", { name: /ESRU/ });
    // The badge says what the machine actually did — how many constructs the
    // prompt was built from — rather than the older "Generated from the theory",
    // which a researcher could not check and which left "generated by what?"
    // open. The trust claim this page makes has to be legible on the card.
    expect(screen.getByText(/Unedited · built from 1 construct$/)).toBeInTheDocument();
    // A placeholder says so, and offers no editor — an empty instruction is not
    // something to hand a researcher a textarea for.
    expect(screen.getByText("Awaiting pedagogical content")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Edit teaching approach/ })).toHaveLength(1);
    // 1.1.110: there is no "Edit wording". Free-text authoring was the only
    // path that could produce a tutor prompt nobody could check against a
    // source; it now lives on a CUSTOM approach, which says so about itself.
    expect(screen.queryByRole("button", { name: /Edit wording/ })).not.toBeInTheDocument();
  });

  it("puts each job behind its own tab, with the approaches leading", async () => {
    // The page had grown an assign panel, a preview, a custom-approach editor,
    // a cross-view and seven framework cards in one sprint — one scroll nobody
    // could navigate. This asserts the STRUCTURE, because it was assembled by
    // heavy edits to a long JSX file, and "it typechecks" is not the same as
    // "it is still a coherent page".
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru(), poe()]);
    render(<ResearchFrameworksPage />);

    await screen.findByRole("tab", { name: /^Approaches/ });
    // Exactly four since the UI sweep (2026-11-11; was seven): every panel
    // survives, at most one level down.
    expect(outerTabs()).toEqual(["Approaches", "Tutors", "Try them", "Research tools"]);
    expect(screen.getByRole("heading", { level: 1, name: "Tutors and teaching approaches" })).toBeInTheDocument();

    // Approaches leads, and the framework cards live in it.
    expect(screen.getByRole("tab", { name: /^Approaches/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: /ESRU/ })).toBeInTheDocument();

    // Tutors stacks the three tutor jobs that used to be three tabs: make one,
    // say what each teaches with, give it a face.
    await user.click(screen.getByRole("tab", { name: "Tutors" }));
    expect(screen.getByRole("tab", { name: "Tutors" })).toHaveAttribute("aria-selected", "true");
    const tutorsPanel = screen.getByRole("tabpanel", { name: "Tutors" });
    expect(within(tutorsPanel).getByRole("heading", { name: "What each tutor teaches with" })).toBeInTheDocument();
    // Panels are hidden rather than unmounted, so a half-written approach
    // survives a glance at another tab.
    expect(screen.getByRole("heading", { name: /ESRU/, hidden: true })).toBeInTheDocument();
  });

  it("keeps the tab in ?tab= both ways, and opens on a deep link", async () => {
    // A refresh, Back, or a link in a guide lands where the reader was.
    const user = userEvent.setup();
    nav.search = "tab=research";
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru(), poe()]);
    render(<ResearchFrameworksPage />);

    expect(await screen.findByRole("tab", { name: "Research tools" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: "Try them" }));
    expect(nav.replaced.at(-1)).toBe("/teacher/research/frameworks?tab=try");
    expect(screen.getByRole("tab", { name: "Try them" })).toHaveAttribute("aria-selected", "true");

    // The default tab is the bare URL, not ?tab=approaches.
    await user.click(screen.getByRole("tab", { name: /^Approaches/ }));
    expect(nav.replaced.at(-1)).toBe("/teacher/research/frameworks");
  });

  it("falls back to the first tab on an unknown ?tab=, and honours ?approach= on the rail", async () => {
    nav.search = "tab=usage&approach=poe";
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru(), poe()]);
    render(<ResearchFrameworksPage />);

    // "usage" was a tab before the sweep; an old value opens the page, not an error.
    expect(await screen.findByRole("tab", { name: /^Approaches/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Predict-Observe-Explain/ })).toHaveAttribute("aria-selected", "true");
  });

  it("puts the judge lenses under Research tools, beside usage and calibration", async () => {
    // Moved from /teacher/settings: lenses and their calibration are one job.
    const user = userEvent.setup();
    lensState.isResearcher = true;
    // teacherApi reads through the same helper, so answer only the lens route
    // and let everything else fail as it would without a server.
    const lensResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        lenses: [
          {
            lens_id: "maps",
            label: "MAPS problem solving (Docktor 2016)",
            model: "gemini-2.5-flash",
            prompt_version: "maps-r1",
            enabled: true,
            prompt_override: null,
            default_prompt: "Judge.",
          },
        ],
      }),
    };
    lensState.fetch.mockImplementation(async (url: string) =>
      url.includes("/research/lens-configs") ? lensResponse : Promise.reject(new Error("offline")),
    );
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    render(<ResearchFrameworksPage />);

    await user.click(await screen.findByRole("tab", { name: "Research tools" }));
    const panel = screen.getByRole("tabpanel", { name: "Research tools" });
    expect(await within(panel).findByTestId("lens-card-maps")).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Judge lenses" })).toBeInTheDocument();
    expect(within(panel).getByTestId("lens-experiment-box")).toBeInTheDocument();
  });

  it("says the catalogue could not be read, with a retry that reads it again", async () => {
    // "Reload to try again" with no button was the old state.
    const user = userEvent.setup();
    const list = vi
      .spyOn(teacherApi, "listTeachingFrameworks")
      .mockRejectedValueOnce(new Error("list failed: 500"))
      .mockResolvedValueOnce([esru()]);
    render(<ResearchFrameworksPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("The approaches could not be loaded");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("tab", { name: /ESRU/ })).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("puts the seven approaches behind a rail rather than one long pane", async () => {
    // The ask (2026-09-12): seven full configurations stacked in a single pane
    // made "which one am I editing?" a scrolling question. Each approach is a
    // rail entry now, carrying its state so the list tells them apart, and the
    // detail pane shows exactly one.
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru(), poe()]);
    render(<ResearchFrameworksPage />);

    const first = await screen.findByRole("tab", { name: /ESRU/ });
    expect(first).toHaveAttribute("aria-selected", "true");
    // The rail says what state each one is in without opening it.
    expect(screen.getByRole("tab", { name: /Predict-Observe-Explain/ })).toHaveTextContent(
      /Awaiting content/,
    );
    expect(first).toHaveTextContent(/1 construct/);

    await user.click(screen.getByRole("tab", { name: /Predict-Observe-Explain/ }));
    expect(screen.getByRole("tab", { name: /Predict-Observe-Explain/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(first).toHaveAttribute("aria-selected", "false");
    // Cards stay mounted behind `hidden`, so an open editor with unsaved
    // changes survives a look at another approach — hence `hidden: true`, which
    // is also the assertion that the deselected card really IS hidden.
    expect(screen.queryByRole("heading", { name: /ESRU/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /ESRU/, hidden: true })).toBeInTheDocument();
  });

  it("gives a plain teacher their own approaches instead of an access wall", async () => {
    // 1.1.110. Listing the seven 403s for a teacher — they are researcher-
    // maintained — but a teacher OWNS the custom tier, and showing an
    // access-required page would hide a surface built for them.
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockRejectedValue(new Error("list failed: 403"));
    vi.spyOn(teacherApi, "listCustomApproaches").mockResolvedValue([]);
    vi.spyOn(teacherApi, "fetchApproachCatalogue").mockResolvedValue([]);
    vi.spyOn(teacherApi, "listCustomPersonas").mockResolvedValue({ personas: [] } as never);
    vi.spyOn(teacherApi, "fetchVoiceList").mockResolvedValue({ voices: {} } as never);

    const user = userEvent.setup();
    render(<ResearchFrameworksPage />);

    expect(screen.queryByText(/Researcher access required/i)).not.toBeInTheDocument();
    // It says why the seven are not editable, rather than just omitting them.
    expect(await screen.findByText(/maintained by the research team/i)).toBeInTheDocument();

    // Tabbed since 2026-09-11 — the page had grown into one long scroll. For a
    // TEACHER "Try them" leads, because the tutor library as teaching training
    // is what they came for; authoring is the second question.
    expect(screen.getByRole("tab", { name: /Try them/i })).toHaveAttribute("aria-selected", "true");
    // Three since the UI sweep (was five): nothing researcher-only leaks in.
    expect(outerTabs()).toEqual(["Try them", "Approaches", "Tutors"]);

    // The published seven, then "your own" below them, in one tab.
    await user.click(screen.getByRole("tab", { name: "Approaches" }));
    const approaches = screen.getByRole("tabpanel", { name: "Approaches" });
    expect(within(approaches).getByText(/Your own teaching approaches/i)).toBeInTheDocument();
    expect(within(approaches).getByRole("button", { name: /New approach/i })).toBeInTheDocument();
    expect(within(approaches).getByTestId("published-approaches")).toBeInTheDocument();

    // Tutors, then their faces and voices, in one tab.
    await user.click(screen.getByRole("tab", { name: "Tutors" }));
    const tutors = screen.getByRole("tabpanel", { name: "Tutors" });
    expect(within(tutors).getByRole("heading", { name: "Faces and voices" })).toBeInTheDocument();
    expect(nav.replaced.at(-1)).toBe("/teacher/research/frameworks?tab=tutors");
  });

  it("offers no way to hand-write an instruction", async () => {
    // The property, not the absence of a button: opening the only editor there
    // is must not present a free-text box bound to the tutor's prompt.
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit teaching approach/ }));

    expect(screen.queryByLabelText(/What the tutor is told/i)).not.toBeInTheDocument();
    // What the tutor WILL be told is still shown — as a read-only preview
    // generated from the constructs, which is the reviewable half.
    expect(screen.getByTestId("structure-preview")).toBeInTheDocument();
  });

  it("discards saved edits only when there are saved edits to discard", async () => {
    // Revert used to live in the text editor. That editor is gone, so it moved
    // into the structural one — it must not have been dropped along the way.
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([
      esru({ isOverridden: true, overrideVersion: 2, overrideMode: "structured" }),
    ]);
    const revertSpy = vi.spyOn(teacherApi, "revertFrameworkInstruction").mockResolvedValue(esru());

    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit teaching approach/ }));
    await user.click(screen.getByRole("button", { name: /Discard saved edits/ }));

    await waitFor(() => expect(revertSpy).toHaveBeenCalledWith("esru"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Discard saved edits/ })).not.toBeInTheDocument(),
    );
  });

  it("keeps resetting the form distinct from discarding saved edits", async () => {
    // Two different actions with one plausible label between them. "Reset the
    // form" only refills the fields; the saved override survives until it is
    // deleted. A researcher who read one as the other would believe they had
    // reverted when they had not.
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([
      esru({ isOverridden: true, overrideVersion: 1, overrideMode: "structured" }),
    ]);
    const revertSpy = vi.spyOn(teacherApi, "revertFrameworkInstruction").mockResolvedValue(esru());

    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit teaching approach/ }));
    await user.click(screen.getByRole("button", { name: /Reset the form to published/ }));

    expect(revertSpy).not.toHaveBeenCalled();
  });
});

describe("Structural editor (TUTOR-4 — the researcher edits the theory, not the prose)", () => {
  it("edits behaviours and references, and previews from the real generator", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    const previewSpy = vi.spyOn(teacherApi, "previewFrameworkStructure").mockResolvedValue({
      instruction: "## Regenerated\n- Ask for their reasoning.",
      defaultInstruction: GENERATED,
    });
    const saveSpy = vi
      .spyOn(teacherApi, "saveFrameworkStructure")
      .mockResolvedValue(esru({ isOverridden: true, overrideMode: "structured", overrideVersion: 1 }));

    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit teaching approach/ }));

    // The behaviour is editable text, not a paragraph of rendered prose.
    const behaviour = screen.getByLabelText("Behaviours 1");
    expect(behaviour).toHaveValue("Ask for an explanation.");
    await user.clear(behaviour);
    await user.type(behaviour, "Ask for their reasoning.");

    // References are editable too — that was the other half of the ask.
    expect(screen.getByLabelText(/Citation/)).toHaveValue("Ruiz-Primo & Furtak (2007). JRST 44(1).");
    expect(screen.getByLabelText(/Checked by/)).toHaveValue("M");

    // The preview comes from the server, so it cannot drift from what the
    // tutor is actually told.
    await waitFor(() => expect(previewSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("structure-preview")).toHaveTextContent("Ask for their reasoning."),
    );

    await user.click(screen.getByRole("button", { name: /Save teaching approach/ }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const sent = saveSpy.mock.calls[0][1];
    expect(sent.constructs[0].behaviours[0].text).toBe("Ask for their reasoning.");
    // The epistemic/conceptual tag survives an edit of the text beside it —
    // rebuilding behaviours from strings alone would silently drop the theory's
    // own dimension axis.
    expect(sent.constructs[0].behaviours[0].dimension).toBe("epistemic");
  });

  it("refuses to save a citation nobody has vouched for", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    const saveSpy = vi.spyOn(teacherApi, "saveFrameworkStructure");

    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit teaching approach/ }));
    await user.clear(screen.getByLabelText(/Checked by/));

    expect(await screen.findByText(/needs a citation and the initials/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save teaching approach/ })).toBeDisabled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("will not let the last construct be deleted into a silent no-op", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    render(<ResearchFrameworksPage />);
    await user.click(await screen.findByRole("button", { name: /Edit teaching approach/ }));

    await user.click(screen.getByRole("button", { name: /Remove construct elicit/i }));
    expect(await screen.findByText(/needs at least one construct/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save teaching approach/ })).toBeDisabled();
  });

  it("opens on the editor the researcher last used", async () => {
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([
      esru({ isOverridden: true, overrideMode: "text", overrideVersion: 1 }),
    ]);
    render(<ResearchFrameworksPage />);
    // A wording edit is badged as such, so a researcher can tell at a glance
    // which frameworks still trace to their constructs. The badge states the
    // CONSEQUENCE, not just the fact: a hand-written instruction is no longer
    // checkable against the papers, and that is the whole reason the two
    // editors are separate buttons.
    expect(await screen.findByText(/Wording hand-edited/)).toBeInTheDocument();
    expect(await screen.findByText(/no longer traceable to sources/)).toBeInTheDocument();
  });
});

describe("TutorApproachPanel (TUTOR-4 — assigning an approach to the default tutors)", () => {
  const sofie: teacherApi.TutorPayload = {
    id: "sofie",
    displayName: "Sofie",
    summary: "Default tutor.",
    personaId: "sofie",
    frameworkId: null,
    interactionStyle: "socratic",
    status: "ready",
    version: 1,
    isVariant: false,
    lineage: { kind: "original" },
    persona: null,
    frameworkName: null,
    frameworkSummary: null,
  };

  it("assigns a framework to a default tutor", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue({ tutors: [sofie], frameworks: [] });
    const assignSpy = vi
      .spyOn(teacherApi, "setTutorFramework")
      .mockResolvedValue({ tutor: { ...sofie, frameworkId: "esru" } });

    render(<ResearchFrameworksPage />);
    const select = await screen.findByLabelText(/Teaching approach for Sofie/i);
    // Ships with none — the catalogue does not make a pedagogical claim nobody
    // signed off, so the claim starts here.
    expect(select).toHaveValue("");

    await user.selectOptions(select, "esru");
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("sofie", "esru"));
    await waitFor(() => expect(screen.getByLabelText(/Teaching approach for Sofie/i)).toHaveValue("esru"));
  });

  it("sends null when set back to no approach, which is how an assignment is undone", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru()]);
    vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue({
      tutors: [{ ...sofie, frameworkId: "esru" }],
      frameworks: [],
    });
    const assignSpy = vi.spyOn(teacherApi, "setTutorFramework").mockResolvedValue({ tutor: sofie });

    render(<ResearchFrameworksPage />);
    await user.selectOptions(await screen.findByLabelText(/Teaching approach for Sofie/i), "");
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("sofie", null));
  });

  it("does not offer a framework whose teaching moves are unwritten", async () => {
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([esru(), poe()]);
    vi.spyOn(teacherApi, "fetchTutorCatalogue").mockResolvedValue({ tutors: [sofie], frameworks: [] });

    render(<ResearchFrameworksPage />);
    const select = await screen.findByLabelText(/Teaching approach for Sofie/i);
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(options).toContain("esru");
    // A placeholder would give the tutor an approach it cannot teach with.
    expect(options).not.toContain("poe");
  });
});
