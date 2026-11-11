"use client";

import { useT } from "@/i18n";
import type { InsightsScope } from "@/lib/insightsApi";
import { cn } from "@/lib/utils";

/**
 * The researcher's "Dine klasser | Alle læreres klasser" switch — ONE name and
 * one control shape on every page that has it (UI sweep 2026-11-11). It used to
 * be "Mine klasser | Forskervisning" on Klasser and "Mine klasser | Alle lærere"
 * on Indsigt. Pages keep the value in the URL (`?scope=`) with `useUrlTab`.
 *
 * Render it only for a researcher; the backend independently 403s `scope=all`
 * without the claim.
 */
export function ScopeToggle({
  value,
  onChange,
  size = "sm",
}: {
  value: InsightsScope;
  onChange: (next: InsightsScope) => void;
  size?: "sm" | "md";
}) {
  const t = useT("ScopeToggle");
  const btn = size === "md" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs";
  const option = (scope: InsightsScope, label: string, edge: string) => (
    <button
      type="button"
      aria-pressed={value === scope}
      onClick={() => onChange(scope)}
      className={cn(
        btn,
        edge,
        "font-medium focus-visible:relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        value === scope ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label={t("label")} className="flex items-center rounded border border-border">
      {option("own", t("own"), "rounded-l")}
      {option("all", t("all"), "rounded-r")}
    </div>
  );
}
