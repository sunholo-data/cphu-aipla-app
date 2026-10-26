// 1.1.139 M3 — the after-lesson review and the before-lesson concept nudge.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AfterLessonReview,
  lessonReviewKey,
  newActivityBriefHref,
} from "@/components/teacher/lessons/AfterLessonReview";
import { ConceptListNudge, conceptNudgeKey } from "@/components/teacher/lessons/ConceptListNudge";
import { LocaleProvider } from "@/i18n";

import { makeLesson } from "./fixtures";

let store: Map<string, string>;

beforeEach(() => {
  // A FRESH in-memory localStorage per test — Node 22 (CI) jsdom storage
  // persists across a file's tests; Node >= 25 shadows it (CLAUDE.md footgun).
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
});

function wrap(ui: React.ReactElement) {
  return render(<LocaleProvider locale="en">{ui}</LocaleProvider>);
}

describe("AfterLessonReview", () => {
  it("walks the five steps in order and remembers the lesson as reviewed", async () => {
    const user = userEvent.setup();
    const lesson = makeLesson();
    wrap(<AfterLessonReview lesson={lesson} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    const headings = ["What did the class cover?", "Where did they struggle?", "How did the tutor teach?", "Which groups to look at?", "Next lesson"];
    for (const [i, h] of headings.entries()) {
      expect(screen.getByRole("heading", { name: h })).toBeInTheDocument();
      if (i < headings.length - 1) await user.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(screen.getByText("Start next lesson on frequency.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add to next activity" })).toHaveAttribute(
      "href",
      newActivityBriefHref(lesson, "Start next lesson on frequency."),
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(store.get(lessonReviewKey(lesson))).toBe("done");
    expect(screen.queryByTestId("review-wizard")).toBeNull();
  });

  it("shows the struggled concepts and the outlier groups", async () => {
    const user = userEvent.setup();
    wrap(<AfterLessonReview lesson={makeLesson()} />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Frequency — 2 groups")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("link", { name: "g2" })).toBeInTheDocument();
  });

  it("is not offered again once skipped", async () => {
    const user = userEvent.setup();
    const lesson = makeLesson();
    const { unmount } = wrap(<AfterLessonReview lesson={lesson} />);
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    expect(store.get(lessonReviewKey(lesson))).toBe("skipped");
    unmount();
    wrap(<AfterLessonReview lesson={lesson} />);
    expect(screen.queryByTestId("review-offer")).toBeNull();
  });

  it("is not offered for a lesson with a single group", () => {
    const lesson = makeLesson();
    lesson.coverage = { ...lesson.coverage, groups: 1 };
    wrap(<AfterLessonReview lesson={lesson} />);
    expect(screen.queryByTestId("review-offer")).toBeNull();
  });

  it("carries the brief to a new activity for the class", () => {
    expect(newActivityBriefHref(makeLesson(), "Frequency first")).toBe(
      "/teacher/activities/new?classId=c1&brief=Frequency+first",
    );
  });
});

describe("ConceptListNudge", () => {
  it("nudges an activity with no concepts and asks the co-pilot on request", async () => {
    const user = userEvent.setup();
    const onPropose = vi.fn();
    wrap(<ConceptListNudge activityId="act-1" hasConcepts={false} onPropose={onPropose} />);
    expect(await screen.findByTestId("concept-nudge")).toHaveTextContent("Add 4–8 concepts?");
    await user.click(screen.getByRole("button", { name: "Suggest concepts" }));
    expect(onPropose).toHaveBeenCalledOnce();
  });

  it("stays dismissed for that activity", async () => {
    const user = userEvent.setup();
    const { unmount } = wrap(<ConceptListNudge activityId="act-1" hasConcepts={false} />);
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    expect(store.get(conceptNudgeKey("act-1"))).toBe("1");
    unmount();
    wrap(<ConceptListNudge activityId="act-1" hasConcepts={false} />);
    expect(screen.queryByTestId("concept-nudge")).toBeNull();
  });

  it("says nothing once the activity has concepts, and offers no dead button without a co-pilot", async () => {
    const { rerender } = wrap(<ConceptListNudge activityId="act-2" hasConcepts />);
    expect(screen.queryByTestId("concept-nudge")).toBeNull();
    rerender(
      <LocaleProvider locale="en">
        <ConceptListNudge activityId="act-2" hasConcepts={false} />
      </LocaleProvider>,
    );
    expect(await screen.findByTestId("concept-nudge")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suggest concepts" })).toBeNull();
  });
});
