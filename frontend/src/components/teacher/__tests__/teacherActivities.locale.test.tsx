// 1.1.108 M2 — the activity builder speaks the TEACHER's language: Danish by
// default, English when the teacher picks EN. The students' language (the
// activity's own `language` field) is data and is not what this file tests.
import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActivityBuilderBody } from "@/components/teacher/ActivityBuilderBody";
import { BuilderSection, BuilderSectionNav, SECTION } from "@/components/teacher/BuilderLayout";
import { CalculatorEditor } from "@/components/teacher/CalculatorEditor";
import { ChartEditor } from "@/components/teacher/ChartEditor";
import { ConceptMapEditor } from "@/components/teacher/ConceptMapEditor";
import { DocumentEditor } from "@/components/teacher/DocumentEditor";
import { NoteEditor } from "@/components/teacher/NoteEditor";
import { SolutionEditor } from "@/components/teacher/SolutionEditor";
import { TableEditor } from "@/components/teacher/TableEditor";
import { WritingEditor } from "@/components/teacher/WritingEditor";
import { ActivityFilterBar, EMPTY_ACTIVITY_FILTERS } from "@/components/teacher/ActivityFilterBar";
import { CompositionRow } from "@/components/teacher/activityDisplay";
import { useActivityBuilder } from "@/hooks/useActivityBuilder";
import { LocaleProvider } from "@/i18n";
import type { ActivityPayload } from "@/lib/teacherApi";

// The builder's heavy neighbours are not what is under test here.
vi.mock("@/components/teacher/SimPicker", () => ({ SimPicker: () => <div data-testid="sim-picker" /> }));
vi.mock("@/components/teacher/MaterialsSection", () => ({ MaterialsSection: () => <div /> }));
// The preview speaks the STUDENTS' language by design — out of scope here.
vi.mock("@/components/teacher/ActivityPreview", () => ({ ActivityPreview: () => <div /> }));

const DANISH = /[æøåÆØÅ]/;

/** Every piece of text a teacher can meet: visible text + the attributes a
 *  screen reader or tooltip speaks. */
function allCopy(container: HTMLElement): string {
  const attrs = Array.from(container.querySelectorAll("[aria-label],[title],[placeholder],[alt]")).flatMap((el) =>
    ["aria-label", "title", "placeholder", "alt"].map((a) => el.getAttribute(a) ?? ""),
  );
  return [container.textContent ?? "", ...attrs].join(" ");
}

describe("activity builder — teacher language", () => {
  it("is Danish by default (no provider = the site default)", () => {
    const { result } = renderHook(() => useActivityBuilder());
    render(<ActivityBuilderBody builder={result.current} footer={<button type="submit">Gem</button>} />);
    expect(screen.getByLabelText(/elevernes sprog/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tilføj trin/i })).toBeInTheDocument();
    expect(screen.getAllByText("Opsætning").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Add step/)).not.toBeInTheDocument();
  });

  it("has no Danish anywhere in the editors under English", () => {
    const nextKey = (() => {
      let k = 100;
      return () => k++;
    })();
    const table = [
      { key: 1, title: "", rows: 5, columns: [{ key: 2, label: "t", unit: "s", kind: "number" as const }, { key: 3, label: "v", unit: "m/s", kind: "number" as const }] },
    ];
    const { container } = render(
      <LocaleProvider locale="en">
        <BuilderSectionNav />
        <BuilderSection section={SECTION.workspace}>
          <TableEditor value={table} onChange={() => {}} nextKey={nextKey} />
          <TableEditor value={[]} onChange={() => {}} nextKey={nextKey} />
          <ChartEditor
            value={[{ id: "chart-1", title: "", chartKind: "scatter", tableId: null, xColumn: null, yColumn: null }]}
            onChange={() => {}}
            tables={table}
          />
          <ChartEditor value={[]} onChange={() => {}} tables={[]} />
          <CalculatorEditor value={null} onChange={() => {}} />
          <CalculatorEditor
            value={{ title: "", formula: "", inputs: [{ key: 1, id: "m", label: "", unit: "" }] }}
            onChange={() => {}}
          />
          <NoteEditor value={null} onChange={() => {}} />
          <NoteEditor value={{ title: "", body: "" }} onChange={() => {}} />
          <WritingEditor value={[{ key: 1, id: "", title: "", prompt: "", minWords: 0 }]} onChange={() => {}} nextKey={nextKey} />
          <SolutionEditor value={{ prompt: "" }} onChange={() => {}} />
          <DocumentEditor value={{ prompt: "" }} onChange={() => {}} />
          <ConceptMapEditor
            value={{ title: "", nodes: [{ key: 1, id: "a", label: "", doneWhen: "", dependsOn: [], questions: [{ key: 2, prompt: "", expectedAnswer: "" }] }] }}
            onChange={() => {}}
            nextKey={nextKey}
            onPropose={() => {}}
          />
        </BuilderSection>
        <ActivityFilterBar facets={null} filters={{ ...EMPTY_ACTIVITY_FILTERS, q: "x" }} onChange={() => {}} />
        <CompositionRow activity={{ checklist: [], table: [], chart: [], calculator: [], note: [], solution: [], document: [], materials: [] } as unknown as ActivityPayload} />
      </LocaleProvider>,
    );
    expect(allCopy(container)).not.toMatch(DANISH);
    // …and it really is English, not merely empty.
    expect(screen.getAllByRole("button", { name: /add data table/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /suggest a concept map/i })).toBeInTheDocument();
  });
});
