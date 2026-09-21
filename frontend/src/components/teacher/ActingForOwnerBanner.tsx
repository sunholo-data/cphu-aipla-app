"use client";

import { Microscope, PenLine } from "lucide-react";

import { useTeacherAuth } from "@/hooks/useTeacherAuth";
import { formatRelativeTime } from "@/lib/relativeTime";

/** 1.1.108 M4 — copy lives here, never inline in JSX. */
const copy = {
  banner: {
    class: (owner: string) => `You are editing ${owner}’s class as a researcher.`,
    activity: (owner: string) => `You are editing ${owner}’s activity as a researcher.`,
    detail:
      "Everything you change here is live for their students, and the page will show them who last edited it.",
  },
  lastEdited: (who: string, when: string) => `Last edited by ${who}, ${when}`,
  someoneElse: "another researcher",
} as const;

export interface OwnedResource {
  ownerUid: string;
  ownerLabel?: string;
}

/**
 * The "whose is this" banner (1.1.123 M0).
 *
 * A `role:researcher` may edit any teacher's class or activity (the assistance
 * bypass). The page they land on must say so, because nothing else does — the
 * controls look identical to the owner's. Renders nothing for the owner, so the
 * ordinary case pays no chrome. The viewer is the Firebase teacher identity;
 * until it resolves the banner stays hidden rather than flashing a wrong claim.
 */
export function ActingForOwnerBanner({
  resource,
  kind,
}: {
  resource: OwnedResource;
  kind: "class" | "activity";
}) {
  const { user } = useTeacherAuth({ redirectOnSignedOut: false });
  if (!user?.uid || user.uid === resource.ownerUid) return null;
  const owner = resource.ownerLabel ?? resource.ownerUid;
  return (
    <div
      role="status"
      data-testid="acting-for-owner-banner"
      className="mb-4 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <Microscope className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-medium">{copy.banner[kind](owner)}</p>
        <p className="text-xs opacity-80">{copy.banner.detail}</p>
      </div>
    </div>
  );
}

export interface LastEditedResource {
  lastEditedBy?: { uid: string; at: string } | null;
  lastEditedByLabel?: string;
}

/**
 * "Last edited by JB, 2 hours ago" (1.1.123 M3) — the passive attribution the
 * owner sees. Stamped by the backend only when someone other than the owner
 * wrote the document, so its presence alone carries the information; nothing
 * renders when it is absent.
 */
export function LastEditedLine({ resource }: { resource: LastEditedResource }) {
  const stamp = resource.lastEditedBy;
  if (!stamp) return null;
  const who = resource.lastEditedByLabel ?? copy.someoneElse;
  const when = formatRelativeTime(stamp.at) || stamp.at;
  return (
    <p
      data-testid="last-edited-line"
      title={stamp.at}
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <PenLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {copy.lastEdited(who, when)}
    </p>
  );
}
