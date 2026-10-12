"use client";

// 1.1.151 — the builder's soft hints, rendered beside the save button. Never
// blocking: each one says what looks off and leaves the decision with the
// teacher. The checks themselves are pure functions in `lib/builderHints`.

import { Lightbulb } from "lucide-react";

import { useT } from "@/i18n";
import type { BuilderHint } from "@/lib/builderHints";

export function BuilderHints({ hints }: { hints: BuilderHint[] }) {
  const t = useT("BuilderHints");
  if (hints.length === 0) return null;

  function text(hint: BuilderHint): string {
    switch (hint.kind) {
      case "languageLooksDanish":
        return t("languageLooksDanish");
      case "languageLooksEnglish":
        return t("languageLooksEnglish");
      case "duplicateColumns":
        return t("duplicateColumns", {
          table: hint.table || t("untitledTable"),
          labels: hint.labels.join(", "),
        });
      case "untitledTables":
        return t("untitledTables", { count: hint.count });
    }
  }

  return (
    <div
      role="status"
      data-testid="builder-hints"
      className="flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="flex items-center gap-1 font-medium">
        <Lightbulb className="h-4 w-4" aria-hidden="true" />
        {t("heading")}
      </p>
      <ul className="list-disc pl-5">
        {hints.map((hint, i) => (
          <li key={`${hint.kind}-${i}`}>{text(hint)}</li>
        ))}
      </ul>
    </div>
  );
}
