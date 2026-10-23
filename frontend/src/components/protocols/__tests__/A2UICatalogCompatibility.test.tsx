// Real SDK regression tests: mocked processors cannot detect catalog ID drift.
import { A2uiSurface, basicCatalog } from "@a2ui/react/v0_9";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { A2UIRenderer } from "../A2UIRenderer";
import {
  SurfaceRegistryProvider,
  useSurfaceRegistry,
  useSurfaceState,
  type SurfaceRegistryAPI,
} from "@/providers/SurfaceRegistry";

const LEGACY_ID = "https://a2ui.org/specification/v0_9/basic_catalog.json";

function messages(catalogId: string) {
  return [
    { version: "v0.9", createSurface: { surfaceId: "workspace", catalogId } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "workspace",
        components: [
          { id: "root", component: "Column", children: ["label", "button"] },
          { id: "label", component: "Text", text: "Physics activity" },
          { id: "button", component: "Button", child: "button-label", action: { event: { name: "continue" } } },
          { id: "button-label", component: "Text", text: "Continue investigation" },
        ],
      },
    },
    { version: "v0.9", updateDataModel: { surfaceId: "workspace", value: { trial: 1 } } },
  ];
}

describe.each([LEGACY_ID, basicCatalog.id])("A2UI catalog %s", (catalogId) => {
  it("renders an inline saved surface and sends its button action", async () => {
    const onAction = vi.fn();
    render(<A2UIRenderer messages={messages(catalogId)} onAction={onAction} />);
    expect(await screen.findByText("Physics activity")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue investigation" }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ name: "continue" }));
    expect(screen.queryByTestId("a2ui-fallback")).not.toBeInTheDocument();
  });

  it("restores a workspace surface, its model and the patched URL function", () => {
    let registry!: SurfaceRegistryAPI;
    function Workspace() {
      registry = useSurfaceRegistry();
      const state = useSurfaceState("workspace");
      return state?.surface ? <A2uiSurface surface={state.surface} /> : null;
    }
    render(<SurfaceRegistryProvider><Workspace /></SurfaceRegistryProvider>);
    act(() => registry.appendMessages("workspace", messages(catalogId), "saved-tool-call"));
    expect(screen.getByText("Physics activity")).toBeInTheDocument();
    expect(registry.readA2uiSurfaceState()).toEqual({ workspace: { catalogId, dataModel: { trial: 1 } } });
    expect(registry.getState("workspace")?.surface?.catalog.functions.get("openUrl"))
      .toBe(basicCatalog.functions.get("openUrl"));
  });
});
