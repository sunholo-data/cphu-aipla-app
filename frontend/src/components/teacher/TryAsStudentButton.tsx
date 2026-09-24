"use client";

// 1.1.133 — "Try as student": open the REAL student view of this activity in a
// new tab, with no join code to make or type.
//
// Teacher feedback 2026-09-24: "Kan man lave en knap … der viser elevernes
// interface, så man ikke skal lave en elevkode hver gang (som ofte ikke virker)?"
//
// The server mints a short-lived `preview-` group and this opens the ordinary
// join link, which auto-joins and lands in the activity. So the student page
// runs exactly as for a student — group token, tutor, workbench — and never sees
// a teacher token. The group token lives in the NEW tab's sessionStorage, so this
// tab's teacher session is untouched.

import { useState } from "react";
import { UserRound } from "lucide-react";
import { ConflictError, createStudentPreview } from "@/lib/teacherApi";

const copy = {
  label: "Try as student",
  opening: "Opening…",
  hint: "Opens the student view of the saved activity in a new tab — tutor included, no join code.",
  failed: "Could not open the student view. Try again in a moment.",
  popupBlocked: "Your browser blocked the new tab. Allow pop-ups for this site and try again.",
};

interface TryAsStudentButtonProps {
  activityId: string;
  /** The class the builder was opened from, when known; otherwise the server
   *  picks the first class that contains the activity. */
  classId?: string;
}

export function TryAsStudentButton({ activityId, classId }: TryAsStudentButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    // Open the tab synchronously, inside the click, so a popup blocker allows
    // it; point it at the join link once the server has minted the group.
    const tab = window.open("", "_blank");
    if (!tab) {
      setError(copy.popupBlocked);
      return;
    }
    setBusy(true);
    try {
      const preview = await createStudentPreview(activityId, classId || undefined);
      tab.opener = null;
      tab.location.href = preview.joinUrl;
    } catch (err) {
      tab.close();
      setError(err instanceof ConflictError && err.message ? err.message : copy.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={open}
        disabled={busy || !activityId}
        title={copy.hint}
        className="flex items-center gap-1.5 rounded border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
      >
        <UserRound className="h-4 w-4" aria-hidden="true" />
        {busy ? copy.opening : copy.label}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
