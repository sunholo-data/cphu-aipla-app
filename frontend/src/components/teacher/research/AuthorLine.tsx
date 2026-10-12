"use client";

// AuthorLine — who made this, by which route, and when (1.1.150).
//
// On 2026-10-05 a pilot teacher's private approach, "Didaktisk Tutor", sat in a
// researcher's list under "Yours", with no author shown, and nobody in the room
// could say where it came from. The answer was in Firestore and nowhere on
// screen. This line is that answer, on every authored tutor, custom approach
// and custom persona — one component, so the three lists cannot drift.
//
// Everything here arrives from the server: `isOwn` (did I make it — NOT
// `canEdit`, which a researcher has on every row), `authorRole`, and
// `authorEmail`, which the server sends to researchers only. Nothing is
// re-derived, and a creation record that was not kept says so rather than
// guessing.

import { useT } from "@/i18n";
import type { AuthorshipFields } from "@/lib/teacherApi";

const CHANNELS = ["ui", "copilot", "seed", "sync", "adopt"] as const;

export function AuthorLine({ row, testId }: { row: AuthorshipFields; testId?: string }) {
  const t = useT("AuthorLine");

  const who = row.isBuiltIn
    ? t("builtIn")
    : row.isOwn
      ? t("byYou")
      : row.authorRole === "teacher"
        ? t("byTeacher")
        : row.authorRole === "researcher"
          ? t("byResearcher")
          : t("byColleague");

  const created = row.createdAt ? new Date(row.createdAt) : null;
  // An unknown channel from a newer server reads as "not recorded", not as a raw key.
  const via = row.createdVia && CHANNELS.includes(row.createdVia) ? row.createdVia : null;
  const when =
    created && !Number.isNaN(created.getTime())
      ? via
        ? t("createdVia", { channel: t(`via_${via}`), date: created })
        : t("createdOn", { date: created })
      : null;

  return (
    <p data-testid={testId} className="text-[11px] text-muted-foreground">
      <span>{who}</span>
      {!row.isOwn && !row.isBuiltIn && row.authorEmail ? <span> · {row.authorEmail}</span> : null}
      {when ? <span> · {when}</span> : !row.isBuiltIn ? <span> · {t("notRecorded")}</span> : null}
    </p>
  );
}
