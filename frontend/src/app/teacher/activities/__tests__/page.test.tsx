import { act, fireEvent, render as rtlRender, screen, waitFor, within, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The page keeps its list (Mine | Shared | All teachers) in the URL. A tiny
// store stands in for the router so `router.replace` re-renders the page the
// way the real App Router does.
const nav = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  return {
    get: () => search,
    set: (next: string) => {
      search = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    replace: vi.fn(),
    push: vi.fn(),
  };
});
vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    useSearchParams: () => new URLSearchParams(React.useSyncExternalStore(nav.subscribe, nav.get, nav.get)),
    usePathname: () => "/teacher/activities",
    useRouter: () => ({
      replace: (url: string, opts?: unknown) => {
        nav.replace(url, opts);
        nav.set(url.split("?")[1]?.split("#")[0] ?? "");
      },
      push: nav.push,
    }),
  };
});
// The catalogue excludes the viewer's own shared activities by uid.
vi.mock("@/hooks/useTeacherAuth", () => ({
  useTeacherAuth: () => ({ user: { uid: "t-1" }, loading: false }),
}));

import * as teacherApi from "@/lib/teacherApi";
import type { ActivityPayload, ClassPayload } from "@/lib/teacherApi";
import TeacherActivitiesPage from "@/app/teacher/activities/page";
import { resetSimCatalogue } from "@/components/teacher/useSimCatalogue";
import { Toaster } from "@/components/ui/toast";
import * as researcherHook from "@/hooks/useIsResearcher";

import { LocaleProvider } from "@/i18n";

// 1.1.108 M2 — these tests assert the English copy; the teacher UI defaults to
// Danish, so render inside an English locale (the teacher chose EN).
function EnglishUI({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider locale="en">
      {children}
      <Toaster />
    </LocaleProvider>
  );
}
const render = (ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: EnglishUI, ...options });

function makeActivity(overrides: Partial<ActivityPayload> = {}): ActivityPayload {
  return {
    activityId: "act-energy",
    ownerUid: "t-1",
    skillId: "concept-dialogue",
    visibility: "private",
    classId: "",
    teacherUid: "t-1",
    title: "Energy basics",
    teachingGoal: "Discover conservation of energy",
    language: "da",
    difficulty: "standard",
    pairedWorkbench: null,
    workbenchType: "none",
    updatedAt: "2026-06-09T00:00:00Z",
    ...overrides,
  };
}

function makeClass(overrides: Partial<ClassPayload> = {}): ClassPayload {
  return {
    classId: "c-1",
    name: "Physics A — 7B",
    activityIds: [],
    lessons: [],
    ...overrides,
  } as unknown as ClassPayload;
}

const page = (activities: ActivityPayload[]) => ({ activities, total: activities.length, limit: 200, offset: 0 });

