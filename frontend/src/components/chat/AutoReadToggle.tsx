"use client";

/**
 * AutoReadToggle — student preference for auto-speaking every tutor
 * message on stream-complete. Pairs with the read-aloud button: when
 * ON, the bubble fires the button automatically when the assistant
 * turn finishes streaming. See useAutoReadAloud for the state
 * management + barge-in semantics.
 *
 * Visual: tiny pill, persistent in the chat surface so the student
 * can flip it any time without digging through a settings menu. Uses
 * lucide Headphones icon when ON, HeadphoneOff when OFF (per
 * feedback_no_emoticons: lucide icons, not emoji).
 */

import { Ear, EarOff } from "lucide-react";

import { useAutoReadAloud } from "@/hooks/useAutoReadAloud";

export function AutoReadToggle({ className }: { className?: string }) {
  const { enabled, toggle } = useAutoReadAloud();
  const Icon = enabled ? Ear : EarOff;
  const label = enabled ? "Auto-læs op: TIL" : "Auto-læs op: FRA";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      }
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span>{enabled ? "Auto" : "Manual"}</span>
    </button>
  );
}
