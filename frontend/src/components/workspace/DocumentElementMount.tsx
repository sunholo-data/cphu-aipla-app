"use client";

import { StudentDocumentWorkbench } from "./StudentDocumentWorkbench";
import type { DocumentElement } from "@/lib/elementTypes";

// Canonical DocumentElement re-exported under the render-side name. `prompt` is
// optional in the canonical type (it was required here but optional on the wire);
// this component already guards it (`def.prompt ? … : null`).
export type DocumentElementDef = DocumentElement;

/**
 * DocumentElementMount (1.1.48) — the workspace mount for the document-upload
 * element. Wraps the existing `StudentDocumentWorkbench` (file tabs, upload,
 * delete, viewer) and surfaces the active file to the caller so the chat page
 * can push it into the tutor's `document_ids` (the same wiring the old
 * document-mode dispatch had — now reached through the element registry). The
 * upload surface composes with any other elements stacked above/below it.
 */
export function DocumentElementMount({
  skillId,
  sessionId = null,
  role = "student",
  document,
  onActiveDocChange,
}: {
  skillId: string;
  sessionId?: string | null;
  /** Whose token reads the files: student (group) or teacher (builder preview). */
  role?: "student" | "teacher";
  document: DocumentElementDef[];
  onActiveDocChange?: (docId: string | null) => void;
}) {
  const def = document[0];
  if (!def) return null;
  return (
    <div className="flex min-h-0 flex-col gap-1">
      {def.prompt ? <p className="px-2 pt-2 text-sm font-medium text-foreground">{def.prompt}</p> : null}
      <StudentDocumentWorkbench
        skillId={skillId}
        sessionId={sessionId}
        role={role}
        onActiveDocChange={onActiveDocChange}
      />
    </div>
  );
}