/** Open a card's ⋯ menu and choose an item (Radix: keyboard opens it in jsdom). */
async function cardMenu(title: string, item: RegExp | string) {
  const trigger = screen.getByRole("button", { name: `More actions for “${title}”` });
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.click(await screen.findByRole("menuitem", { name: item }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  nav.set("");
  nav.replace.mockClear();
  nav.push.mockClear();
  window.location.hash = "";
  vi.spyOn(teacherApi, "listSharedCatalogue").mockResolvedValue(page([]));
  vi.spyOn(teacherApi, "listActivityFacets").mockResolvedValue(null as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("TeacherActivitiesPage — Mine", () => {
  it("shows an empty state with a New activity link when there are no activities", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);

    expect(await screen.findByText("Your activities live here")).toBeInTheDocument();
    const newLinks = screen.getAllByRole("link", { name: /New activity/ });
    expect(newLinks[0]).toHaveAttribute("href", "/teacher/activities/new");
  });

  it("shows the composition (sim + elements + docs) from the payload", async () => {
    const a = makeActivity({
      artefactId: "boldkast",
      workbenchType: "app",
      checklist: [{ id: "a", label: "a" }, { id: "b", label: "b" }] as ActivityPayload["checklist"],
      note: [{ id: "n", title: "t", body: "x" }] as unknown as ActivityPayload["note"],
      materials: [{ documentId: "d1" }] as unknown as ActivityPayload["materials"],
    });
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([a]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    resetSimCatalogue();
    vi.spyOn(teacherApi, "listArtefacts").mockResolvedValue([
      { id: "boldkast", displayName: "Boldkast — projektilbevægelse" } as teacherApi.ArtefactSummary,
    ]);
    render(<TeacherActivitiesPage />);

    await screen.findByText("Energy basics");
    expect(await screen.findByText("Boldkast")).toBeInTheDocument();
    expect(screen.getByText("Checklist 2")).toBeInTheDocument();
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.getByText("1 document")).toBeInTheDocument();
  });

  it("says where an activity runs as text, and its Edit link carries the class when there is exactly one", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(
      page([makeActivity(), makeActivity({ activityId: "act-loose", title: "Loose" })]),
    );
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([
      makeClass({ classId: "c-1", name: "Physics A — 7B", activityIds: ["act-energy"] }),
      makeClass({ classId: "c-2", name: "Physics B — 8A", activityIds: [] }),
    ]);
    render(<TeacherActivitiesPage />);

    await screen.findByText("Energy basics");
    const [assigned, loose] = screen.getAllByTestId("activity-classes");
    expect(assigned).toHaveTextContent("In: Physics A — 7B");
    expect(loose).toHaveTextContent("Not assigned yet");
    const [editAssigned, editLoose] = screen.getAllByRole("link", { name: "Edit" });
    expect(editAssigned.getAttribute("href")).toBe("/teacher/activities/act-energy?classId=c-1&title=Energy+basics");
    expect(editLoose.getAttribute("href")).not.toContain("classId");
    // The status is a read-only badge now; no one-click publishing pill.
    expect(screen.queryByRole("button", { name: /visibility/i })).toBeNull();
    // The status-help paragraph is gone.
    expect(screen.queryByText(/Set each activity’s status/)).toBeNull();
  });

  it("assigns the activity to another class from Assign ▾", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([makeActivity()]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([
      makeClass({ classId: "c-1", name: "7B", activityIds: [] }),
      makeClass({ classId: "c-2", name: "8A", activityIds: [] }),
    ]);
    const patchMock = vi
      .spyOn(teacherApi, "patchClassActivities")
      .mockResolvedValue(makeClass({ classId: "c-2", name: "8A", activityIds: ["act-energy"] }));
    render(<TeacherActivitiesPage />);

    await screen.findByText("Energy basics");
    const trigger = await screen.findByRole("button", { name: "Assign “Energy basics” to classes" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const item = await screen.findByRole("menuitemcheckbox", { name: "8A" });
    expect(item).toHaveAttribute("aria-checked", "false");
    await userEvent.click(item);
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith("c-2", { add: ["act-energy"] }));
    await waitFor(() => expect(screen.getByTestId("activity-classes")).toHaveTextContent("In: 8A"));
  });

  it("blocks assignment of a Draft and prompts review & save (not assignable yet)", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([makeActivity({ visibility: "draft" })]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([makeClass({ classId: "c-1", name: "7B" })]);
    render(<TeacherActivitiesPage />);

    await screen.findByText("Energy basics");
    expect(screen.queryByRole("button", { name: /Assign “Energy basics”/ })).toBeNull();
    expect(screen.getByText(/review and save/i)).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    // A draft cannot be shared (it is reviewed first), nor tried (it is in no class).
    const trigger = screen.getByRole("button", { name: "More actions for “Energy basics”" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const items = (await screen.findAllByRole("menuitem")).map((i) => i.textContent ?? "");
    expect(items.some((t) => /share/i.test(t))).toBe(false);
    expect(items.some((t) => /try as student/i.test(t))).toBe(false);
  });

  it("duplicates an activity from ⋯ into the list as a new draft", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([makeActivity()]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    const dupSpy = vi
      .spyOn(teacherApi, "duplicateActivity")
      .mockResolvedValue(makeActivity({ activityId: "act-copy", visibility: "draft" }));
    render(<TeacherActivitiesPage />);
    await screen.findByText("Energy basics");
    await cardMenu("Energy basics", /Duplicate/);
    await waitFor(() => expect(dupSpy).toHaveBeenCalledWith("act-energy"));
    await waitFor(() => expect(screen.getAllByText("Energy basics").length).toBe(2));
  });

  // UI sweep 2026-11-11 — the status pill used to publish to every teacher on
  // one click. Sharing is now an explicit menu item that asks first.
  it("sharing with colleagues asks first, and does nothing on No", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([makeActivity()]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    const setSpy = vi
      .spyOn(teacherApi, "setActivityVisibility")
      .mockResolvedValue(makeActivity({ visibility: "published" }));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<TeacherActivitiesPage />);
    await screen.findByText("Energy basics");

    await cardMenu("Energy basics", /Share with colleagues/);
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(confirmSpy.mock.calls[0][0]).toMatch(/Every teacher can see and copy it/);
    expect(setSpy).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await cardMenu("Energy basics", /Share with colleagues/);
    await waitFor(() => expect(setSpy).toHaveBeenCalledWith("act-energy", "published"));
    expect(await screen.findByText("Shared")).toBeInTheDocument();
  });

  it("making a shared activity private needs no confirm", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([makeActivity({ visibility: "published" })]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    const setSpy = vi.spyOn(teacherApi, "setActivityVisibility").mockResolvedValue(makeActivity());
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<TeacherActivitiesPage />);
    await screen.findByText("Energy basics");
    await cardMenu("Energy basics", /Make private/);
    await waitFor(() => expect(setSpy).toHaveBeenCalledWith("act-energy", "private"));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("deletes from ⋯ only after a confirm", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([makeActivity()]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    const delSpy = vi.spyOn(teacherApi, "deleteActivity").mockResolvedValue(undefined as never);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TeacherActivitiesPage />);
    await screen.findByText("Energy basics");
    await cardMenu("Energy basics", /Delete/);
    await waitFor(() => expect(delSpy).toHaveBeenCalledWith("act-energy"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Energy basics" })).toBeNull());
  });

  it("opens the filing editor from ⋯ → File", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([makeActivity()]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);
    await screen.findByText("Energy basics");
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    await cardMenu("Energy basics", /File: subject, level, tags/);
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("keeps the facet rows behind one Filter button, with the search box visible", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([makeActivity()]));
    vi.spyOn(teacherApi, "listActivityFacets").mockResolvedValue({
      subjects: [{ value: "Fysik", label: "Fysik", count: 1 }],
      levels: [],
      folders: [],
      tags: [],
    });
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);
    await screen.findByText("Energy basics");
    expect(screen.getByRole("searchbox", { name: /search activities/i })).toBeInTheDocument();
    const filter = screen.getByRole("button", { name: /^Filter/ });
    expect(filter).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Subject")).toBeNull();
    fireEvent.click(filter);
    expect(filter).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Subject")).toBeInTheDocument();
  });

  it("a failed load says so, and Retry loads the list", async () => {
    const listSpy = vi
      .spyOn(teacherApi, "listActivities")
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(page([makeActivity()]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/the activities could not be loaded/i);
    expect(screen.queryByText(/your activities live here/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("Energy basics")).toBeInTheDocument();
    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it("a failed class load says assignment is unavailable instead of hiding it", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([makeActivity()]));
    vi.spyOn(teacherApi, "listClasses").mockRejectedValue(new Error("boom"));
    render(<TeacherActivitiesPage />);
    expect(await screen.findByText(/your classes could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be assigned right now/i)).toBeInTheDocument();
  });
});

describe("TeacherActivitiesPage — one list at a time (UI sweep 2026-11-11)", () => {
  it("a plain teacher sees Mine and Shared by colleagues, and lists only their own library", async () => {
    const listSpy = vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([makeActivity()]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);
    await screen.findByText("Energy basics");
    expect(screen.getByRole("tab", { name: "Mine" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Shared by colleagues" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "All teachers" })).toBeNull();
    expect(listSpy).toHaveBeenCalledWith("own", expect.anything());
    expect(listSpy).not.toHaveBeenCalledWith("all", expect.anything());
  });

  it("Shared by colleagues is in the URL, lists the catalogue grouped by owner without your own, and copies one", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    const sharedSpy = vi.spyOn(teacherApi, "listSharedCatalogue").mockResolvedValue(
      page([
        makeActivity({ activityId: "act-pub", ownerUid: "other", ownerLabel: "Bob Jensen", title: "Shared one", visibility: "published" }),
        makeActivity({ activityId: "act-mine-pub", ownerUid: "t-1", title: "My own shared", visibility: "published" }),
      ]),
    );
    const adoptSpy = vi
      .spyOn(teacherApi, "adoptActivity")
      .mockResolvedValue(makeActivity({ activityId: "act-mine", title: "Shared one", visibility: "draft" }));
    render(<TeacherActivitiesPage />);
    await screen.findByText("Your activities live here");

    fireEvent.click(screen.getByRole("tab", { name: "Shared by colleagues" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/teacher/activities?view=shared", { scroll: false });
    expect(await screen.findByText("Shared one")).toBeInTheDocument();
    expect(sharedSpy).toHaveBeenCalled();
    expect(screen.getByText("Bob Jensen")).toBeInTheDocument();
    expect(screen.queryByText("My own shared")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Copy to my activities/ }));
    await waitFor(() => expect(adoptSpy).toHaveBeenCalledWith("act-pub"));
    expect(await screen.findByText(/is copied to your activities as a draft/)).toBeInTheDocument();
  });

  it("?view=shared opens on the shared list", async () => {
    nav.set("view=shared");
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);
    expect(await screen.findByRole("tab", { name: "Shared by colleagues" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("No colleague has shared an activity yet.")).toBeInTheDocument();
  });

  it("the getting-started checklist's #shared deep link selects Shared by colleagues", async () => {
    window.location.hash = "#shared";
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Shared by colleagues" })).toHaveAttribute("aria-selected", "true"),
    );
    expect(nav.replace).toHaveBeenCalledWith("/teacher/activities?view=shared", { scroll: false });
  });

  it("a researcher gets All teachers (?scope=all): every owner, linked to the editor", async () => {
    vi.spyOn(researcherHook, "useIsResearcher").mockReturnValue(true);
    const listSpy = vi.spyOn(teacherApi, "listActivities").mockImplementation(async (scope) =>
      page(
        scope === "all"
          ? [makeActivity(), makeActivity({ activityId: "act-theirs", title: "Theirs", ownerUid: "R5Z5Y", ownerLabel: "Bob Jensen", visibility: "draft" })]
          : [makeActivity()],
      ),
    );
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);
    await screen.findByText("Energy basics");
    expect(screen.queryByText("Theirs")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "All teachers" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/teacher/activities?scope=all", { scroll: false });
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith("all", expect.anything()));
    const card = await screen.findByText("Theirs");
    expect(screen.getByText("Owner: Bob Jensen")).toBeInTheDocument();
    expect(card.closest("a")).toHaveAttribute("href", expect.stringContaining("/teacher/activities/act-theirs"));
    expect(screen.queryByRole("button", { name: /More actions/ })).toBeNull();
  });

  it("?scope=all keeps working as the researchers' link, and is ignored for a plain teacher", async () => {
    nav.set("scope=all");
    const listSpy = vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([makeActivity()]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);
    await screen.findByText("Energy basics");
    expect(listSpy).not.toHaveBeenCalledWith("all", expect.anything());
    expect(screen.getByRole("tab", { name: "Mine" })).toHaveAttribute("aria-selected", "true");
  });

  it("arrow keys move between the lists", async () => {
    vi.spyOn(teacherApi, "listActivities").mockResolvedValue(page([makeActivity()]));
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    render(<TeacherActivitiesPage />);
    await screen.findByText("Energy basics");
    const mine = screen.getByRole("tab", { name: "Mine" });
    act(() => mine.focus());
    fireEvent.keyDown(mine, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Shared by colleagues" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tablist")).getByRole("tab", { name: "Shared by colleagues" })).toHaveFocus();
  });
});
