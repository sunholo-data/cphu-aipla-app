import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useActivityBuilder } from "@/hooks/useActivityBuilder";
import type { ActivityConfigPayload } from "@/lib/teacherApi";
import type { ActivityTemplate } from "@/lib/activityTemplates";

// Characterization tests (1.1.40 M1). These pin the CURRENT behaviour of the
// shared activity-builder hook that drives BOTH the create page and the edit
// page. The load-bearing contract is `elementPayload()` emitting the COMPLETE
// element + sim set: the activity-config POST is a FULL OVERWRITE, so a partial
// payload silently wipes data. The "complete payload" block below is the
// anti-data-loss guard.

// A fully-populated TableEditorValue with two numeric columns.
function fullTable() {
  return {
    title: "Measurements",
    rows: 5,
    columns: [
      { key: 1, label: "Time", unit: "s", kind: "number" as const },
      { key: 2, label: "Position", unit: "m", kind: "number" as const },
    ],
  };
}

function fullCalculator() {
  return {
    title: "Speed",
    formula: "s / t",
    inputs: [
      { key: 1, id: "s", label: "Distance", unit: "m" },
      { key: 2, id: "t", label: "Time", unit: "s" },
    ],
  };
}

describe("useActivityBuilder — initial state", () => {
  it("starts blank for a fresh create", () => {
    const { result } = renderHook(() => useActivityBuilder());
    const b = result.current;
    expect(b.title).toBe("");
    expect(b.teachingGoal).toBe("");
    // Danish is the default language (the pilot is in Denmark).
    expect(b.language).toBe("da");
    expect(b.workbenchType).toBe("none");
    expect(b.checklist).toEqual([]);
    expect(b.table).toBeNull();
    expect(b.chart).toEqual([]);
    expect(b.calculator).toBeNull();
    expect(b.note).toBeNull();
    expect(b.solution).toBeNull();
    expect(b.document).toBeNull();
    expect(b.artefactId).toBeNull();
    expect(b.materials).toEqual([]);
    expect(b.workspaceCount).toBe(0);
  });

  it("empty state's elementPayload is the all-empty slice (no spurious elements)", () => {
    const { result } = renderHook(() => useActivityBuilder());
    expect(result.current.elementPayload()).toEqual({
      artefactId: null,
      checklist: [],
      table: [],
      chart: [],
      calculator: [],
      note: [],
      writing: [],
      solution: [],
      document: [],
      conceptMap: [],
    });
  });
});

describe("useActivityBuilder — setters", () => {
  it("setTitle / setTeachingGoal / setLanguage / setWorkbenchType update state", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => {
      result.current.setTitle("Projectile motion");
      result.current.setTeachingGoal("Discover component independence");
      result.current.setLanguage("en");
      result.current.setWorkbenchType("app");
    });
    expect(result.current.title).toBe("Projectile motion");
    expect(result.current.teachingGoal).toBe("Discover component independence");
    expect(result.current.language).toBe("en");
    expect(result.current.workbenchType).toBe("app");
  });

  it("setMaterials replaces the materials array", () => {
    const { result } = renderHook(() => useActivityBuilder());
    const mats = [{ curriculumId: "doc-1", title: "Kapitel 3" }] as never;
    act(() => result.current.setMaterials(mats));
    expect(result.current.materials).toEqual(mats);
  });
});

describe("useActivityBuilder — checklist transitions", () => {
  it("addChecklistItem appends a blank row with a unique stable key", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.addChecklistItem());
    act(() => result.current.addChecklistItem());
    expect(result.current.checklist).toHaveLength(2);
    expect(result.current.checklist[0].label).toBe("");
    expect(result.current.checklist[1].label).toBe("");
    // Keys are unique and stable (used as React keys).
    const keys = result.current.checklist.map((c) => c.key);
    expect(new Set(keys).size).toBe(2);
  });

  it("addChecklistItems appends a labelled batch (the co-pilot Apply target)", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.addChecklistItems(["Identify system", "Draw diagram", "Apply law"]));
    expect(result.current.checklist.map((c) => c.label)).toEqual([
      "Identify system",
      "Draw diagram",
      "Apply law",
    ]);
    // Keys remain unique across the batch.
    expect(new Set(result.current.checklist.map((c) => c.key)).size).toBe(3);
  });

  it("setChecklistLabel updates one row by key, leaving others untouched", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.addChecklistItems(["a", "b"]));
    const targetKey = result.current.checklist[1].key;
    act(() => result.current.setChecklistLabel(targetKey, "b-edited"));
    expect(result.current.checklist.map((c) => c.label)).toEqual(["a", "b-edited"]);
  });

  it("removeChecklistItem drops the row with the matching key", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.addChecklistItems(["a", "b", "c"]));
    const midKey = result.current.checklist[1].key;
    act(() => result.current.removeChecklistItem(midKey));
    expect(result.current.checklist.map((c) => c.label)).toEqual(["a", "c"]);
  });

  it("a checklist contributes 1 to workspaceCount once it has at least one row", () => {
    const { result } = renderHook(() => useActivityBuilder());
    expect(result.current.workspaceCount).toBe(0);
    act(() => result.current.addChecklistItem());
    expect(result.current.workspaceCount).toBe(1);
  });
});

