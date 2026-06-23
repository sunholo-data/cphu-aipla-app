"use client";

import { FlaskConical } from "lucide-react";

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
 */
export function SimLauncher({ artefact, onOpen, disabled }: SimLauncherProps) {
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
