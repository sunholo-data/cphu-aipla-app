import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "@/i18n";

import { ConceptMapView } from "../ConceptMapView";
import { ProgressChecklist } from "../ProgressChecklist";
import { SimLauncher } from "../SimLauncher";
import { SolutionWhiteboard } from "../SolutionWhiteboard";
import { StudentWorkspace } from "../StudentWorkspace";
import { WorkbenchCalculator } from "../WorkbenchCalculator";
import { WorkbenchTabs } from "../WorkbenchTabs";
import { WorkspaceShell } from "../WorkspaceShell";

// 1.1.108 success metric: an activity with `language: en` renders ZERO Danish
// on the student surface. Asserted over the rendered text AND the accessible
// names/titles, since an aria-label in the wrong language is the same bug a
// screen-reader user hears.

const DANISH = /[æøåÆØÅ]/;

function allText(container: HTMLElement): string {
  const attrs = Array.from(container.querySelectorAll("*")).flatMap((el) =>
    ["aria-label", "title", "placeholder", "alt"].map((a) => el.getAttribute(a) ?? ""),
  );
  return [container.textContent ?? "", ...attrs].join("\n");
}

const ARTEFACT = { id: "boldkast", displayName: "Boldkast", artefactPath: "boldkast/v1" };

function Surface() {
  return (
    <WorkspaceShell ratio={0.5} onRatioChange={() => {}}>
      <StudentWorkspace
        skillId="s"
        sandboxOrigin="https://sandbox.example"
        artefact={ARTEFACT}
        checklist={[{ id: "a", label: "Measure the drop" }]}
        conceptMap={[
          { id: "cm", title: "", nodes: [{ id: "n1", label: "Energy" }], edges: [] },
        ]}
        table={[]}
        chart={[]}
        calculator={[{ id: "c", title: "", formula: "a*b", inputs: [{ id: "a", label: "a" }, { id: "b", label: "b" }] }]}
        note={[]}
        writing={[]}
        solution={[]}
        document={[]}
        materials={[]}
      />
      <SimLauncher artefact={ARTEFACT} onOpen={() => {}} />
      <ProgressChecklist skillId="s" items={[{ id: "a", label: "Measure the drop" }]} />
      <WorkbenchCalculator
        skillId="s"
        calculators={[{ id: "c", title: "", formula: "a*b", inputs: [{ id: "a", label: "a" }] }]}
      />
      <WorkbenchTabs work={<p>w</p>} documents={<p>d</p>} docCount={1} />
      <SolutionWhiteboard onAdd={() => {}} />
      <ConceptMapView conceptMap={[{ id: "cm", title: "", nodes: [{ id: "n1", label: "Energy" }], edges: [] }]} />
    </WorkspaceShell>
  );
}

describe("student workspace locale (1.1.108)", () => {
  it("renders no Danish at all in an English activity", () => {
    const { container } = render(
      <LocaleProvider locale="en">
        <Surface />
      </LocaleProvider>,
    );
    const text = allText(container);
    expect(text).toContain("Open Boldkast");
    expect(text).not.toMatch(DANISH);
  });

  it("renders Danish by default (no provider) — every existing activity is Danish", () => {
    const { container } = render(<Surface />);
    expect(allText(container)).toContain("Åbn Boldkast");
  });
});
