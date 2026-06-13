"use client";

import { useState } from "react";
import { Check, Copy, Users } from "lucide-react";

/**
 * GroupCodeBadge — shows the anonymous group code (e.g. "lazy-flute-39") in the
 * chat header so students can read out / share it for others to join. Click to
 * copy. No-op render when there's no code (non-group sessions).
 */
export function GroupCodeBadge({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code as string);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure context / permissions) — the code is
         still visible to read aloud, so this is non-fatal */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Kopiér gruppekode så andre kan deltage"
      aria-label={`Gruppekode ${code}. Klik for at kopiere.`}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
    >
      <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="font-mono tracking-wide">{code}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      )}
    </button>
  );
}
