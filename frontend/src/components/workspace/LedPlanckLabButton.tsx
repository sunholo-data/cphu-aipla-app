"use client";

interface LedPlanckLabButtonProps {
  onOpen: () => void;
  disabled?: boolean;
}

export function LedPlanckLabButton({ onOpen, disabled }: LedPlanckLabButtonProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left text-sm transition hover:border-primary hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Åbn LED-laboratorium"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-base font-semibold text-primary"
        aria-hidden="true"
      >
        LED
      </span>
      <span className="flex-1">
        <span className="block font-medium">Åbn LED-laboratorium</span>
        <span className="block text-xs text-muted-foreground">
          Virtuelt eksperiment — bestem Plancks konstant ved at måle U₀ for seks LED-farver
        </span>
      </span>
      <span className="text-xs text-muted-foreground" aria-hidden="true">›</span>
    </button>
  );
}
