// simCommandBus — routes a tutor's `control_sim` call from the chat to the sim
// (1.1.133 M1).
//
// The two ends do not share a React subtree: the call arrives in a MessageBubble
// (chat column) and the sim lives in GenericArtefactFrame (workspace column).
// Rather than thread a provider through the chat page, this is a tiny
// module-level bus: the card publishes, the frame subscribes.
//
//   SimCommandCard ── dispatch({toolCallId, artefactId, command, args}) ──▶
//   GenericArtefactFrame ── sendNotification("<id>.cmd-<command>", args) ──▶ sim
//
// ⚠️ APPLY EXACTLY ONCE, LIVE ONLY. The bus remembers every toolCallId it has
// applied and ignores a repeat. Without that, a re-mounted bubble (or any
// re-render that re-runs the card's effect) replays the jump, and a chat that
// re-rendered its history would leave the sim somewhere arbitrary. Tool calls
// only ever come from the live AG-UI stream (restored history carries text,
// not tool calls), so a page reload starts with nothing to replay — and the
// dedupe holds even if that ever changes.
//
// A command for a sim that is not open waits (bounded) and is delivered when
// the frame mounts: the card has already told the student what changed, so the
// sim they open should show it.

export interface SimCommand {
  toolCallId: string;
  artefactId: string;
  command: string;
  args: Record<string, unknown>;
}

type Handler = (cmd: SimCommand) => void;

/** Commands held for a sim that is not mounted. Small: a tutor that queued more
 *  than this for a closed sim is not describing anything the student will see. */
const MAX_PENDING = 5;

const handlers = new Map<string, Set<Handler>>();
const pending = new Map<string, SimCommand[]>();
const applied = new Set<string>();

/** Publish a tutor command. Returns false when this toolCallId was already
 *  applied (the replay guard), true otherwise — delivered now, or queued. */
export function dispatchSimCommand(cmd: SimCommand): boolean {
  if (!cmd.toolCallId || applied.has(cmd.toolCallId)) return false;
  applied.add(cmd.toolCallId);
  const subs = handlers.get(cmd.artefactId);
  if (subs && subs.size > 0) {
    subs.forEach((h) => h(cmd));
    return true;
  }
  const queue = pending.get(cmd.artefactId) ?? [];
  queue.push(cmd);
  pending.set(cmd.artefactId, queue.slice(-MAX_PENDING));
  return true;
}

/** Receive commands for one sim. Drains anything queued while it was closed.
 *  Returns the unsubscribe function (a React effect cleanup). */
export function subscribeSimCommands(artefactId: string, handler: Handler): () => void {
  const subs = handlers.get(artefactId) ?? new Set<Handler>();
  subs.add(handler);
  handlers.set(artefactId, subs);
  const queued = pending.get(artefactId);
  if (queued?.length) {
    pending.delete(artefactId);
    queued.forEach((c) => handler(c));
  }
  return () => {
    subs.delete(handler);
    if (subs.size === 0) handlers.delete(artefactId);
  };
}

/** Test-only: forget every subscriber, queued command and applied id. */
export function __resetSimCommandBusForTests(): void {
  handlers.clear();
  pending.clear();
  applied.clear();
}
