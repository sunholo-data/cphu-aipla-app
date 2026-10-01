import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";
import { __resetSimCommandBusForTests, subscribeSimCommands } from "@/lib/simCommandBus";
import type { ToolCallState } from "@/hooks/useSkillAgent";

import { MessageBubble } from "../MessageBubble";
import { SimCommandCard, parseSimCommandResult } from "../SimCommandCard";

vi.mock("@/components/protocols/A2UIRenderer", () => ({ A2UIRenderer: () => null }));
vi.mock("@/components/protocols/MCPAppToolCallRouter", () => ({ MCPAppToolCallRouter: () => null }));

/**
 * 1.1.133 M1 — the tutor changed the student's simulation. The student SEES
 * every change (the card), and the card is what delivers it to the sim.
 */
const OK = JSON.stringify({
  ok: true,
  artefactId: "sol-jord-maane",
  command: "jump",
  args: { event: "solform" },
  effect: "Sprang til næste solformørkelse",
  power: "view",
});
const REFUSED = JSON.stringify({ ok: false, error: "unknown command 'teleport'" });

describe("parseSimCommandResult", () => {
  it("parses a successful command", () => {
    expect(parseSimCommandResult(OK)).toEqual({
      artefactId: "sol-jord-maane",
      command: "jump",
      args: { event: "solform" },
      effect: "Sprang til næste solformørkelse",
      power: "view",
    });
  });

  it("returns null for a refused, malformed or redacted result", () => {
    expect(parseSimCommandResult(REFUSED)).toBeNull();
    expect(parseSimCommandResult("not json")).toBeNull();
    expect(parseSimCommandResult(null)).toBeNull();
    // What the stream filter substitutes if control_sim is ever un-allow-listed.
    expect(parseSimCommandResult(JSON.stringify({ redacted: "server-only tool result" }))).toBeNull();
  });
});

describe("SimCommandCard", () => {
  beforeEach(() => __resetSimCommandBusForTests());

  it("names the change in the student's language, with the sim's own effect text", () => {
    render(<SimCommandCard toolCallId="tc-1" result={parseSimCommandResult(OK)!} />);
    expect(screen.getByText("Tutoren ændrede din simulation")).toBeInTheDocument();
    expect(screen.getByText("Sprang til næste solformørkelse")).toBeInTheDocument();
    expect(screen.getByText(/stille den tilbage/)).toBeInTheDocument();
  });

  it("renders in English for an English activity", () => {
    render(
      <LocaleProvider locale="en">
        <SimCommandCard toolCallId="tc-1" result={parseSimCommandResult(OK)!} />
      </LocaleProvider>,
    );
    expect(screen.getByText("The tutor changed your simulation")).toBeInTheDocument();
  });

  it("does not promise an undo for a change the student cannot reverse", () => {
    const lock = { ...parseSimCommandResult(OK)!, command: "lock", power: "restrict", effect: "Låste tiden" };
    render(<SimCommandCard toolCallId="tc-1" result={lock} />);
    expect(screen.queryByText(/stille den tilbage/)).not.toBeInTheDocument();
  });

  it("delivers the command to the sim once, even when re-mounted", () => {
    const sim = vi.fn();
    subscribeSimCommands("sol-jord-maane", sim);
    const result = parseSimCommandResult(OK)!;
    const { unmount } = render(<SimCommandCard toolCallId="tc-1" result={result} />);
    unmount();
    render(<SimCommandCard toolCallId="tc-1" result={result} />);
    expect(sim).toHaveBeenCalledTimes(1);
    expect(sim).toHaveBeenCalledWith({
      toolCallId: "tc-1",
      artefactId: "sol-jord-maane",
      command: "jump",
      args: { event: "solform" },
    });
  });
});

describe("MessageBubble — control_sim", () => {
  beforeEach(() => __resetSimCommandBusForTests());

  const bubble = (toolCalls: ToolCallState[]) => (
    <MessageBubble
      message={{ id: "bot-1", role: "assistant", content: "Se, nu står vi ved formørkelsen." }}
      skillId="s"
      userInitial="M"
      userDisplayName="M"
      toolCalls={toolCalls}
      navigateToBlock={vi.fn()}
      onAction={vi.fn()}
    />
  );

  it("renders a successful call as the card, not a chip, and sends it to the sim", () => {
    const sim = vi.fn();
    subscribeSimCommands("sol-jord-maane", sim);
    render(bubble([{ id: "tc-9", name: "control_sim", status: "success", resultContent: OK }]));
    expect(screen.getByTestId("sim-command-card")).toBeInTheDocument();
    expect(screen.queryByText("control_sim")).not.toBeInTheDocument();
    expect(sim).toHaveBeenCalledTimes(1);
  });

  it("never sends a refused call to the sim", () => {
    const sim = vi.fn();
    subscribeSimCommands("sol-jord-maane", sim);
    render(bubble([{ id: "tc-9", name: "control_sim", status: "success", resultContent: REFUSED }]));
    expect(screen.queryByTestId("sim-command-card")).not.toBeInTheDocument();
    expect(sim).not.toHaveBeenCalled();
  });

  it("sends nothing while the call is still running (no result yet)", () => {
    const sim = vi.fn();
    subscribeSimCommands("sol-jord-maane", sim);
    render(bubble([{ id: "tc-9", name: "control_sim", status: "running" }]));
    expect(sim).not.toHaveBeenCalled();
  });
});
