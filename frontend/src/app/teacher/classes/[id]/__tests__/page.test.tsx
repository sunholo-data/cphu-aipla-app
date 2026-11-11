import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import {
  type MockedFunction,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { ActivityPayload, ClassPayload, LiveClass, SessionRow } from "@/lib/teacherApi";
import { notify } from "@/components/ui/toast";

function makeActivity(overrides: Partial<ActivityPayload> = {}): ActivityPayload {
  return {
    activityId: "act-pset",
    ownerUid: "teacher-1",
    skillId: "concept-dialogue",
    visibility: "private",
    classId: "",
    teacherUid: "teacher-1",
    title: "Problem-set hints (Boldkast)",
    teachingGoal: "Danish projectile-motion tutor.",
    language: "da",
    difficulty: "standard",
    pairedWorkbench: null,
    workbenchType: "none",
    updatedAt: "2026-06-15T00:00:00Z",
    ...overrides,
  };
}

// Inline fixture — the class-detail page is fully real (getClass is mocked
// below); this just supplies a stable id + name for assertions.
const targetClass = { id: "class-7b-physics-a", name: "Physics A — 7B" };
const CLASS_ID = targetClass.id;

function makeClassPayload(overrides: Partial<ClassPayload> = {}): ClassPayload {
  return {
    classId: CLASS_ID,
    ownerUid: "teacher-1",
    name: targetClass.name,
    description: null,
    tagNamespace: `class:teacher-1:${CLASS_ID}`,
    lessons: [],
    activityIds: [],
    groupCodes: ["bright-fox-12", "soft-otter-44"],
    revoked: false,
    createdAt: "2026-05-26T00:00:00Z",
    updatedAt: "2026-05-26T00:00:00Z",
    revokedAt: null,
    ...overrides,
  };
}

function session(over: Partial<SessionRow> = {}): SessionRow {
  return {
    sessionId: "s-1",
    ownerUid: "group:bright-fox-12",
    skillId: "concept-dialogue",
    groupCode: "bright-fox-12",
    lastMessageAt: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
    turnCount: 7,
    title: "Waves",
    ...over,
  };
}

function livePayload(over: Partial<LiveClass> = {}): LiveClass {
  return { calls: [], groups: [], summary: null, generatedAt: new Date().toISOString(), ...over };
}

// The URL is the tab's state (`?tab=`); the router mock records navigation.
const nav = vi.hoisted(() => ({
  search: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "class-7b-physics-a" }),
  useSearchParams: () => nav.search,
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => "/teacher/classes/class-7b-physics-a",
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));

// The analytics co-pilot has its own tests and pulls in AG-UI + teacher auth;
// stub it so these detail-page tests stay focused on the class surface.
vi.mock("../_ClassAnalyticsCopilot", () => ({ ClassAnalyticsCopilot: () => null }));

// 1.1.123 — the page asks who is looking (owner vs researcher acting for
// them). These tests are the OWNER's view; page.onbehalf.test.tsx is the other.
vi.mock("@/hooks/useTeacherAuth", () => ({
  useTeacherAuth: () => ({ user: { uid: "teacher-1" }, loading: false }),
}));

// Importing after vi.mock so the mocked hook is wired before the page resolves.
import TeacherClassDetailPage from "@/app/teacher/classes/[id]/page";
import { LocaleProvider } from "@/i18n";
import { ConfirmProvider } from "@/components/ui/confirm";

// 1.1.108 M2 — these tests assert the English copy; the teacher UI defaults to
// Danish, so render inside an English locale — and inside the kit's confirm
// dialog, which the app mounts once in AppProviders.
function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider locale="en">
      <ConfirmProvider>{children}</ConfirmProvider>
    </LocaleProvider>
  );
}
const render = ((ui: React.ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: Providers, ...options })) as typeof rtlRender;

type GetClassMock = MockedFunction<typeof teacherApi.getClass>;
type MintMock = MockedFunction<typeof teacherApi.mintGroupCodes>;
type ListActivitiesMock = MockedFunction<typeof teacherApi.listActivities>;
type PatchClassActivitiesMock = MockedFunction<typeof teacherApi.patchClassActivities>;
type SessionsMock = MockedFunction<typeof teacherApi.listClassRecentSessions>;
type LiveMock = MockedFunction<typeof teacherApi.listClassLive>;

