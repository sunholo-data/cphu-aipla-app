// CONCEPT-1 M2 — the Apply half of the co-pilot's concept-map diff.

import { describe, expect, it } from "vitest";

import type { ConceptMapEditorValue } from "@/components/teacher/ConceptMapEditor";

import { applyConceptMapDiff } from "../applyConceptMapDiff";

function keyMinter() {
  let k = 100;
  return () => k++;
}

const CURRENT: ConceptMapEditorValue = {
  title: "Kast",
  nodes: [
    { key: 1, id: "vektorer", label: "Vektorer", dependsOn: [], questions: [] },
    { key: 2, id: "projektil", label: "Projektil", dependsOn: ["vektorer"], questions: [] },
  ],
};

describe("applyConceptMapDiff", () => {
  it("adds nodes with questions and projects edges onto dependsOn", () => {
    const next = applyConceptMapDiff(
      CURRENT,
      {
        addNodes: [
          { id: "trig", label: "Trigonometri", checkQuestions: [{ prompt: "sin?", expectedAnswer: "modstående/hyp" }] },
        ],
        addEdges: [{ from: "trig", to: "projektil" }],
      },
      keyMinter(),
    );
    expect(next.nodes.map((n) => n.id)).toEqual(["vektorer", "projektil", "trig"]);
    expect(next.nodes[1].dependsOn).toEqual(["vektorer", "trig"]);
    expect(next.nodes[2].questions).toEqual([{ key: 101, prompt: "sin?", expectedAnswer: "modstående/hyp" }]);
  });

  it("removes a node together with dependsOn refs to it", () => {
    const next = applyConceptMapDiff(CURRENT, { removeNodes: ["vektorer"] }, keyMinter());
    expect(next.nodes.map((n) => n.id)).toEqual(["projektil"]);
    expect(next.nodes[0].dependsOn).toEqual([]);
  });

  it("relabels, replaces questions, and sets the title", () => {
    const next = applyConceptMapDiff(
      CURRENT,
      {
        title: "Projektilbevægelse",
        relabel: [{ id: "projektil", label: "Projektilbevægelse" }],
        setCheckQuestions: [{ nodeId: "vektorer", questions: [{ prompt: "Dekomponér v ved 30°?" }] }],
      },
      keyMinter(),
    );
    expect(next.title).toBe("Projektilbevægelse");
    expect(next.nodes[1].label).toBe("Projektilbevægelse");
    expect(next.nodes[0].questions[0]).toMatchObject({ prompt: "Dekomponér v ved 30°?", expectedAnswer: "" });
  });

  it("skips ops referencing locally-missing ids and duplicate adds (drift tolerance)", () => {
    const next = applyConceptMapDiff(
      CURRENT,
      {
        addNodes: [{ id: "vektorer", label: "Vektorer igen" }],
        addEdges: [{ from: "ghost", to: "projektil" }],
        relabel: [{ id: "ghost", label: "X" }],
        removeNodes: ["ghost"],
      },
      keyMinter(),
    );
    expect(next.nodes).toHaveLength(2);
    expect(next.nodes[0].label).toBe("Vektorer");
    expect(next.nodes[1].dependsOn).toEqual(["vektorer"]);
  });

  it("starts from an empty draft (null current)", () => {
    const next = applyConceptMapDiff(
      null,
      { addNodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], addEdges: [{ from: "a", to: "b" }] },
      keyMinter(),
    );
    expect(next.title).toBe("");
    expect(next.nodes[1].dependsOn).toEqual(["a"]);
  });
});
