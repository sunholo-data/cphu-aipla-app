"use client";

import { Microscope, PenLine } from "lucide-react";

import { useTeacherAuth } from "@/hooks/useTeacherAuth";
// 1.1.108 M2: the relative time follows the teacher's own language, like the
// sentence around it.
import { formatRelativeTime } from "@/lib/relativeTime";
import { useLocaleMode, useT } from "@/i18n";

/** 1.1.108 M4 — copy lives here, never inline in JSX. */

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
  const t = useT("ActingForOwnerBanner");
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
        <p className="font-medium">
          {kind === "class" ? t("editingClass", { owner }) : t("editingActivity", { owner })}
        </p>
        <p className="text-xs opacity-80">{t("detail")}</p>
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
  const t = useT("ActingForOwnerBanner");
  const mode = useLocaleMode();
  const stamp = resource.lastEditedBy;
  if (!stamp) return null;
  const who = resource.lastEditedByLabel ?? t("someoneElse");
  const when = formatRelativeTime(stamp.at, Date.now(), mode === "bilingual" ? "da" : mode) || stamp.at;
  return (
    <p
      data-testid="last-edited-line"
      title={stamp.at}
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <PenLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t("lastEdited", { who, when })}
    </p>
  );
}