let getSpy: GetClassMock;
let mintSpy: MintMock;
let listActivitiesSpy: ListActivitiesMock;
let patchActivitiesSpy: PatchClassActivitiesMock;
let sessionsSpy: SessionsMock;
let liveSpy: LiveMock;
let store: Map<string, string>;

function setTab(tab: string | null) {
  nav.search = new URLSearchParams(tab ? { tab } : {});
}

beforeEach(() => {
  // A fresh in-memory localStorage per test (the names column reads it). Node
  // ≥ 25's global shadows jsdom's and Node 22's persists across a file's tests
  // — CLAUDE.md's Node-version footgun.
  store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
  setTab("lesson");
  nav.replace.mockReset();
  nav.push.mockReset();
  getSpy = vi.spyOn(teacherApi, "getClass") as unknown as GetClassMock;
  mintSpy = vi.spyOn(teacherApi, "mintGroupCodes") as unknown as MintMock;
  listActivitiesSpy = vi.spyOn(teacherApi, "listActivities") as unknown as ListActivitiesMock;
  patchActivitiesSpy = vi.spyOn(teacherApi, "patchClassActivities") as unknown as PatchClassActivitiesMock;
  sessionsSpy = vi.spyOn(teacherApi, "listClassRecentSessions") as unknown as SessionsMock;
  liveSpy = vi.spyOn(teacherApi, "listClassLive") as unknown as LiveMock;
  // Default: empty library, no sessions, nobody live. Individual tests override.
  listActivitiesSpy.mockResolvedValue({ activities: [], total: 0, limit: 200, offset: 0 });
  sessionsSpy.mockResolvedValue([]);
  liveSpy.mockResolvedValue(livePayload());
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openTheClass(payload: ClassPayload = makeClassPayload()) {
  getSpy.mockResolvedValue(payload);
  render(<TeacherClassDetailPage />);
  await screen.findByRole("heading", { name: targetClass.name });
}

/** Open a Radix menu the way a keyboard user does (Enter on the trigger).
 *  fireEvent, not userEvent: `userEvent.setup()` swaps in its own clipboard,
 *  which would hide the page's writeText calls from the stub below. */
async function openMenu(name: string | RegExp) {
  const trigger = await screen.findByRole("button", { name });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return { items: await screen.findAllByRole("menuitem") };
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  const fn = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: fn } });
  return fn;
}

describe("/teacher/classes/[id] — the header", () => {
  it("renders the class name, and the breadcrumb says Classes (not Dashboard)", async () => {
    await openTheClass();
    const crumb = screen.getByRole("link", { name: "Classes" });
    expect(crumb).toHaveAttribute("href", "/teacher/classes");
    expect(screen.queryByText("Dashboard")).toBeNull();
  });

  it("offers three views, kept in the URL", async () => {
    await openTheClass();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Lesson", "After the lesson", "Setup"]);
    expect(screen.getByRole("tab", { name: "Lesson" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "After the lesson" }));
    expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("tab=after"), { scroll: false });
  });

  it("shows an error with Retry when the class fails to load", async () => {
    getSpy.mockRejectedValueOnce(new Error("permission denied")).mockResolvedValue(makeClassPayload());
    render(<TeacherClassDetailPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission denied/);
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: targetClass.name });
    expect(getSpy).toHaveBeenCalledTimes(2);
  });
});

describe("/teacher/classes/[id] — the default view", () => {
  async function selectedTab() {
    await waitFor(() => expect(screen.getAllByRole("tab").length).toBe(3));
    return screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent;
  }

  it("opens on Lesson when a group was active in the last 90 minutes", async () => {
    setTab(null);
    sessionsSpy.mockResolvedValue([session({ lastMessageAt: new Date(Date.now() - 10 * 60_000).toISOString() })]);
    await openTheClass();
    expect(await selectedTab()).toBe("Lesson");
  });

  it("opens on After the lesson when the class has had a lesson, but none is on now", async () => {
    setTab(null);
    sessionsSpy.mockResolvedValue([session()]);
    await openTheClass();
    expect(await selectedTab()).toBe("After the lesson");
  });

  it("opens on Setup for a class that has never had a lesson", async () => {
    setTab(null);
    await openTheClass();
    expect(await selectedTab()).toBe("Setup");
  });

  it("opens on Lesson, not Setup, when the sessions could not be read", async () => {
    // A failed read is not "this class is new".
    setTab(null);
    sessionsSpy.mockRejectedValue(new Error("offline"));
    await openTheClass();
    expect(await selectedTab()).toBe("Lesson");
  });

  it("an explicit ?tab= wins", async () => {
    setTab("after");
    sessionsSpy.mockResolvedValue([session({ lastMessageAt: new Date().toISOString() })]);
    await openTheClass();
    expect(await selectedTab()).toBe("After the lesson");
  });
});

