// 1.1.139 M2 — the lesson page and the lessons list.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

let params: Record<string, string> = { classId: "c1", activityId: "act-1" };
let search = new URLSearchParams("date=2026-10-20");
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => params,
  useSearchParams: () => search,
  useRouter: () => ({ replace }),
  usePathname: () => "/teacher/insights/lessons",
}));
vi.mock("@/hooks/useIsResearcher", () => ({ useIsResearcher: () => false }));
vi.mock("@/lib/lessonOverviewApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lessonOverviewApi")>("@/lib/lessonOverviewApi");
  return { ...actual, fetchLesson: vi.fn(), summariseLesson: vi.fn(), fetchClassLessons: vi.fn() };
});
vi.mock("@/lib/teacherApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/teacherApi")>("@/lib/teacherApi");
  return { ...actual, listClasses: vi.fn() };
});

import LessonsPage from "@/app/teacher/insights/lessons/page";
import LessonPage from "@/app/teacher/insights/lessons/[classId]/[activityId]/page";
import { makeLesson } from "@/components/teacher/lessons/__tests__/fixtures";
import { LocaleProvider } from "@/i18n";
import { fetchClassLessons, fetchLesson, summariseLesson } from "@/lib/lessonOverviewApi";
import { type ClassPayload, listClasses } from "@/lib/teacherApi";

const lessonSpy = vi.mocked(fetchLesson);
const summariseSpy = vi.mocked(summariseLesson);
const lessonsSpy = vi.mocked(fetchClassLessons);
const classesSpy = vi.mocked(listClasses);

function wrap(ui: React.ReactElement) {
  return render(<LocaleProvider locale="en">{ui}</LocaleProvider>);
}

beforeEach(() => {
  params = { classId: "c1", activityId: "act-1" };
  search = new URLSearchParams("date=2026-10-20");
  lessonSpy.mockReset();
  summariseSpy.mockReset();
  lessonsSpy.mockReset();
  classesSpy.mockReset();
  replace.mockReset();
});

describe("/teacher/insights/lessons/[classId]/[activityId]", () => {
  it("loads the lesson and re-reads it after the teacher summarises the rest", async () => {
    const user = userEvent.setup();
    lessonSpy.mockResolvedValueOnce(makeLesson()).mockResolvedValueOnce(
      makeLesson({
        coverage: { groups: 3, sessions: 3, summarised: 3, conceptsExtracted: 3, pendingSessions: 0, unsummarisable: 0 },
      }),
    );
    summariseSpy.mockResolvedValue({ requested: 1, summarised: 1, failed: 0, remaining: 0 });
    wrap(<LessonPage />);
    expect(await screen.findByRole("heading", { name: "Waves" })).toBeInTheDocument();
    expect(lessonSpy).toHaveBeenCalledWith("c1", "act-1", "2026-10-20");
    await user.click(screen.getByRole("button", { name: "Summarise them now" }));
    expect(summariseSpy).toHaveBeenCalledWith("c1", "act-1", "2026-10-20");
    await waitFor(() => expect(lessonSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("lesson-pending")).toBeNull());
  });

  it("says when no lesson exists for the day", async () => {
    lessonSpy.mockRejectedValue(new Error("fetch lesson: 404 lesson not found"));
    wrap(<LessonPage />);
    expect(await screen.findByText("No lesson was found for this activity on this day.")).toBeInTheDocument();
  });
});

describe("/teacher/insights/lessons", () => {
  it("lists the selected class's lessons with links to each", async () => {
    search = new URLSearchParams("class=c2");
    classesSpy.mockResolvedValue([
      { classId: "c1", name: "1.g" } as ClassPayload,
      { classId: "c2", name: "2.g" } as ClassPayload,
    ]);
    lessonsSpy.mockResolvedValue([
      {
        activityId: "act-1",
        activityTitle: "Waves",
        date: "2026-10-20",
        groups: 3,
        sessions: 3,
        turns: 9,
        startedAt: null,
        lastAt: null,
      },
    ]);
    wrap(<LessonsPage />);
    const link = await screen.findByRole("link", { name: "Open" });
    expect(lessonsSpy).toHaveBeenCalledWith("c2");
    expect(link).toHaveAttribute("href", "/teacher/insights/lessons/c2/act-1?date=2026-10-20");
    expect(screen.getByText("Waves")).toBeInTheDocument();
  });

  it("says so for a class with no lessons yet", async () => {
    search = new URLSearchParams();
    classesSpy.mockResolvedValue([{ classId: "c1", name: "1.g" } as ClassPayload]);
    lessonsSpy.mockResolvedValue([]);
    wrap(<LessonsPage />);
    expect(await screen.findByText(/No lessons yet/)).toBeInTheDocument();
    expect(lessonsSpy).toHaveBeenCalledWith("c1");
  });
});
