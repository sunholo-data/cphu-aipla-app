"use client";

/** The activity sheet as it prints: one card per group (1.1.165).
 *
 *  Shared by the teacher's sheet page and the student's dialog. It renders
 *  props only and fetches nothing, so it carries no auth helper and can sit
 *  under both surfaces. The Markdown comes from the server, built from fields
 *  students already see; links are shown as text because the sheet is for paper.
 *
 *  The look follows the Word template (`backend/handouts/sheet_template.py`):
 *  a header band with the KU seal, the title in KU red, the group box as a
 *  tinted table, small-caps section labels. The header is in the SHEET's
 *  language, not the viewer's, like the Word file.
 */

import { forwardRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { translate } from "@/i18n";
import type { ActivitySheetPage } from "@/lib/activitySheetApi";

const SEAL_SRC = "/images/logo/ku-logo.svg";
// Label | value: the first cell is the red label, the second may be a long link.
const CELL =
  "break-all px-3 py-1.5 text-left align-top font-normal first:w-1/5 first:break-normal first:font-semibold first:text-brand";

const components: Components = {
  h1: ({ children }) => <h1 className="mb-3 text-2xl font-bold leading-tight text-brand">{children}</h1>,
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-5 border-b border-brand-line pb-1 text-xs font-bold uppercase tracking-wider text-brand">
      {children}
    </h2>
  ),
  p: ({ children }) => <p className="mb-1.5 text-sm leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-5 text-sm">{children}</ul>,
  ol: ({ children }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-5 text-sm">{children}</ol>,
  em: ({ children }) => <em className="text-muted-foreground">{children}</em>,
  a: ({ children }) => <span className="break-all">{children}</span>,
  // The group box: label | value rows, the header row looking like the rest.
  table: ({ children }) => (
    <table className="mb-2 w-full border-collapse border border-brand-line bg-brand-tint text-sm">{children}</table>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-brand-line">{children}</tr>,
  th: ({ children }) => <td className={CELL}>{children}</td>,
  td: ({ children }) => <td className={CELL}>{children}</td>,
};

export const ActivitySheetView = forwardRef<
  HTMLDivElement,
  { sheets: ActivitySheetPage[]; language: "da" | "en" }
>(function ActivitySheetView({ sheets, language }, ref) {
  const t = translate(language, "ActivitySheet");
  return (
    <div ref={ref} className="flex flex-col gap-4">
      {sheets.map((sheet, i) => (
        <section
          key={sheet.code ?? `blank-${i}`}
          data-sheet
          data-testid={`activity-sheet-${sheet.code ?? "blank"}`}
          className="rounded-md border border-border bg-background p-6 text-foreground shadow-sm"
        >
          <header data-sheet-header className="mb-4 flex items-center gap-3 border-b-2 border-brand pb-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- copied into the print window as HTML */}
            <img src={SEAL_SRC} alt={t("sealAlt")} width={40} height={40} className="h-10 w-10" />
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="text-lg font-bold tracking-wide text-brand">AIPLA</span>
              <span className="text-[11px] text-muted-foreground">{t("headerUniversity")}</span>
            </div>
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground">{t("headerName")}</span>
          </header>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {sheet.markdown}
          </ReactMarkdown>
        </section>
      ))}
    </div>
  );
});