describe("/teacher/classes/[id] — Lesson: the one groups table", () => {
  it("lists each live code once, with the join address explained", async () => {
    await openTheClass();
    const table = await screen.findByTestId("groups-table");
    expect(within(table).getByText("bright-fox-12")).toBeInTheDocument();
    expect(within(table).getByText("soft-otter-44")).toBeInTheDocument();
    // 2026-08-04: a teacher handed out dev codes that students typed into test.
    expect(screen.getByText(`${window.location.origin}/group`)).toBeInTheDocument();
    // The old page listed the same groups four times; now one table.
    expect(screen.getAllByText("bright-fox-12")).toHaveLength(1);
  });

  it("merges the live signals into a Status column", async () => {
    const now = new Date().toISOString();
    liveSpy.mockResolvedValue(
      livePayload({
        calls: [{ groupId: "bright-fox-12", activityId: "a", activityTitle: "Energy", raisedHandAt: now }],
        groups: [
          { groupId: "bright-fox-12", status: "active", turns: 9, lastActivityAt: now, idleSeconds: 5, stuck: false, activityTitle: "Energy", skillId: "s" },
          { groupId: "soft-otter-44", status: "idle", turns: 4, lastActivityAt: now, idleSeconds: 720, stuck: true, activityTitle: "Energy", skillId: "s" },
        ],
      }),
    );
    await openTheClass(makeClassPayload({ groupCodes: ["bright-fox-12", "soft-otter-44", "calm-heron-3"] }));
    const hand = await screen.findByTestId("group-row-bright-fox-12");
    await waitFor(() => expect(hand).toHaveTextContent("Hand raised"));
    expect(hand).toHaveTextContent("9");
    // "Stuck" now reads as what it is: quiet for N minutes.
    const quiet = screen.getByTestId("group-row-soft-otter-44");
    expect(quiet).toHaveTextContent("Quiet for 12 min");
    // …and the stuck signal survives, as an emphasised chip with the reason.
    expect(quiet.querySelector("[data-stuck]")).not.toBeNull();
    expect(screen.getByTestId("group-row-calm-heron-3")).toHaveTextContent("Not started");
  });

  it("Acknowledge still clears a raised hand", async () => {
    const ack = vi.spyOn(teacherApi, "ackClassSignal").mockResolvedValue(undefined);
    liveSpy.mockResolvedValue(
      livePayload({
        calls: [{ groupId: "bright-fox-12", activityId: "a", activityTitle: "Energy", raisedHandAt: new Date().toISOString() }],
      }),
    );
    await openTheClass();
    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge bright-fox-12" }));
    await waitFor(() => expect(ack).toHaveBeenCalledWith(CLASS_ID, "bright-fox-12"));
  });

  it("shows the AI class summary when there is one", async () => {
    liveSpy.mockResolvedValue(
      livePayload({ summary: { text: "Most groups found the pattern.", framework: "live v0", generatedAt: new Date().toISOString() } }),
    );
    await openTheClass();
    expect(await screen.findByTestId("live-summary")).toHaveTextContent("Most groups found the pattern.");
  });

  it("copies a join link carrying the origin AND the code, and says so", async () => {
    const writeText = stubClipboard(async () => {});
    const success = vi.spyOn(notify, "success");
    await openTheClass();

    fireEvent.click(screen.getByRole("button", { name: "Copy join link for bright-fox-12" }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/group?code=bright-fox-12`);
    await waitFor(() => expect(success).toHaveBeenCalledWith("Copied join link for bright-fox-12"));
  });

  it("does not claim 'Copied' when the clipboard refused — it shows the text instead", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    const success = vi.spyOn(notify, "success");
    const error = vi.spyOn(notify, "error");
    await openTheClass();
    fireEvent.click(screen.getByRole("button", { name: "Copy join link for bright-fox-12" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("/group?code=bright-fox-12")));
    expect(success).not.toHaveBeenCalled();
  });

  it("each row links to its report", async () => {
    await openTheClass();
    expect(screen.getByRole("link", { name: "Open the report for bright-fox-12" })).toHaveAttribute(
      "href",
      "/teacher/reports/groups/bright-fox-12",
    );
  });

  it("puts Copy code, Start a new conversation and Revoke in the row's ⋯ menu", async () => {
    const writeText = stubClipboard(async () => {});
    await openTheClass();
    const { items } = await openMenu("More actions for bright-fox-12");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("Copy code"),
      expect.stringContaining("Start a new conversation"),
      expect.stringContaining("Revoke the code…"),
    ]);
    // The hint says what Start-a-new-conversation does: nothing is lost.
    expect(items[1]).toHaveTextContent("The old one is kept for the report");
    fireEvent.click(items[0]);
    expect(writeText).toHaveBeenCalledWith("bright-fox-12");
  });

  it("'New group' mints a code, refreshes the table and announces it", async () => {
    stubClipboard(async () => {});
    const success = vi.spyOn(notify, "success");
    getSpy
      .mockResolvedValueOnce(makeClassPayload({ groupCodes: [] }))
      .mockResolvedValue(makeClassPayload({ groupCodes: ["fresh-mint-01"] }));
    mintSpy.mockResolvedValue({ classId: CLASS_ID, codes: ["fresh-mint-01"] });

    render(<TeacherClassDetailPage />);
    await screen.findByRole("heading", { name: targetClass.name });
    fireEvent.click(screen.getByRole("button", { name: /new group/i }));

    await waitFor(() => expect(mintSpy).toHaveBeenCalledWith(CLASS_ID, 1));
    await screen.findByTestId("group-row-fresh-mint-01");
    await waitFor(() => expect(success).toHaveBeenCalledWith(expect.stringMatching(/group code fresh-mint-01 created/i)));
  });

  describe("starting a new conversation (was 'Reset session')", () => {
    it("asks first, then archives the group's session", async () => {
      const reset = vi.spyOn(teacherApi, "resetGroupSession").mockResolvedValue(undefined);
      await openTheClass();
      const { items } = await openMenu("More actions for bright-fox-12");
      fireEvent.click(items[1]);

      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent(/archived and kept for the report/);
      expect(reset).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: "Start new conversation" }));
      await waitFor(() => expect(reset).toHaveBeenCalledWith(CLASS_ID, "bright-fox-12"));
    });

    it("cancel leaves the session alone", async () => {
      const reset = vi.spyOn(teacherApi, "resetGroupSession");
      await openTheClass();
      const { items } = await openMenu("More actions for bright-fox-12");
      fireEvent.click(items[1]);
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
      expect(reset).not.toHaveBeenCalled();
    });
  });

  describe("revoking a leaked join code (2026-09-29)", () => {
    // The endpoint had NO UI until the check-client-api gate found it; a
    // teacher whose code got out could only reset the session, which does not
    // stop anyone rejoining with the same code.
    const CODE = "bright-fox-12";

    async function chooseRevoke() {
      const { items } = await openMenu(`More actions for ${CODE}`);
      fireEvent.click(items[2]);
      return { dialog: await screen.findByRole("alertdialog") };
    }

    it("does not revoke on the first click — it asks, and says what will happen", async () => {
      const revokeSpy = vi.spyOn(teacherApi, "revokeGroupCode");
      await openTheClass();
      const { dialog } = await chooseRevoke();
      // ⚠️ Harder than a new conversation: revoke tombstones the anon_groups
      // doc, so a student mid-lesson fails at their next message and the code
      // can never be reissued. A one-click version would be the wrong shape.
      expect(revokeSpy).not.toHaveBeenCalled();
      expect(dialog).toHaveTextContent(/Signs students out now\. Cannot be undone\./);
      // Revoke is not erasure (that is 1.1.80's own thing).
      expect(dialog).toHaveTextContent(/stay available to you and to researchers/i);
    });

    it("revokes on confirmation, says the work is kept, and refreshes", async () => {
      const success = vi.spyOn(notify, "success");
      const revokeSpy = vi
        .spyOn(teacherApi, "revokeGroupCode")
        .mockResolvedValue({ revoked: true, code: CODE, classId: CLASS_ID });
      await openTheClass();
      const { dialog } = await chooseRevoke();
      fireEvent.click(within(dialog).getByRole("button", { name: "Revoke code" }));

      await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith(CLASS_ID, CODE));
      await waitFor(() => expect(success).toHaveBeenCalledWith(expect.stringMatching(/work is kept/i)));
      await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
    });

    it("cancel leaves the code alone", async () => {
      const revokeSpy = vi.spyOn(teacherApi, "revokeGroupCode");
      await openTheClass();
      const { dialog } = await chooseRevoke();
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(revokeSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId(`group-row-${CODE}`)).toBeInTheDocument();
    });

    it("lists revoked codes in their own section with a report link and no controls", async () => {
      // 1.1.146 — Revoke ends access, never evidence.
      await openTheClass(
        makeClassPayload({
          groupCodes: ["bright-fox-12", "soft-otter-44"],
          revokedGroupCodes: ["soft-otter-44"],
          revokedGroupCodesAt: { "soft-otter-44": "2026-09-30T09:01:31Z" },
        }),
      );
      const section = await screen.findByTestId("revoked-codes");
      expect(section).toHaveTextContent("Revoked codes (1)");
      expect(section).toHaveTextContent("soft-otter-44");
      const report = within(section).getByLabelText("Open the report for soft-otter-44");
      expect(report).toHaveAttribute("href", "/teacher/reports/groups/soft-otter-44");
      // No live controls for a code that no longer works.
      expect(section.querySelectorAll("button")).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "More actions for soft-otter-44" })).toBeNull();
      expect(screen.queryByTestId("group-row-soft-otter-44")).toBeNull();
      // The live code keeps its controls.
      expect(screen.getByRole("button", { name: "More actions for bright-fox-12" })).toBeInTheDocument();
    });
  });
});

describe("/teacher/classes/[id] — After the lesson", () => {
  beforeEach(() => setTab("after"));

  it("a failed sessions read says so with Retry — never 'no sessions yet'", async () => {
    sessionsSpy.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([session()]);
    await openTheClass();
    const failed = (await screen.findByText("The sessions could not be loaded")).closest("[role=alert]") as HTMLElement;
    expect(screen.queryByText(/No student sessions yet/)).toBeNull();

    fireEvent.click(within(failed).getByRole("button", { name: "Try again" }));
    await screen.findByTestId("recent-sessions");
    expect(sessionsSpy).toHaveBeenCalledTimes(2);
  });

  it("says 'no sessions yet' only when the read answered with none", async () => {
    await openTheClass();
    expect(await screen.findByText(/No student sessions yet/)).toBeInTheDocument();
  });

  it("shows three sessions, then all on 'Show all', each linking to its report", async () => {
    sessionsSpy.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => session({ sessionId: `s-${i}`, title: `Lesson ${i}` })),
    );
    await openTheClass();
    const list = await screen.findByTestId("recent-sessions");
    expect(within(list).getAllByRole("link")).toHaveLength(3);
    expect(within(list).getAllByRole("link")[0]).toHaveAttribute(
      "href",
      "/teacher/reports/groups/bright-fox-12?session_id=s-0",
    );
    // "Report" everywhere — the old page said "Report" in one list, "View" in another.
    expect(within(list).getAllByText("Report")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Show all (5)" }));
    expect(within(list).getAllByRole("link")).toHaveLength(5);
  });

  it("merges CSV and JSON into one Export menu", async () => {
    sessionsSpy.mockResolvedValue([session()]);
    await openTheClass();
    await screen.findByTestId("recent-sessions");
    const { items } = await openMenu(/^Export/);
    expect(items.map((i) => i.textContent)).toEqual([expect.stringMatching(/^CSV/), expect.stringMatching(/^JSON/)]);
  });

  it("holds Compare groups (moved from the page header) and the Numbers", async () => {
    await openTheClass();
    expect(screen.getByRole("link", { name: /Compare groups/ })).toHaveAttribute(
      "href",
      `/teacher/classes/${CLASS_ID}/compare`,
    );
    // Insights and spend are two collapsibles of the same kind, closed — so
    // neither loads until opened.
    expect(screen.getByRole("button", { name: /^Insights/, expanded: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Spend/, expanded: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Groups that can help each other/, expanded: false })).toBeInTheDocument();
  });
});

describe("/teacher/classes/[id] — Setup", () => {
  beforeEach(() => setTab("setup"));

  it("holds the class name, the tutor and voice & recording — without the 'where settings live' box", async () => {
    await openTheClass();
    expect(screen.getByRole("heading", { name: "The class" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tutor" })).toBeInTheDocument();
    // The approaches page keeps its tab in the URL; land on its Tutors tab.
    expect(screen.getByRole("link", { name: "Teaching approaches" })).toHaveAttribute(
      "href",
      "/teacher/research/frameworks?tab=tutors",
    );
    expect(screen.getByRole("heading", { name: /Voice & recording/ })).toBeInTheDocument();
    expect(screen.getByText(/Each activity decides what the students do/)).toBeInTheDocument();
    expect(screen.queryByTestId("settings-map")).toBeNull();
  });

  describe("activities (ALS-1 M1.3)", () => {
    it("renders assigned activities with title + teaching goal", async () => {
      listActivitiesSpy.mockResolvedValue({ activities: [makeActivity()], total: 1, limit: 200, offset: 0 });
      await openTheClass(makeClassPayload({ activityIds: ["act-pset"] }));
      expect(await screen.findByText("Problem-set hints (Boldkast)")).toBeInTheDocument();
      expect(screen.getByText("Danish projectile-motion tutor.")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Activities in this class (1)" })).toBeInTheDocument();
    });

    it("'Add activity ▾' offers the library and a new activity for this class", async () => {
      listActivitiesSpy.mockResolvedValue({
        activities: [makeActivity(), makeActivity({ activityId: "act-energy", title: "Energy basics" })],
        total: 2,
        limit: 200,
        offset: 0,
      });
      await openTheClass(makeClassPayload({ activityIds: ["act-pset"] }));
      await screen.findByText("Problem-set hints (Boldkast)");
      const { items } = await openMenu(/add activity/i);
      expect(items.map((i) => i.textContent)).toEqual([
        expect.stringContaining("From your library…"),
        expect.stringContaining("Create a new activity…"),
      ]);
      fireEvent.click(items[0]);
      // The unassigned one is in the picker; the assigned one is NOT.
      const picker = await screen.findByRole("region", { name: /pick an activity/i });
      expect(within(picker).getByText("Energy basics")).toBeInTheDocument();
      expect(screen.getAllByText("Problem-set hints (Boldkast)")).toHaveLength(1);
    });

    it("'Create a new activity…' opens the builder for THIS class", async () => {
      await openTheClass();
      const { items } = await openMenu(/add activity/i);
      fireEvent.click(items[1]);
      expect(nav.push).toHaveBeenCalledWith(`/teacher/activities/new?classId=${CLASS_ID}`);
    });

    it("the Edit link carries this class, so the editor names this class's tutor", async () => {
      listActivitiesSpy.mockResolvedValue({
        activities: [makeActivity({ title: "Mechanical Waves" })],
        total: 1,
        limit: 200,
        offset: 0,
      });
      await openTheClass(makeClassPayload({ activityIds: ["act-pset"] }));
      await screen.findByText("Mechanical Waves");
      const href = screen.getByRole("link", { name: /^edit$/i }).getAttribute("href") ?? "";
      expect(href).toContain("/teacher/activities/act-pset?");
      expect(href).toContain(`classId=${CLASS_ID}`);
    });

    it("picking an activity calls patchClassActivities({add})", async () => {
      getSpy.mockResolvedValue(makeClassPayload({ activityIds: [] }));
      listActivitiesSpy.mockResolvedValue({ activities: [makeActivity()], total: 1, limit: 200, offset: 0 });
      patchActivitiesSpy.mockResolvedValue(makeClassPayload({ activityIds: ["act-pset"] }));
      render(<TeacherClassDetailPage />);
      await screen.findByRole("heading", { name: targetClass.name });
      const { items } = await openMenu(/add activity/i);
      fireEvent.click(items[0]);
      fireEvent.click(await screen.findByRole("button", { name: /Problem-set hints \(Boldkast\)/ }));
      await waitFor(() => expect(patchActivitiesSpy).toHaveBeenCalledWith(CLASS_ID, { add: ["act-pset"] }));
    });

    it("Remove sits in the activity's ⋯ menu and calls patchClassActivities({remove})", async () => {
      listActivitiesSpy.mockResolvedValue({ activities: [makeActivity()], total: 1, limit: 200, offset: 0 });
      patchActivitiesSpy.mockResolvedValue(makeClassPayload({ activityIds: [] }));
      await openTheClass(makeClassPayload({ activityIds: ["act-pset"] }));
      await screen.findByText("Problem-set hints (Boldkast)");
      const { items } = await openMenu("More actions for Problem-set hints (Boldkast)");
      fireEvent.click(items[0]);
      await waitFor(() => expect(patchActivitiesSpy).toHaveBeenCalledWith(CLASS_ID, { remove: ["act-pset"] }));
    });

    it("'From your library…' is disabled when every library activity is already assigned", async () => {
      listActivitiesSpy.mockResolvedValue({ activities: [makeActivity()], total: 1, limit: 200, offset: 0 });
      await openTheClass(makeClassPayload({ activityIds: ["act-pset"] }));
      await screen.findByText("Problem-set hints (Boldkast)");
      const { items } = await openMenu(/add activity/i);
      expect(items[0]).toHaveAttribute("data-disabled");
      expect(items[1]).not.toHaveAttribute("data-disabled");
    });

    it("a failed library read says so with Retry — never 'no activities assigned'", async () => {
      listActivitiesSpy
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ activities: [makeActivity()], total: 1, limit: 200, offset: 0 });
      await openTheClass(makeClassPayload({ activityIds: ["act-pset"] }));
      const failed = (await screen.findByText("The class's activities could not be loaded")).closest(
        "[role=alert]",
      ) as HTMLElement;
      expect(screen.queryByText(/No activities assigned yet/)).toBeNull();
      fireEvent.click(within(failed).getByRole("button", { name: "Try again" }));
      expect(await screen.findByText("Problem-set hints (Boldkast)")).toBeInTheDocument();
    });
  });

  describe("deleting the class (moved here from the class list)", () => {
    it("asks first, then calls the same delete API and returns to the class list", async () => {
      const del = vi.spyOn(teacherApi, "deleteClass").mockResolvedValue({ revoked: true, classId: CLASS_ID });
      await openTheClass();
      fireEvent.click(screen.getByRole("button", { name: "Delete class…" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent(`Delete “${targetClass.name}”?`);
      expect(dialog).toHaveTextContent(/2 group codes/);
      expect(del).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete class" }));
      await waitFor(() => expect(del).toHaveBeenCalledWith(CLASS_ID));
      await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/teacher/classes"));
    });

    it("cancel deletes nothing", async () => {
      const del = vi.spyOn(teacherApi, "deleteClass");
      await openTheClass();
      fireEvent.click(screen.getByRole("button", { name: "Delete class…" }));
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
      expect(del).not.toHaveBeenCalled();
      expect(nav.push).not.toHaveBeenCalled();
    });
  });
});

// 1.1.137 — the class list on the real page. The component test proves the
// table itself; this proves the PAGE does not pick a name up on the way (a
// refresh, a mint, an analytics call) while the teacher types one.
describe("/teacher/classes/[id] — names stay on the device", () => {
  it("typing a name on the page sends it nowhere", async () => {
    // Records every request the page makes; fails them like an offline
    // network so neighbouring panels take their error path, not a fake body.
    const fetchSpy = vi.fn(async (..._args: unknown[]) => {
      throw new TypeError("offline (test)");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const writeText = stubClipboard(async () => {});
    const resetSpy = vi.spyOn(teacherApi, "resetGroupSession").mockResolvedValue(undefined);
    try {
      getSpy.mockResolvedValue(makeClassPayload());
      mintSpy.mockResolvedValue({ codes: ["new-code-1"] } as unknown as Awaited<
        ReturnType<typeof teacherApi.mintGroupCodes>
      >);
      render(<TeacherClassDetailPage />);
      fireEvent.change(await screen.findByLabelText("Names for bright-fox-12"), {
        target: { value: "Zelda Privatperson" },
      });
      fireEvent.click(screen.getByRole("button", { name: /new group/i }));
      await waitFor(() => expect(mintSpy).toHaveBeenCalled());
      fireEvent.click(screen.getByRole("button", { name: "Copy join link for bright-fox-12" }));
      const { items } = await openMenu("More actions for bright-fox-12");
      fireEvent.click(items[1]);
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Start new conversation" }));
      await waitFor(() => expect(resetSpy).toHaveBeenCalled());

      expect(store.get("aipla.classlist.class-7b-physics-a")).toContain("Zelda Privatperson");
      const sent = JSON.stringify([
        fetchSpy.mock.calls,
        getSpy.mock.calls,
        mintSpy.mock.calls,
        resetSpy.mock.calls,
        listActivitiesSpy.mock.calls,
        patchActivitiesSpy.mock.calls,
        sessionsSpy.mock.calls,
        liveSpy.mock.calls,
        writeText.mock.calls,
      ]);
      expect(sent).not.toContain("Zelda");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