describe("useActivityBuilder — element add / clear transitions", () => {
  it("setTable / setChart / setCalculator / setNote / setSolution / setDocument toggle each element on then off", () => {
    const { result } = renderHook(() => useActivityBuilder());

    act(() => {
      result.current.setTable(fullTable());
      result.current.setChart([{ id: "chart-1", title: "Graph", chartKind: "line" }]);
      result.current.setCalculator(fullCalculator());
      result.current.setNote({ title: "Hint", body: "Remember the system" });
      result.current.setSolution({ prompt: "Write your solution" });
      result.current.setDocument({ prompt: "Upload your worksheet" });
    });

    expect(result.current.table).not.toBeNull();
    expect(result.current.chart).toHaveLength(1);
    expect(result.current.calculator).not.toBeNull();
    expect(result.current.note).not.toBeNull();
    expect(result.current.solution).not.toBeNull();
    expect(result.current.document).not.toBeNull();

    act(() => {
      result.current.setTable(null);
      result.current.setChart([]);
      result.current.setCalculator(null);
      result.current.setNote(null);
      result.current.setSolution(null);
      result.current.setDocument(null);
    });

    expect(result.current.table).toBeNull();
    expect(result.current.chart).toEqual([]);
    expect(result.current.calculator).toBeNull();
    expect(result.current.note).toBeNull();
    expect(result.current.solution).toBeNull();
    expect(result.current.document).toBeNull();
  });

  it("setArtefactId attaching a sim contributes 1 to workspaceCount", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.setArtefactId("boldkast"));
    expect(result.current.artefactId).toBe("boldkast");
    expect(result.current.workspaceCount).toBe(1);
  });

  it("workspaceCount sums sim + each configured element type", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => {
      result.current.setArtefactId("boldkast"); // +1
      result.current.addChecklistItem(); // +1
      result.current.setTable(fullTable()); // +1
      result.current.setChart([{ id: "chart-1", title: "G", chartKind: "line" }]); // +1
      result.current.setCalculator(fullCalculator()); // +1
      result.current.setNote({ title: "N", body: "body" }); // +1
      result.current.setSolution({ prompt: "p" }); // +1
      result.current.setDocument({ prompt: "d" }); // +1
    });
    expect(result.current.workspaceCount).toBe(8);
  });
});

