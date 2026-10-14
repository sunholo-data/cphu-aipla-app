"use client";

import { useCallback } from "react";

import { StaticArtefactFrame } from "@/components/workspace/StaticArtefactFrame";
import { useT } from "@/i18n";
import { fetchSimPreview } from "@/lib/simDraftsApi";
import { withTeacherSimLockdown } from "@/lib/teacherSimPage";

// The same origin the activity creator's preview and the chat page use.
const sandboxOrigin = () =>
  (process.env.NEXT_PUBLIC_MCP_SANDBOX_URL ?? "").replace(
    /\/sandbox\.html$/,
    "",
  );

/**
 * A live, clickable preview of one draft version, in the SAME sandbox frame a
 * student gets (StaticArtefactFrame, the activity creator's preview), so the
 * teacher tries it exactly as students will. The HTML comes from the owner-only
 * drafts route and goes straight into the sandbox's separate origin; it is never
 * rendered on the app origin. The server stamps the real bridge in (a draft
 * stores only a placeholder) and the page runs under the same no-network lockdown
 * as a published teacher sim; its events reach no tutor here: this is a try-out.
 */
export function SimDraftPreview({
  draftId,
  version,
}: {
  draftId: string;
  version: number;
}) {
  const t = useT("SimWorkshopPage");
  const loadHtml = useCallback(
    // The same no-network lockdown a published teacher sim runs under.
    () =>
      fetchSimPreview(draftId, version).then(async (b) =>
        withTeacherSimLockdown(await b.text()),
      ),
    [draftId, version],
  );
  const origin = sandboxOrigin();
  if (!origin) {
    return (
      <p className="text-xs text-muted-foreground">{t("previewUnavailable")}</p>
    );
  }
  return (
    <StaticArtefactFrame
      // A new key per version remounts the frame, so the sandbox loads that version afresh.
      key={`${draftId}-v${version}`}
      sandboxOrigin={origin}
      artefactPath="__draft__"
      loadHtml={loadHtml}
      onUpdateModelContext={() => {}}
      title={t("previewTitle", { n: version })}
      className="h-[min(620px,80dvh)] w-full rounded border border-border bg-white"
    />
  );
}
