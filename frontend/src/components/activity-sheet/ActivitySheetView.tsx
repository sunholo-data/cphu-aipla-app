"use client";

/** The activity sheet as it prints: one card per group (1.1.165).
 *
 *  Shared by the teacher's sheet page and the student's dialog. It renders
 *  props only and fetches nothing, so it carries no auth helper and can sit
 *  under both surfaces. The Markdown comes from the server, built from fields
 *  students already see; links are shown as text because the sheet is for paper.
 */

import { forwardRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ActivitySheetPage } from "@/lib/activitySheetApi";

const components: Components = {
  h1: ({ children }) => <h1 className="mb-2 text-xl font-bold text-brand">{children}</h1>,
  h2: ({ children }) => (
    <h2 className="mb-1 mt-4 border-b border-brand pb-0.5 text-sm font-semibold text-brand">{children}</h2>
  ),
  p: ({ children }) => <p className="mb-1.5 text-sm leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-5 text-sm">{children}</ul>,
  ol: ({ children }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-5 text-sm">{children}</ol>,
  em: ({ children }) => <em className="text-muted-foreground">{children}</em>,
  a: ({ children }) => <span className="break-all">{children}</span>,
};

export const ActivitySheetView = forwardRef<HTMLDivElement, { sheets: ActivitySheetPage[] }>(
  function ActivitySheetView({ sheets }, ref) {
    return (
      <div ref={ref} className="flex flex-col gap-4">
        {sheets.map((sheet, i) => (
          <section
            key={sheet.code ?? `blank-${i}`}
            data-sheet
            data-testid={`activity-sheet-${sheet.code ?? "blank"}`}
            className="rounded-md border border-border bg-background p-5 text-foreground shadow-sm"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {sheet.markdown}
            </ReactMarkdown>
          </section>
        ))}
      </div>
    );
  },
);
