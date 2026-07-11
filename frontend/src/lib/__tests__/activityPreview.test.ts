import { describe, expect, it } from "vitest";

import { builderToElementDefs, hasAnyElement, type BuilderElements } from "@/lib/activityPreview";

const EMPTY: BuilderElements = {
  checklist: [],
  table: null,
  chart: null,
  calculator: null,
  note: null,
  solution: null,
  document: null,
  conceptMap: null,
};

describe("builderToElementDefs", () => {
  it("returns empty arrays for empty state", () => {
    const d = builderToElementDefs(EMPTY);
    expect(d).toEqual({
      checklist: [],
      table: [],
      chart: [],
      calculator: [],
      note: [],
      solution: [],
      document: [],
      conceptMap: [],
    });
    expect(hasAnyElement(d)).toBe(false);
  });

  it("includes a document element with its prompt when present (1.1.48)", () => {
    const d = builderToElementDefs({ ...EMPTY, document: { prompt: "Upload your work" } });
    expect(d.document).toEqual([{ id: "document-1", prompt: "Upload your work" }]);
    expect(hasAnyElement(d)).toBe(true);
  });

  it("includes a solution element with its prompt when present (1.1.45 M4)", () => {
    const d = builderToElementDefs({ ...EMPTY, solution: { prompt: "Solve it" } });
    expect(d.solution).toEqual([{ id: "solution-1", prompt: "Solve it" }]);
    expect(hasAnyElement(d)).toBe(true);
  });

  it("assigns positional ids and drops empty checklist rows", () => {
    const d = builderToElementDefs({
      ...EMPTY,
      checklist: [
        { key: 1, label: "  A  " },
        { key: 2, label: "" },
        { key: 3, label: "B" },
      ],
    });
    expect(d.checklist).toEqual([
      { id: "step-1", label: "A" },
      { id: "step-2", label: "B" },
    ]);
    expect(hasAnyElement(d)).toBe(true);
  });

  it("converts a table, dropping unlabelled columns and assigning column ids", () => {
    const d = builderToElementDefs({
      ...EMPTY,
      table: {
        title: "M",
        rows: 4,
        columns: [
          { key: 1, label: "Tid", unit: "s", kind: "number" },
          { key: 2, label: "", unit: "", kind: "number" },
          { key: 3, label: "Pos", unit: "m", kind: "number" },
        ],
      },
    });
    expect(d.table).toEqual([
      {
        id: "table-1",
        title: "M",
        rows: 4,
        columns: [
          { id: "col-1", label: "Tid", unit: "s", kind: "number" },
          { id: "col-2", label: "Pos", unit: "m", kind: "number" },
        ],
      },
    ]);
  });

  it("drops a table with no labelled columns", () => {
    const d = builderToElementDefs({
      ...EMPTY,
      table: { title: "", rows: 3, columns: [{ key: 1, label: "", unit: "", kind: "number" }] },
    });
    expect(d.table).toEqual([]);
  });

  it("converts a chart", () => {
    const d = builderToElementDefs({ ...EMPTY, chart: { title: "G", chartKind: "line" } });
    expect(d.chart).toEqual([{ id: "chart-1", title: "G", chartKind: "line" }]);
  });

  it("converts a calculator, dropping inputs with an invalid variable id", () => {
    const d = builderToElementDefs({
      ...EMPTY,
      calculator: {
        title: "Fart",
        formula: "s / t",
        inputs: [
          { key: 1, id: "s", label: "S", unit: "m" },
          { key: 2, id: "2bad", label: "X", unit: "" }, // invalid identifier → dropped
          { key: 3, id: "t", label: "T", unit: "s" },
        ],
      },
    });
    expect(d.calculator).toEqual([
      {
        id: "calc-1",
        title: "Fart",
        formula: "s / t",
        inputs: [
          { id: "s", label: "S", unit: "m" },
          { id: "t", label: "T", unit: "s" },
        ],
      },
    ]);
  });

  it("normalises the equation form: stores the right-hand side, title falls back to the left", () => {
    const d = builderToElementDefs({
      ...EMPTY,
      calculator: {
        title: "",
        formula: "E = m * c^2",
        inputs: [
          { key: 1, id: "m", label: "Mass", unit: "kg" },
          { key: 2, id: "c", label: "Speed of light", unit: "m/s" },
        ],
      },
    });
    expect(d.calculator[0]).toMatchObject({ title: "E", formula: "m * c^2" });
  });

  it("keeps an explicit title over the equation's left-hand side", () => {
    const d = builderToElementDefs({
      ...EMPTY,
      calculator: {
        title: "Einstein energy",
        formula: "E = m * c^2",
        inputs: [{ key: 1, id: "m", label: "Mass", unit: "kg" }, { key: 2, id: "c", label: "c", unit: "" }],
      },
    });
    expect(d.calculator[0]).toMatchObject({ title: "Einstein energy", formula: "m * c^2" });
  });

  it("drops a calculator with no formula or no valid inputs", () => {
    expect(
      builderToElementDefs({
        ...EMPTY,
        calculator: { title: "", formula: "", inputs: [{ key: 1, id: "s", label: "S", unit: "" }] },
      }).calculator,
    ).toEqual([]);
    expect(
      builderToElementDefs({ ...EMPTY, calculator: { title: "", formula: "s", inputs: [] } }).calculator,
    ).toEqual([]);
  });

  it("converts a note and drops an empty-body note", () => {
    expect(builderToElementDefs({ ...EMPTY, note: { title: "N", body: "  hej  " } }).note).toEqual([
      { id: "note-1", title: "N", body: "hej" },
    ]);
    expect(builderToElementDefs({ ...EMPTY, note: { title: "N", body: "   " } }).note).toEqual([]);
  });
});

