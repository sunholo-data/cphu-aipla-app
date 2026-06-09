import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SettingRowProps {
  label: string;
  /** id of the control this row labels — associates `<label for>` for a11y. */
  htmlFor?: string;
  help?: ReactNode;
  /** The control: input / select / toggle / etc. */
  children: ReactNode;
  className?: string;
}

/**
 * The atom every teacher config renders as: `label · help` on the left,
 * control on the right (stacks on mobile). The progressive-disclosure
 * pattern in practice — a new config is one `SettingRow`, never a bespoke
 * layout.
 */
export function SettingRow({ label, htmlFor, help, children, className }: SettingRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
        className,
      )}
    >
      <div className="flex flex-col gap-0.5 sm:max-w-xs">
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {help ? <span className="text-xs text-muted-foreground">{help}</span> : null}
      </div>
      <div className="sm:w-full sm:max-w-sm">{children}</div>
    </div>
  );
}