describe("useActivityBuilder — elementPayload() emits the COMPLETE set (anti-data-loss)", () => {
  // This is the load-bearing assertion. The activity-config POST is a full
  // overwrite; if elementPayload() ever returns a PARTIAL slice, the missing
  // elements are silently wiped from the saved activity. These tests pin that
  // every configured element type AND the sim id appear in one payload, with
  // the normalised (builderToElementDefs) shape the renderers/save consume.

  function buildAll() {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => {
      result.current.setArtefactId("boldkast");
      result.current.addChecklistItems(["Identify the system", "Apply conservation"]);
      result.current.setTable(fullTable());
      result.current.setChart([{ id: "chart-1", title: "v-t graph", chartKind: "line" }]);
      result.current.setCalculator(fullCalculator());
      result.current.setNote({ title: "Reference", body: "E = mc^2" });
      result.current.setSolution({ prompt: "Explain your reasoning" });
      result.current.setDocument({ prompt: "Upload your diagram" });
    });
    return result;
  }

  it("contains ALL element types plus the sim id in a single payload", () => {
    const result = buildAll();
    const p = result.current.elementPayload();

    // The sim id is carried (so saving never detaches a hosted sim).
    expect(p.artefactId).toBe("boldkast");

    // EVERY element type is present and non-empty — none dropped on save.
    expect(p.checklist.length).toBe(2);
    expect(p.table.length).toBe(1);
    expect(p.chart.length).toBe(1);
    expect(p.calculator.length).toBe(1);
    expect(p.note.length).toBe(1);
    expect(p.solution.length).toBe(1);
    expect(p.document.length).toBe(1);

    // The keys of the payload object are exactly the element slice + artefactId
    // (no field silently missing, none unexpected).
    expect(Object.keys(p).sort()).toEqual(
      [
        "artefactId",
        "calculator",
        "chart",
        "checklist",
        "conceptMap",
        "document",
        "note",
        "solution",
        "table",
        "writing",
      ].sort(),
    );
  });

  it("emits each element in its normalised renderer shape with positional ids", () => {
    const result = buildAll();
    const p = result.current.elementPayload();

    expect(p.checklist).toEqual([
      { id: "step-1", label: "Identify the system" },
      { id: "step-2", label: "Apply conservation" },
    ]);
    expect(p.table).toEqual([
      {
        id: "table-1",
        title: "Measurements",
        rows: 5,
        columns: [
          { id: "col-1", label: "Time", unit: "s", kind: "number" },
          { id: "col-2", label: "Position", unit: "m", kind: "number" },
        ],
      },
    ]);
    expect(p.chart).toEqual([
      { id: "chart-1", title: "v-t graph", chartKind: "line", tableId: null, xColumn: null, yColumn: null },
    ]);
    expect(p.calculator).toEqual([
      {
        id: "calc-1",
        title: "Speed",
        formula: "s / t",
        inputs: [
          { id: "s", label: "Distance", unit: "m" },
          { id: "t", label: "Time", unit: "s" },
        ],
      },
    ]);
    expect(p.note).toEqual([{ id: "note-1", title: "Reference", body: "E = mc^2" }]);
    expect(p.solution).toEqual([{ id: "solution-1", prompt: "Explain your reasoning" }]);
    expect(p.document).toEqual([{ id: "document-1", prompt: "Upload your diagram" }]);
  });

  it("removing one element does not disturb the others in the payload", () => {
    const result = buildAll();
    act(() => result.current.setChart([]));
    const p = result.current.elementPayload();
    // Only the chart is gone; everything else still ships.
    expect(p.chart).toEqual([]);
    expect(p.checklist.length).toBe(2);
    expect(p.table.length).toBe(1);
    expect(p.calculator.length).toBe(1);
    expect(p.note.length).toBe(1);
    expect(p.solution.length).toBe(1);
    expect(p.document.length).toBe(1);
    expect(p.artefactId).toBe("boldkast");
  });

  it("a present-but-empty solution/document still ships (the student supplies content)", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => {
      result.current.setSolution({ prompt: "" });
      result.current.setDocument({ prompt: "" });
    });
    const p = result.current.elementPayload();
    // builderToElementDefs ships a present solution/document with an empty prompt.
    expect(p.solution).toEqual([{ id: "solution-1", prompt: "" }]);
    expect(p.document).toEqual([{ id: "document-1", prompt: "" }]);
  });
});

