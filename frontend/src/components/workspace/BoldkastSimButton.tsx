"use client";

interface BoldkastSimButtonProps {
  /** Click handler — usually flips workspace state from "problem" to "sim". */
  onOpen: () => void;
  /** Optional disabled state if the sandbox URL isn't configured. */
  disabled?: boolean;
}

/**
 * BoldkastSimButton — launcher card at the top of the WorkspaceShell.
 * Click → workspace switches to BoldkastSimFrame; close button on the
 * frame returns to the default content.
 *
 * Static button rather than an A2UI tool call: per the v0.1 design doc,
 * problem-set-hints is A2UI-disabled (no agent-triggered surfaces) and
 * the sim launcher is hardcoded UI. v1 will lift this to a per-skill
 * `artefacts: [...]` declaration on SkillConfig so the launcher is
 * data-driven; for v0.1 it's a literal Boldkast button.
 */
export function BoldkastSimButton({ onOpen, disabled }: BoldkastSimButtonProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left text-sm transition hover:border-primary hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Åbn Boldkast simulator"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-base font-semibold text-primary"
        aria-hidden="true"
      >
        θ
      </span>
      <span className="flex-1">
        <span className="block font-medium">Åbn Boldkast simulator</span>
        <span className="block text-xs text-muted-foreground">
          Interaktiv visualisering — udforsk hvordan v₀ og θ påvirker banen
        </span>
      </span>
      <span className="text-xs text-muted-foreground" aria-hidden="true">›</span>
    </button>
  );
}
