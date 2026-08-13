"use client";

import { FlaskConical, TabletSmartphone } from "lucide-react";

import { useViewportTooNarrow } from "@/hooks/useViewportTooNarrow";
import type { ActivityArtefact } from "./GenericArtefactFrame";

interface SimLauncherProps {
  artefact: ActivityArtefact;
  onOpen: () => void;
  disabled?: boolean;
}

/**
 * SimLauncher — the resting state of a generic-artefact activity's simulation
 * (1.1.41): a card the student opens to launch the sim, which then takes over
 * the workspace. Mirrors the legacy per-sim launch buttons (LedPlanckLabButton
 * etc.) so every sim — legacy or generic — is behind a launch affordance rather
 * than mounted inline next to the element tools.
 *
 * MOBILE-1 (2026-08-13): when the artefact declares a `minViewportPx` the phone
 * is too narrow for, the card says so instead of launching. It is NOT hidden —
 * the student still sees the activity has a simulation, and is told what to do
 * about it. A silently-absent sim reads as a bug; a sim that opens and renders
 * half a circuit board reads as a worse one.
 */
export function SimLauncher({ artefact, onOpen, disabled }: SimLauncherProps) {
  const tooNarrow = useViewportTooNarrow(artefact.minViewportPx);

  if (tooNarrow) {
    return (
      <div className="p-4">
        <div
          role="note"
          className="flex w-full items-start gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-left text-sm"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <TabletSmartphone className="h-5 w-5" />
          </span>
          <span className="flex-1">
            <span className="block font-medium">
              {artefact.displayName} kræver en større skærm
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Simulationen har brug for mindst {artefact.minViewportPx} px i
              bredden — åbn aktiviteten på en tablet eller computer. Du kan godt
              chatte med tutoren her imens.
            </span>
            <span className="mt-1 block text-xs text-muted-foreground opacity-70">
              (This simulation needs a wider screen — open the activity on a
              tablet or laptop. You can still chat with the tutor here.)
            </span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        aria-label={`Åbn ${artefact.displayName}`}
        className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left text-sm transition hover:border-primary hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <FlaskConical className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block font-medium">Åbn {artefact.displayName}</span>
          <span className="block text-xs text-muted-foreground">
            Virtuel simulation — åbn for at udforske.
          </span>
        </span>
        <span className="text-xs text-muted-foreground" aria-hidden="true">
          ›
        </span>
      </button>
    </div>
  );
}
