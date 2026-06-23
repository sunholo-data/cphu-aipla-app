import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
}));
import { fetchWithAuth } from "@/lib/apiClient";

// Capture StaticArtefactFrame's props so we can drive its onUpdateModelContext.
const { frameSpy } = vi.hoisted(() => ({ frameSpy: vi.fn() }));
vi.mock("../StaticArtefactFrame", () => ({
  StaticArtefactFrame: (props: Record<string, unknown>) => {
    frameSpy(props);
    return <div data-testid="static-frame" />;
  },
}));

import { GenericArtefactFrame, type ActivityArtefact } from "../GenericArtefactFrame";

const ARTEFACT: ActivityArtefact = { id: "boldkast", displayName: "Boldkast", artefactPath: "boldkast/v1" };

function onUpdate(): (sc: Record<string, unknown>) => void {
  return frameSpy.mock.calls[0][0].onUpdateModelContext as (sc: Record<string, unknown>) => void;
}

describe("GenericArtefactFrame", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockClear();
    frameSpy.mockClear();
  });

  it("mounts the artefact by its catalogue path", () => {
    render(<GenericArtefactFrame sandboxOrigin="https://sandbox" artefact={ARTEFACT} sessionId="s1" />);
    expect(frameSpy).toHaveBeenCalledWith(
      expect.objectContaining({ artefactPath: "boldkast/v1", title: "Boldkast" }),
    );
  });

  it("pushes a non-noise event to the tutor with the FULL structured content", () => {
    render(<GenericArtefactFrame sandboxOrigin="https://sandbox" artefact={ARTEFACT} sessionId="s1" />);
    onUpdate()({ kind: "boldkast.state-change", state: { theta: 45 } });
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    const [url, opts] = vi.mocked(fetchWithAuth).mock.calls[0];
    expect(url).toContain("/sessions/s1/iframe-context");
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.serverId).toBe("boldkast");
    expect(body.structuredContent.state).toEqual({ theta: 45 }); // payload preserved
    expect(body.structuredContent.lastEvent).toBe("boldkast.state-change");
  });

  it("drops noise events (pause / reset)", () => {
    render(<GenericArtefactFrame sandboxOrigin="https://sandbox" artefact={ARTEFACT} sessionId="s1" />);
    onUpdate()({ kind: "boldkast.pause" });
    onUpdate()({ kind: "led-planck.reset" });
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("does not push before a session exists", () => {
    render(<GenericArtefactFrame sandboxOrigin="https://sandbox" artefact={ARTEFACT} sessionId={null} />);
    onUpdate()({ kind: "boldkast.state-change", state: {} });
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
});