describe("builderToElementDefs — conceptMap (CONCEPT-1 M1)", () => {
  const MAP = {
    title: " Projektil ",
    nodes: [
      { key: 1, id: "n-1", label: "Vektorer", dependsOn: [], questions: [] },
      { key: 2, id: "n-2", label: "Trigonometri", dependsOn: [], questions: [] },
      {
        key: 3,
        id: "n-3",
        label: " Projektilbevægelse ",
        dependsOn: ["n-1", "n-2"],
        questions: [
          { key: 4, prompt: " Hvorfor en parabel? ", expectedAnswer: " konstant acceleration " },
          { key: 5, prompt: "   ", expectedAnswer: "dropped — empty prompt" },
        ],
      },
    ],
  };

  it("projects dependsOn into prerequisite edges and trims labels/questions", () => {
    const d = builderToElementDefs({ ...EMPTY, conceptMap: MAP });
    expect(d.conceptMap).toHaveLength(1);
    const m = d.conceptMap[0];
    expect(m.title).toBe("Projektil");
    expect(m.nodes.map((n) => n.label)).toEqual(["Vektorer", "Trigonometri", "Projektilbevægelse"]);
    expect(m.edges).toEqual([
      { from: "n-1", to: "n-3" },
      { from: "n-2", to: "n-3" },
    ]);
    expect(m.nodes[2].checkQuestions).toEqual([
      { id: "q-1", prompt: "Hvorfor en parabel?", expectedAnswer: "konstant acceleration" },
    ]);
  });

  it("drops unlabelled nodes AND their edges (no dangling refs reach the backend)", () => {
    const d = builderToElementDefs({
      ...EMPTY,
      conceptMap: {
        title: "",
        nodes: [
          { key: 1, id: "n-1", label: "  ", dependsOn: [], questions: [] },
          { key: 2, id: "n-2", label: "Kraft", dependsOn: ["n-1"], questions: [] },
        ],
      },
    });
    expect(d.conceptMap[0].nodes.map((n) => n.id)).toEqual(["n-2"]);
    expect(d.conceptMap[0].edges).toEqual([]);
  });

  it("drops the whole map when no node survives; hasAnyElement counts a map", () => {
    expect(
      builderToElementDefs({
        ...EMPTY,
        conceptMap: { title: "T", nodes: [{ key: 1, id: "n-1", label: " ", dependsOn: [], questions: [] }] },
      }).conceptMap,
    ).toEqual([]);
    expect(hasAnyElement(builderToElementDefs({ ...EMPTY, conceptMap: MAP }))).toBe(true);
  });
});
