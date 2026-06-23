import { describe, expect, it } from "vitest";

import {
  ELEMENT_KINDS,
  ELEMENT_REGISTRY,
  isWorkspaceElement,
  type ElementKind,
} from "@/lib/activityElements";

describe("activity element registry (1.1.38 M0)", () => {
  it("every descriptor is internally consistent", () => {
    for (const kind of ELEMENT_KINDS) {
      const descriptor = ELEMENT_REGISTRY[kind];
      expect(descriptor.kind).toBe(kind);
      expect(["workspace", "inline"]).toContain(descriptor.render);
      expect(descriptor.maxItems).toBeGreaterThan(0);
      expect(descriptor.label.length).toBeGreaterThan(0);
    }
  });

  it("checklist is a registered workspace element", () => {
    expect(ELEMENT_REGISTRY.checklist.render).toBe("workspace");
    expect(isWorkspaceElement("checklist")).toBe(true);
  });

  it("table is a registered workspace element (1.1.38 M1)", () => {
    expect(ELEMENT_REGISTRY.table.render).toBe("workspace");
    expect(isWorkspaceElement("table")).toBe(true);
  });

  it("chart is a registered workspace element (1.1.38 M2)", () => {
    expect(ELEMENT_REGISTRY.chart.render).toBe("workspace");
    expect(isWorkspaceElement("chart")).toBe(true);
  });

  it("calculator is a registered workspace element (1.1.38 M3)", () => {
    expect(ELEMENT_REGISTRY.calculator.render).toBe("workspace");
    expect(isWorkspaceElement("calculator")).toBe(true);
  });

  it("ELEMENT_KINDS lists exactly the registry keys", () => {
    expect([...ELEMENT_KINDS].sort()).toEqual(
      (Object.keys(ELEMENT_REGISTRY) as ElementKind[]).sort(),
    );
  });
});
