"use client";

import { type ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { FileText, Wrench } from "lucide-react";

/**
 * The two-surface workbench shell (1.1.45 M1). Used ONLY when an activity has
 * BOTH the element tools AND documents — otherwise the single surface renders
 * directly with no tab layer (the activity-driven decision, M 2026-06-24). A sim,
 * when launched, pre-empts this entirely (it's the takeover surface, 1.1.41).
 */
export function WorkbenchTabs({
  work,
  documents,
  docCount,
}: {
  work: ReactNode;
  documents: ReactNode;
  docCount: number;
}) {
  const triggerClass =
    "flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground " +
    "hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground";

  return (
    <Tabs.Root defaultValue="work" className="flex min-h-0 flex-col">
      <Tabs.List className="flex gap-1 border-b border-border px-2" aria-label="Workbench">
        <Tabs.Trigger value="work" className={triggerClass}>
          <Wrench className="h-4 w-4" aria-hidden="true" />
          Arbejde
        </Tabs.Trigger>
        <Tabs.Trigger value="documents" className={triggerClass}>
          <FileText className="h-4 w-4" aria-hidden="true" />
          Dokumenter
          {docCount > 0 ? (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">
              {docCount}
            </span>
          ) : null}
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="work" className="min-h-0 focus-visible:outline-none">
        {work}
      </Tabs.Content>
      <Tabs.Content value="documents" className="min-h-0 focus-visible:outline-none">
        {documents}
      </Tabs.Content>
    </Tabs.Root>
  );
}