describe("useActivityBuilder — applyTemplate", () => {
  const TEMPLATE: ActivityTemplate = {
    id: "tmpl-1",
    name: "Energy conservation",
    summary: "A conservation-of-energy lab",
    title: "Energy lab",
    teachingGoal: "Discover energy conservation",
    language: "en",
    checklist: ["Set up", "Measure", "Conclude"],
    table: {
      title: "Run data",
      rows: 3,
      columns: [
        { label: "Height", unit: "m", kind: "number" },
        { label: "Speed", unit: "m/s", kind: "number" },
      ],
    },
    chart: { title: "h-v graph", chartKind: "scatter" },
    calculator: {
      title: "KE",
      formula: "0.5 * m * v^2",
      inputs: [
        { id: "m", label: "Mass", unit: "kg" },
        { id: "v", label: "Speed", unit: "m/s" },
      ],
    },
    note: { title: "Reminder", body: "Energy is conserved" },
    solution: { prompt: "Explain conservation" },
    document: { prompt: "Upload your plot" },
    artefactId: "boldkast",
  } as ActivityTemplate;

  it("fills every field from a starter template", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.applyTemplate(TEMPLATE));
    const b = result.current;
    expect(b.title).toBe("Energy lab");
    expect(b.teachingGoal).toBe("Discover energy conservation");
    expect(b.language).toBe("en");
    expect(b.checklist.map((c) => c.label)).toEqual(["Set up", "Measure", "Conclude"]);
    expect(b.table?.title).toBe("Run data");
    expect(b.table?.columns.map((c) => c.label)).toEqual(["Height", "Speed"]);
    expect(b.chart).toEqual([{ id: "chart-1", title: "h-v graph", chartKind: "scatter" }]);
    expect(b.calculator?.formula).toBe("0.5 * m * v^2");
    expect(b.calculator?.inputs.map((i) => i.id)).toEqual(["m", "v"]);
    expect(b.note).toEqual({ title: "Reminder", body: "Energy is conserved" });
    expect(b.solution).toEqual({ prompt: "Explain conservation" });
    expect(b.document).toEqual({ prompt: "Upload your plot" });
    expect(b.artefactId).toBe("boldkast");
    // applyTemplate always forces workbenchType back to "none".
    expect(b.workbenchType).toBe("none");
  });

  it("a template's elementPayload round-trips the full element set", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.applyTemplate(TEMPLATE));
    const p = result.current.elementPayload();
    expect(p.artefactId).toBe("boldkast");
    expect(p.checklist.length).toBe(3);
    expect(p.table.length).toBe(1);
    expect(p.chart.length).toBe(1);
    expect(p.calculator.length).toBe(1);
    expect(p.note.length).toBe(1);
    expect(p.solution.length).toBe(1);
    expect(p.document.length).toBe(1);
  });

  it("fills the concept map from a template and round-trips its edges", () => {
    const CM_TEMPLATE = {
      ...TEMPLATE,
      id: "tmpl-cm",
      conceptMap: {
        title: "Kinematics",
        nodes: [
          { id: "a", label: "A", questions: [{ prompt: "why A?", expectedAnswer: "because" }] },
          { id: "b", label: "B", dependsOn: ["a"] },
        ],
      },
    } as ActivityTemplate;
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.applyTemplate(CM_TEMPLATE));
    const cm = result.current.conceptMap;
    expect(cm?.title).toBe("Kinematics");
    expect(cm?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(cm?.nodes[1].dependsOn).toEqual(["a"]);
    expect(cm?.nodes[0].questions[0].expectedAnswer).toBe("because");
    // The dependsOn projection becomes a stored prerequisite edge (from → to).
    const p = result.current.elementPayload();
    expect(p.conceptMap.length).toBe(1);
    expect(p.conceptMap[0].edges).toEqual([{ from: "a", to: "b" }]);
  });

  it("clears the concept map when a template has none", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.setConceptMap({ title: "old", nodes: [] }));
    act(() => result.current.applyTemplate(TEMPLATE)); // TEMPLATE has no conceptMap
    expect(result.current.conceptMap).toBeNull();
  });

  it("a template with sparse (null) elements clears the absent ones", () => {
    const SPARSE = {
      id: "tmpl-2",
      name: "Chat only",
      summary: "Pure dialogue",
      title: "Chat",
      teachingGoal: "Talk it through",
      language: "da",
      checklist: [],
    } as unknown as ActivityTemplate;
    const { result } = renderHook(() => useActivityBuilder());
    // Pre-populate, then apply a sparse template: the absent fields must clear.
    act(() => {
      result.current.setTable(fullTable());
      result.current.setArtefactId("boldkast");
    });
    act(() => result.current.applyTemplate(SPARSE));
    expect(result.current.table).toBeNull();
    expect(result.current.chart).toEqual([]);
    expect(result.current.calculator).toBeNull();
    expect(result.current.note).toBeNull();
    expect(result.current.solution).toBeNull();
    expect(result.current.document).toBeNull();
    expect(result.current.artefactId).toBeNull();
    expect(result.current.checklist).toEqual([]);
  });
});

