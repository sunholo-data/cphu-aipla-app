"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { useOptionalProactiveSimOptsRef } from "@/contexts/ProactiveSimContext";
import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";
import type { SolutionDoc } from "./WorkbenchSolution";

// The turn the student's submit kicks off. The solution itself rides the
// iframe-context (mcp_app_context.solution.state, injected into the tutor's
// prompt); this short message is the visible "I submitted" turn that makes the
// tutor respond. The tutor matches the student's language regardless (feedback
// prompt). Must be non-empty — ag_ui_adk drops empty-content turns.
const SOLUTION_FEEDBACK_TRIGGER = "Jeg har gemt min løsning — giv mig feedback på den.";

/** Teacher-authored solution-editor element (1.1.45 M4). Mirrors the backend
 *  `SolutionElement` — the teacher authors the `prompt`, the student writes. */
export interface SolutionElementDef {
  id: string;
  prompt: string;
}

/** What the tutor receives on submit (over the iframe-context wire). */
interface SolutionSnapshot {
  markdown: string;
}

const Spinner = () => (
  <div className="flex h-40 items-center justify-center text-muted-foreground">
    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
  </div>
);

// pdf.js-style lazy: the TipTap bundle only loads when a solution activity
// actually mounts this surface (off the chat first-load).
const WorkbenchSolution = dynamic(() => import("./WorkbenchSolution").then((m) => m.WorkbenchSolution), {
  ssr: false,
  loading: () => <Spinner />,
});

/**
 * SolutionElementMount (1.1.45 M4) — the workspace mount for the solution
 * editor: lazy-loads the TipTap `WorkbenchSolution`, persists the student's
 * draft (ProseMirror JSON) to sessionStorage keyed by activity (the data-table
 * pattern), and on submit pushes the serialised markdown to the tutor over the
 * `iframe-context` wire so the next turn critiques it (the feedback prompt is
 * injected server-side when the activity has a solution element).
 */
export function SolutionElementMount({
  skillId,
  sessionId = null,
  solution,
}: {
  skillId: string;
  sessionId?: string | null;
  solution: SolutionElementDef[];
}) {
  const def = solution[0];
  const storageKey = `aipla:solution:${skillId}`;
  // undefined = restoring; null = blank; doc = restored draft.
  const [initialDoc, setInitialDoc] = useState<SolutionDoc | null | undefined>(undefined);
  const pushSolution = useSimSnapshotPush<SolutionSnapshot>(sessionId, "solution");
  // The chat page registers { skillId, onProactiveTrigger } here; we use it to
  // kick off the feedback turn on submit (null in the builder preview).
  const proactiveRef = useOptionalProactiveSimOptsRef();

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      setInitialDoc(raw ? (JSON.parse(raw) as SolutionDoc) : null);
    } catch {
      setInitialDoc(null);
    }
  }, [storageKey]);

  const persist = useCallback(
    (doc: SolutionDoc) => {
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(doc));
      } catch {
        /* quota / private mode — draft persistence is best-effort */
      }
    },
    [storageKey],
  );

  const onSubmit = useCallback(
    async (markdown: string, doc: SolutionDoc) => {
      persist(doc);
      // Push the solution into the agent's context, THEN trigger a feedback turn.
      // Await the push so the triggered turn sees the latest solution. The submit
      // is a deliberate click → always responds (ungated, unlike the automatic
      // sim-event proactive path with its cooldown/allowlist).
      await pushSolution({ markdown }, "solution.submit");
      proactiveRef?.current?.onProactiveTrigger(SOLUTION_FEEDBACK_TRIGGER);
    },
    [persist, pushSolution, proactiveRef],
  );

  if (!def) return null;
  if (initialDoc === undefined) return <Spinner />;

  return (
    <WorkbenchSolution
      key={def.id}
      initialDoc={initialDoc}
      prompt={def.prompt}
      onDraftChange={persist}
      onSubmit={onSubmit}
    />
  );
}
