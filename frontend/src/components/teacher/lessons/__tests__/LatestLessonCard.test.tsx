// 1.1.139 M2 — the class page's "Latest lesson" card: cached read only, nothing
// when there is no lesson.

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/lessonOverviewApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lessonOverviewApi")>("@/lib/lessonOverviewApi");
  return { ...actual, fetchClassLessons: vi.fn(), fetchLesson: vi.fn() };
});

import { LatestLessonCard } from "@/components/teacher/lessons/LatestLessonCard";
import { LocaleProvider } from "@/i18n";
import { fetchClassLessons, fetchLesson } from "@/lib/lessonOverviewApi";

import { makeLesson } from "./fixtures";

const lessonsSpy = vi.mocked(fetchClassLessons);
const lessonSpy = vi.mocked(fetchLesson);

function renderCard() {
  return render(
    <LocaleProvider locale="en">
      <LatestLessonCard classId="c1" />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  lessonsSpy.mockReset();
  lessonSpy.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("LatestLessonCard", () => {
  it("shows the latest lesson's struggles and next time, from a cached-only read", async () => {
    lessonsSpy.mockResolvedValue([
      {
        activityId: "act-1",
        activityTitle: "Waves",
        date: "2026-10-20",
        groups: 3,
        sessions: 3,
        turns: 36,
        startedAt: null,
        lastAt: null,
      },
    ]);
    lessonSpy.mockResolvedValue(makeLesson());
    renderCard();
    const card = await screen.findByTestId("latest-lesson-card");
    expect(lessonSpy).toHaveBeenCalledWith("c1", "act-1", "2026-10-20", { synthesis: "cached" });
    expect(card).toHaveTextContent("Latest lesson: Waves");
    expect(card).toHaveTextContent("Struggled with");
    expect(card).toHaveTextContent("Frequency");
    expect(card).toHaveTextContent("Start next lesson on frequency.");
    expect(screen.getByRole("link", { name: "Open the lesson overview" })).toHaveAttribute(
      "href",
      "/teacher/insights/lessons/c1/act-1?date=2026-10-20",
    );
  });

  it("renders nothing for a class with no lessons", async () => {
    lessonsSpy.mockResolvedValue([]);
    const { container } = renderCard();
    await waitFor(() => expect(lessonsSpy).toHaveBeenCalled());
    expect(lessonSpy).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the read fails", async () => {
    lessonsSpy.mockRejectedValue(new Error("fetch class lessons: 500"));
    const { container } = renderCard();
    await waitFor(() => expect(lessonsSpy).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
