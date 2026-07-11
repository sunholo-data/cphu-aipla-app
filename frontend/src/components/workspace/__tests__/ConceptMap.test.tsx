// CONCEPT-1 M1 — living concept map: layout, student view, teacher editor.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConceptMapEditor, wouldCreateCycle } from "@/components/teacher/ConceptMapEditor";

import { conceptLayers } from "../ConceptMapGraph";
import { ConceptMapView } from "../ConceptMapView";

const NODES = [
  { id: "vektorer", label: "Vektorer" },
  { id: "trig", label: "Trigonometri" },
  { id: "projektil", label: "Projektilbevægelse" },
];
const EDGES = [
  { from: "vektorer", to: "projektil" },
  { from: "trig", to: "projektil" },
];

describe("conceptLayers (topological layout)", () => {
  it("places prerequisites left of their dependents", () => {
    const layers = conceptLayers(NODES, EDGES);
    expect(layers.get("vektorer")).toBe(0);
    expect(layers.get("trig")).toBe(0);
    expect(layers.get("projektil")).toBe(1);
  });

  it("chains layers along the longest path", () => {
    const layers = conceptLayers(
      [{ id: "a", label: "a" }, { id: "b", label: "b" }, { id: "c", label: "c" }],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "a", to: "c" },
      ],
    );
    expect(layers.get("c")).toBe(2);
  });
});

describe("ConceptMapView (student read-only)", () => {
  const MAP = [{ id: "m1", title: "Kastebevægelse", nodes: NODES, edges: EDGES }];

  it("renders the title, every node, and the legend", () => {
    render(<ConceptMapView conceptMap={MAP} />);
    expect(screen.getByText("Kastebevægelse")).toBeInTheDocument();
    expect(screen.getByTestId("concept-node-projektil")).toBeInTheDocument();
    expect(screen.getByText("forstået")).toBeInTheDocument();
  });

  it("lights up demonstrated nodes via nodeStates", () => {
    render(<ConceptMapView conceptMap={MAP} nodeStates={{ vektorer: "demonstrated", trig: "partial" }} />);
    expect(screen.getByTestId("concept-node-vektorer")).toHaveAttribute("data-status", "demonstrated");
    expect(screen.getByTestId("concept-node-trig")).toHaveAttribute("data-status", "partial");
    expect(screen.getByTestId("concept-node-projektil")).toHaveAttribute("data-status", "not_yet");
  });

  it("self-hides with no map or no nodes", () => {
    const { container } = render(<ConceptMapView conceptMap={[]} />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(
      <ConceptMapView conceptMap={[{ id: "m1", nodes: [], edges: [] }]} />,
    );
    expect(c2).toBeEmptyDOMElement();
  });
});

describe("wouldCreateCycle", () => {
  const ROWS = [
    { key: 1, id: "a", label: "A", dependsOn: [], questions: [] },
    { key: 2, id: "b", label: "B", dependsOn: ["a"], questions: [] },
    { key: 3, id: "c", label: "C", dependsOn: ["b"], questions: [] },
  ];

  it("blocks self and transitive back-edges, allows forward edges", () => {
    expect(wouldCreateCycle(ROWS, "a", "a")).toBe(true);
    // a ← c would close a→b→c→a
    expect(wouldCreateCycle(ROWS, "a", "c")).toBe(true);
    // c already depends on b; c → also-on-a is fine
    expect(wouldCreateCycle(ROWS, "c", "a")).toBe(false);
  });
});

describe("ConceptMapEditor (teacher list mode)", () => {
  function setup(value: Parameters<typeof ConceptMapEditor>[0]["value"] = { title: "", nodes: [] }) {
    const onChange = vi.fn();
    let key = 100;
    render(<ConceptMapEditor value={value} onChange={onChange} nextKey={() => key++} />);
    return onChange;
  }

  it("starts from the empty state and adds a map", () => {
    const onChange = vi.fn();
    render(<ConceptMapEditor value={null} onChange={onChange} nextKey={() => 1} />);
    fireEvent.click(screen.getByRole("button", { name: /add concept map/i }));
    expect(onChange).toHaveBeenCalledWith({ title: "", nodes: [] });
  });

  it("adds a concept with a minted stable id", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("button", { name: /add concept/i }));
    const next = onChange.mock.calls[0][0];
    expect(next.nodes).toHaveLength(1);
    expect(next.nodes[0].id).toBe("node-100");
  });

  it("disables a builds-on chip that would create a cycle", () => {
    setup({
      title: "",
      nodes: [
        { key: 1, id: "a", label: "A", dependsOn: [], questions: [] },
        { key: 2, id: "b", label: "B", dependsOn: ["a"], questions: [] },
      ],
    });
    // In A's row, the chip for B must be disabled (B already builds on A).
    const chips = screen.getAllByRole("button", { name: "B" });
    expect(chips.some((c) => (c as HTMLButtonElement).disabled)).toBe(true);
  });

  it("adds a check question to a concept", () => {
    const onChange = setup({
      title: "",
      nodes: [{ key: 1, id: "a", label: "A", dependsOn: [], questions: [] }],
    });
    fireEvent.click(screen.getByRole("button", { name: /\+ check question/i }));
    const next = onChange.mock.calls[0][0];
    expect(next.nodes[0].questions).toEqual([{ key: 100, prompt: "", expectedAnswer: "" }]);
  });
});
