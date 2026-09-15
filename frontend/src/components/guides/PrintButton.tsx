"use client";

import { Printer } from "lucide-react";

/** Print the guide. The page carries print styles (`print:hidden` on the
 *  chrome), so what comes out is the prose and its screenshots — the same
 *  thing `make guides-pdf` prints with Playwright. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label}
    </button>
  );
}