describe("useActivityBuilder — hydrate (load an existing activity)", () => {
  // Built from the [0]-array convention the GET serialises and hydrate reads.
  const SAVED = {
    activityId: "act-1",
    classId: "cls-1",
    teacherUid: "uid-1",
    title: "Saved activity",
    teachingGoal: "Saved goal",
    language: "en",
    difficulty: "intro",
    pairedWorkbench: null,
    workbenchType: "none",
    artefactId: "boldkast",
    materials: [{ curriculumId: "doc-1", title: "Kapitel 3" }],
    checklist: [{ label: "Step one" }, { label: "Step two" }],
    table: [
      {
        title: "Saved table",
        rows: 4,
        columns: [
          { label: "Tid", unit: "s", kind: "number" },
          { label: "Pos", unit: "m", kind: "number" },
        ],
      },
    ],
    chart: [{ title: "Saved chart", chartKind: "scatter" }],
    calculator: [
      {
        title: "Saved calc",
        formula: "s / t",
        inputs: [
          { id: "s", label: "S", unit: "m" },
          { id: "t", label: "T", unit: "s" },
        ],
      },
    ],
    note: [{ title: "Saved note", body: "body text" }],
    solution: [{ prompt: "Saved solution prompt" }],
    document: [{ prompt: "Saved document prompt" }],
  } as unknown as ActivityConfigPayload;

  it("loads title/goal/language/sim/materials from a saved config", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.hydrate(SAVED));
    const b = result.current;
    expect(b.title).toBe("Saved activity");
    expect(b.teachingGoal).toBe("Saved goal");
    expect(b.language).toBe("en");
    expect(b.workbenchType).toBe("none");
    expect(b.artefactId).toBe("boldkast");
    expect(b.materials).toEqual([{ curriculumId: "doc-1", title: "Kapitel 3" }]);
  });

  it("reads each element array's [0] into the single editor value", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.hydrate(SAVED));
    const b = result.current;
    expect(b.checklist.map((c) => c.label)).toEqual(["Step one", "Step two"]);
    expect(b.table?.title).toBe("Saved table");
    expect(b.table?.columns.map((c) => c.label)).toEqual(["Tid", "Pos"]);
    // 1.1.64 — hydrate loads EVERY chart, with its axis binding.
    expect(b.chart).toEqual([
      { id: "chart-1", title: "Saved chart", chartKind: "scatter", tableId: null, xColumn: null, yColumn: null },
    ]);
    expect(b.calculator?.formula).toBe("s / t");
    expect(b.calculator?.inputs.map((i) => i.id)).toEqual(["s", "t"]);
    expect(b.note).toEqual({ title: "Saved note", body: "body text" });
    expect(b.solution).toEqual({ prompt: "Saved solution prompt" });
    expect(b.document).toEqual({ prompt: "Saved document prompt" });
  });

  it("hydrate → elementPayload round-trips the saved element set unchanged in shape", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.hydrate(SAVED));
    const p = result.current.elementPayload();
    expect(p.artefactId).toBe("boldkast");
    expect(p.checklist).toEqual([
      { id: "step-1", label: "Step one" },
      { id: "step-2", label: "Step two" },
    ]);
    expect(p.table.length).toBe(1);
    expect(p.chart.length).toBe(1);
    expect(p.calculator.length).toBe(1);
    expect(p.note.length).toBe(1);
    expect(p.solution.length).toBe(1);
    expect(p.document.length).toBe(1);
  });

  it("hydrating an empty config resets everything to blank (the 'Create another' reset)", () => {
    const { result } = renderHook(() => useActivityBuilder());
    // First populate, then hydrate({}) like the create page's "Create another".
    act(() => {
      result.current.setTitle("dirty");
      result.current.setTable(fullTable());
      result.current.setArtefactId("boldkast");
      result.current.addChecklistItem();
    });
    act(() => result.current.hydrate({} as ActivityConfigPayload));
    const b = result.current;
    expect(b.title).toBe("");
    expect(b.teachingGoal).toBe("");
    // language resets to the default like every other field on an empty hydrate.
    expect(b.language).toBe("da");
    expect(b.workbenchType).toBe("none");
    expect(b.artefactId).toBeNull();
    expect(b.materials).toEqual([]);
    expect(b.checklist).toEqual([]);
    expect(b.table).toBeNull();
    expect(b.chart).toEqual([]);
    expect(b.calculator).toBeNull();
    expect(b.note).toBeNull();
    expect(b.solution).toBeNull();
    expect(b.document).toBeNull();
  });
});

