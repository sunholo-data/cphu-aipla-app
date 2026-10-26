// 1.1.139 M2 — the lesson overview: concepts first and findable, approach with
// coverage, what next, groups with outliers first.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LessonOverview, filterConcepts, groupReportHref } from "@/components/teacher/lessons/LessonOverview";
import { LocaleProvider } from "@/i18n";

import { makeLesson } from "./fixtures";

function renderOverview(ui: React.ReactElement, locale: "en" | "da" = "en") {
  return render(<LocaleProvider locale={locale}>{ui}</LocaleProvider>);
}

describe("LessonOverview", () => {
  it("lists concepts most-struggled first as a concept x group strip", () => {
    renderOverview(<LessonOverview lesson={makeLesson()} />);
    const strip = screen.getByTestId("concept-strip");
    const rows = within(strip).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual(["Frequency", "Amplitude"]);
    expect(within(strip).getByRole("img", { name: "g3: understood" })).toBeInTheDocument();
    expect(within(strip).getAllByRole("img", { name: "g2: not mentioned" })).toHaveLength(1);
  });

  it("search filters the strip, and a click on a concept shows which groups with the tutor's evidence", async () => {
    const user = userEvent.setup();
    renderOverview(<LessonOverview lesson={makeLesson()} />);
    await user.type(screen.getByLabelText("Find a concept"), "ampl");
    const strip = screen.getByTestId("concept-strip");
    expect(within(strip).queryByText("Frequency")).toBeNull();
    await user.click(within(screen.getByTestId("concept-chips")).getByRole("button", { name: "Amplitude" }));
    const detail = screen.getByTestId("concept-detail");
    expect(detail).toHaveTextContent("Groups and Amplitude");
    expect(detail).toHaveTextContent("Explained amplitude as maximum displacement.");
    expect(detail).toHaveTextContent("1 discussed · 0 struggled · 1 understood");
  });

  it("says so when nothing matches the search", async () => {
    const user = userEvent.setup();
    renderOverview(<LessonOverview lesson={makeLesson()} />);
    await user.type(screen.getByLabelText("Find a concept"), "entropy");
    expect(screen.getByText("No concept matches “entropy”.")).toBeInTheDocument();
  });

  it("status chips filter to concepts with that status", () => {
    const concepts = makeLesson().concepts;
    expect(filterConcepts(concepts, "", "demonstrated").map((c) => c.key)).toEqual(["amplitude"]);
    expect(filterConcepts(concepts, "FREQ", "all").map((c) => c.key)).toEqual(["frequency"]);
  });

  it("states coverage before the approach prose, with no numbers for the teacher", () => {
    renderOverview(<LessonOverview lesson={makeLesson()} />);
    const cov = screen.getByTestId("approach-coverage");
    expect(cov).toHaveTextContent("Assessed in 1 of 3 groups.");
    expect(cov).toHaveTextContent("1 group was too short to judge.");
    expect(cov).toHaveTextContent("1 group has not been judged yet");
    expect(screen.getByTestId("approach-synthesis")).toHaveTextContent("mostly elicited first");
    expect(screen.queryByTestId("approach-bands")).toBeNull();
  });

  it("shows researchers the band distribution", () => {
    const lesson = makeLesson();
    lesson.approach.bands = { elicit: { partial: 1 } };
    renderOverview(<LessonOverview lesson={lesson} />);
    expect(screen.getByTestId("approach-bands")).toHaveTextContent("elicit");
  });

  it("says when the lesson's tutor ran no named approach", () => {
    renderOverview(
      <LessonOverview
        lesson={makeLesson({ approach: { state: "no_framework", frameworkId: null, coverage: { groups: 3 } } })}
      />,
    );
    expect(screen.getByTestId("approach-none")).toHaveTextContent("no named teaching approach");
  });

  it("puts outliers first and links each group to its report inside the lesson", () => {
    const lesson = makeLesson();
    renderOverview(<LessonOverview lesson={lesson} />);
    const items = within(screen.getByTestId("lesson-groups")).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("g2");
    expect(items[0]).toHaveTextContent("struggled more than most");
    expect(items[2]).toHaveTextContent("not summarised yet");
    expect(within(items[0]).getByRole("link", { name: "Open report" })).toHaveAttribute(
      "href",
      groupReportHref(lesson, lesson.groups[0]),
    );
    expect(groupReportHref(lesson, lesson.groups[0])).toBe(
      "/teacher/reports/groups/g2?session_id=s2&lessonActivity=act-1&lessonDate=2026-10-20",
    );
  });

  it("offers the explicit summarise action for pending sessions", async () => {
    const user = userEvent.setup();
    const onSummarise = vi.fn();
    renderOverview(<LessonOverview lesson={makeLesson()} onSummarise={onSummarise} />);
    expect(screen.getByTestId("lesson-pending")).toHaveTextContent("1 session is not summarised yet");
    await user.click(screen.getByRole("button", { name: "Summarise them now" }));
    expect(onSummarise).toHaveBeenCalledOnce();
  });

  it("renders in Danish from the message catalogue", () => {
    renderOverview(<LessonOverview lesson={makeLesson()} />, "da");
    expect(screen.getByRole("heading", { name: "Begreber" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sådan underviste tutoren" })).toBeInTheDocument();
  });
});
