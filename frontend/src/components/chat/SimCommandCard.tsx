"use client";

// SimCommandCard — the visible record of the tutor changing the student's
// simulation (1.1.133 M1). The mirror image of the "shared with the AI" trust
// card: there the student's act reaches the tutor; here the tutor's act reaches
// the student's screen, and the student must SEE every one of them.
//
// Mounting the card is also what delivers the command: it publishes the call to
// the simCommandBus, which GenericArtefactFrame forwards to the sim as
// `<artefactId>.cmd-<command>`. The bus applies each toolCallId once, so a
// re-render never replays a jump.
//
// The effect text ("Sprang til næste solformørkelse") comes from the sim's
// catalogue entry, in the sim's own language; only the frame around it is ours.

import { useEffect } from "react";
import { MonitorPlay } from "lucide-react";

import { useT } from "@/i18n";
import { dispatchSimCommand } from "@/lib/simCommandBus";

export interface SimCommandResult {
  artefactId: string;
  command: string;
  args: Record<string, unknown>;
  effect: string;
  /** view | scaffold | restrict — only a `view` change can be undone from the
   *  sim's own controls, so only that card says so. */
  power: string;
}

/** Parse a control_sim tool result, or null (a refused/malformed call falls
 *  back to the generic chip and is NEVER sent to the sim). */
export function parseSimCommandResult(resultContent: string | null | undefined): SimCommandResult | null {
  if (!resultContent) return null;
  try {
    const r = JSON.parse(resultContent) as {
      ok?: boolean;
      artefactId?: unknown;
      command?: unknown;
      args?: unknown;
      effect?: unknown;
      power?: unknown;
    };
    if (!r.ok || typeof r.artefactId !== "string" || typeof r.command !== "string") return null;
    const args = r.args && typeof r.args === "object" && !Array.isArray(r.args) ? (r.args as Record<string, unknown>) : {};
    return {
      artefactId: r.artefactId,
      command: r.command,
      args,
      effect: typeof r.effect === "string" ? r.effect : "",
      power: typeof r.power === "string" ? r.power : "view",
    };
  } catch {
    return null;
  }
}

export function SimCommandCard({ toolCallId, result }: { toolCallId: string; result: SimCommandResult }) {
  const t = useT("SimCommandCard");
  const { artefactId, command, args } = result;
  useEffect(() => {
    dispatchSimCommand({ toolCallId, artefactId, command, args });
    // args is a fresh object per parse; the toolCallId is the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolCallId]);
  return (
    <div
      data-testid="sim-command-card"
      className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-sm"
    >
      <MonitorPlay className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium text-sky-900">{t("changed")}</p>
        {result.effect ? <p className="text-xs text-slate-700">{result.effect}</p> : null}
        {result.power === "view" ? (
          <p className="mt-0.5 text-[10px] text-slate-500">{t("canChangeBack")}</p>
        ) : null}
      </div>
    </div>
  );
}