describe("useActivityBuilder — toSavePayload + isFormValid (F5)", () => {
  it("isFormValid: requires BOTH a non-empty title AND goal (whitespace-only counts as empty)", () => {
    const { result } = renderHook(() => useActivityBuilder());
    expect(result.current.isFormValid()).toBe(false);
    act(() => {
      result.current.setTitle("   ");
      result.current.setTeachingGoal("   ");
    });
    expect(result.current.isFormValid()).toBe(false); // whitespace-only is empty
    act(() => result.current.setTitle("Projectile motion"));
    expect(result.current.isFormValid()).toBe(false); // goal still blank
    act(() => result.current.setTeachingGoal("Understand v = u + at"));
    expect(result.current.isFormValid()).toBe(true);
  });

  it("toSavePayload: trims title + goal and carries the COMPLETE element slice (anti-data-loss)", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => {
      result.current.setTitle("  Projectile  ");
      result.current.setTeachingGoal("  Understand g  ");
      result.current.setLanguage("en");
      result.current.setArtefactId("boldkast");
      result.current.setTable(fullTable());
      result.current.setCalculator(fullCalculator());
      result.current.addChecklistItems(["Step one"]);
    });
    const payload = result.current.toSavePayload();
    expect(payload.title).toBe("Projectile"); // trimmed
    expect(payload.teachingGoal).toBe("Understand g"); // trimmed (edit page used to skip this)
    expect(payload.language).toBe("en");
    expect(payload.workbenchType).toBe("none");
    // The element slice is byte-for-byte what elementPayload emits...
    expect(payload).toMatchObject(result.current.elementPayload());
    // ...and complete: artefact + every configured element present.
    expect(payload.artefactId).toBe("boldkast");
    expect(payload.table).toHaveLength(1);
    expect(payload.calculator).toHaveLength(1);
    expect(payload.checklist).toHaveLength(1);
    expect(payload.materials).toEqual([]);
  });

  it("toSavePayload key set = the 10 element-slice keys + the 5 wrapper fields (one source for both pages)", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => {
      result.current.setTitle("T");
      result.current.setTeachingGoal("G");
    });
    expect(Object.keys(result.current.toSavePayload()).sort()).toEqual(
      [
        // element slice (from elementPayload)
        "artefactId",
        "checklist",
        "table",
        "chart",
        "calculator",
        "note",
        "writing",
        "solution",
        "document",
        "conceptMap",
        // wrapper fields
        "title",
        "teachingGoal",
        "language",
        "workbenchType",
        "materials",
        // 1.1.61 facets — see the anti-wipe test below for why these belong here
        "tags",
        "subject",
        "level",
      ].sort(),
    );
  });
});

describe("useActivityBuilder — facets survive a save (1.1.61 anti-wipe)", () => {
  // The activity POST/PATCH is a FULL OVERWRITE. A teacher files an activity
  // from the LIBRARY (subject/level/tags on the row), then opens the builder and
  // saves — if the builder does not carry those three fields, the save clears
  // what they just set, from a screen that never showed it. That is the same
  // footgun that already cost the calculator and the table their data.
  //
  // Inherited facets are deliberately NOT here: they belong to the cited
  // documents and are never written back.

  it("hydrate → toSavePayload round-trips tags/subject/level unchanged", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() =>
      result.current.hydrate({
        title: "Filed activity",
        teachingGoal: "G",
        tags: ["lab", "exam-prep"],
        subject: "Fysik",
        level: "B",
      } as ActivityConfigPayload),
    );
    const payload = result.current.toSavePayload();
    expect(payload.tags).toEqual(["lab", "exam-prep"]);
    expect(payload.subject).toBe("Fysik");
    expect(payload.level).toBe("B");
  });

  it("an activity with no facets round-trips as empty/null, not undefined", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.hydrate({ title: "T", teachingGoal: "G" } as ActivityConfigPayload));
    const payload = result.current.toSavePayload();
    expect(payload.tags).toEqual([]);
    expect(payload.subject).toBeNull();
    expect(payload.level).toBeNull();
  });

  it("does NOT carry inherited facets back into the save payload", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() =>
      result.current.hydrate({
        title: "T",
        teachingGoal: "G",
        tags: ["min-egen"],
        inheritedTags: ["mekanik"],
        inheritedSubjects: ["Fysik"],
        inheritedLevels: ["A"],
      } as ActivityConfigPayload),
    );
    const payload = result.current.toSavePayload();
    expect(payload.tags).toEqual(["min-egen"]);
    expect(payload).not.toHaveProperty("inheritedTags");
    // Inheriting Fysik must not silently become an OWN subject on the next save.
    expect(payload.subject).toBeNull();
  });

  it("an empty hydrate clears facets like every other field", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() =>
      result.current.hydrate({ tags: ["lab"], subject: "Fysik", level: "A" } as ActivityConfigPayload),
    );
    act(() => result.current.hydrate({} as ActivityConfigPayload));
    const payload = result.current.toSavePayload();
    expect(payload.tags).toEqual([]);
    expect(payload.subject).toBeNull();
    expect(payload.level).toBeNull();
  });
});

