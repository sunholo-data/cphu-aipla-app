"use client";

import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import type { NoteElement } from "@/lib/elementTypes";

/** Canonical NoteElement re-exported under the render-side name. */
export type NoteElementDef = NoteElement;

interface WorkbenchNoteProps {
  skillId: string;
  notes: NoteElementDef[];
}

const noNavigate = () => {};

/**
 * WorkbenchNote — a teacher-authored instructions / reference card (1.1.38 M4).
 * Renders the Markdown body read-only via the shared `ChatMarkdown` renderer
 * (so formulas / SVG / lists all work). Distinct from uploaded `materials`
 * (files in the Documents tab); this is inline teacher-written reference text.
 */
export function WorkbenchNote({ notes }: WorkbenchNoteProps) {
  return (
    <div className="space-y-4 p-4">
      {notes.map((note) => (
        <section
          key={note.id}
          className="rounded-lg border border-border bg-card p-4 text-sm"
          aria-label={note.title || "Note"}
        >
          {note.title && (
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {note.title}
            </h3>
          )}
          <ChatMarkdown content={note.body} navigateToBlock={noNavigate} />
        </section>
      ))}
    </div>
  );
}
