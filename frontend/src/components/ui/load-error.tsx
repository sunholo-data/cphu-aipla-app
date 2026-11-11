"use client";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { Button } from "./button";

/**
 * The one "this could not be read" state.
 *
 * Exists because a failed read rendered as an empty list on eight teacher and
 * researcher surfaces (UI sweep 2026-11-09, item 1): a teacher saw "no sessions
 * yet" when the server had not answered, and believed it. That is the UI form
 * of CLAUDE.md's "a checker answers when it could not read its subject".
 *
 * Rule: a surface that loads data keeps THREE states apart — loading, failed
 * (this component), and a real empty answer (its own empty state). Never let
 * a failure fall through to the empty branch.
 */
export function LoadError({
  what,
  onRetry,
  retrying = false,
  className,
}: {
  /** What could not be read, already localised: "Sessionerne", "Dine tilgange". */
  what: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const t = useT("UiKit");
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm",
        className,
      )}
    >
      <p className="font-medium text-foreground">{t("loadFailed", { what })}</p>
      <p className="text-muted-foreground">{t("loadFailedDetail")}</p>
      {onRetry && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={onRetry}
          pending={retrying}
          pendingLabel={t("retrying")}
        >
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