/**
 * 1.1.64 — several charts must survive a save.
 *
 * The activity POST is a FULL OVERWRITE (memory
 * `reference-activity-config-full-overwrite`): a payload missing a chart wipes
 * it. Making charts a list re-opens that footgun in a new place — hydrate
 * reading only `chart[0]` while the payload writes the whole array would
 * silently delete every chart but the first on the next save.
 */
describe("useActivityBuilder — multi-chart round-trip (1.1.64)", () => {
  it("elementPayload() emits EVERY chart, with its axis binding", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() =>
      result.current.setChart([
        { id: "chart-1", title: "h mod t", chartKind: "scatter", tableId: "table-1", xColumn: "col-2", yColumn: "col-1" },
        { id: "chart-2", title: "v mod t", chartKind: "line", tableId: "table-1", xColumn: "col-2", yColumn: "col-3" },
      ]),
    );
    const p = result.current.elementPayload();
    expect(p.chart).toHaveLength(2);
    expect(p.chart[1]).toMatchObject({ title: "v mod t", xColumn: "col-2", yColumn: "col-3" });
  });

  it("hydrate → elementPayload round-trips several charts unchanged", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() =>
      result.current.hydrate({
        activityId: "act-1",
        classId: "cls-1",
        teacherUid: "uid-1",
        title: "T",
        teachingGoal: "G",
        language: "da",
        difficulty: "standard",
        workbenchType: "none",
        chart: [
          { id: "chart-1", title: "A", chartKind: "scatter", tableId: "table-1", xColumn: "col-1", yColumn: "col-2" },
          { id: "chart-2", title: "B", chartKind: "bar", tableId: "table-1", xColumn: "col-1", yColumn: "col-3" },
        ],
      } as never),
    );
    expect(result.current.chart).toHaveLength(2);
    const p = result.current.elementPayload();
    expect(p.chart.map((c) => c.title)).toEqual(["A", "B"]);
    expect(p.chart.map((c) => c.yColumn)).toEqual(["col-2", "col-3"]);
  });
});

/**
 * 1.1.64 — the positional-id hazard.
 *
 * Column ids are minted POSITIONALLY (`col-{n}` over the label-bearing
 * columns, see `tableDefs`). Deleting a column therefore SHIFTS every later
 * id, so a chart bound to `col-3` would silently start plotting what used to
 * be `col-4`. The render-side fallback cannot catch that — the id still
 * resolves — which makes it the one genuinely bad outcome this feature can
 * produce. `setTable` reconciles instead: a binding whose column label changed
 * under it is cleared, dropping the chart back to auto-bind (which renders
 * with a visible note).
 */
describe("useActivityBuilder — chart bindings survive table edits (1.1.64)", () => {
  const table = (labels: string[]) => ({
    title: "T",
    rows: 5,
    columns: labels.map((label, i) => ({ key: i + 1, label, unit: "", kind: "number" as const })),
  });

  it("keeps bindings when an unrelated column is renamed after them", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.setTable(table(["h", "t", "v"])));
    act(() => result.current.setChart([{ id: "c1", title: "", chartKind: "scatter", xColumn: "col-1", yColumn: "col-2" }]));
    // Rename the THIRD column — col-1 and col-2 still mean h and t.
    act(() => result.current.setTable(table(["h", "t", "hastighed"])));
    expect(result.current.chart[0]).toMatchObject({ xColumn: "col-1", yColumn: "col-2" });
  });

  it("CLEARS a binding whose column was deleted, rather than shifting it onto another variable", () => {
    const { result } = renderHook(() => useActivityBuilder());
    act(() => result.current.setTable(table(["h", "t", "v"])));
    act(() => result.current.setChart([{ id: "c1", title: "", chartKind: "scatter", xColumn: "col-1", yColumn: "col-3" }]));
    // Delete the FIRST column: what was col-3 ("v") becomes col-2. Left alone,
    // yColumn "col-3" would now point at nothing and xColumn "col-1" would
    // silently mean "t" instead of "h".
    act(() => result.current.setTable(table(["t", "v"])));
    expect(result.current.chart[0].xColumn).toBeNull();
    expect(result.current.chart[0].yColumn).toBeNull();
  });
});
