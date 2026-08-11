"use client";

import { useState } from "react";

import { StaticArtefactFrame } from "@/components/workspace/StaticArtefactFrame";

const SANDBOX_ORIGIN = (process.env.NEXT_PUBLIC_MCP_SANDBOX_URL ?? "")
  .replace(/\/sandbox\.html$/, "")
  .replace(/\/$/, "");

export function ProjectArtefactDemo() {
  const [ready, setReady] = useState(false);

  if (!SANDBOX_ORIGIN) {
    return (
      <span className="my-7 block rounded-xl border border-border bg-muted/40 p-5 text-sm text-muted-foreground">
        The interactive demonstration is unavailable in this environment. The maintained
        activity remains accessible through the <a href="/group" className="font-medium text-brand underline">group join page</a>.
      </span>
    );
  }

  return (
    <span className="my-7 block overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <span className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
        <span>
          <span className="block text-sm font-semibold text-foreground">Try the Boldkast workbench</span>
          <span className="block text-xs text-muted-foreground">Change the launch conditions and compare trajectories.</span>
        </span>
        <span className="text-xs font-medium text-muted-foreground" aria-live="polite">
          {ready ? "Ready" : "Loading…"}
        </span>
      </span>
      <StaticArtefactFrame
        sandboxOrigin={SANDBOX_ORIGIN}
        artefactPath="boldkast/v1"
        onUpdateModelContext={() => {}}
        onInitialized={() => setReady(true)}
        hostContext={{ displayMode: "inline", locale: "en", timeZone: "Europe/Copenhagen" }}
        className="h-[620px] w-full border-0"
        title="Interactive Boldkast projectile-motion simulation"
      />
      <span className="block border-t border-border px-4 py-3 text-xs leading-5 text-muted-foreground">
        This public demonstration shows the workbench by itself. In a class activity, its
        relevant actions can also be shared visibly with the tutor.
      </span>
    </span>
  );
}
