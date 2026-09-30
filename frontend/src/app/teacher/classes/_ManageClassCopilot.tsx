"use client";

import { useMemo } from "react";

import { TeacherCopilot } from "@/components/teacher/copilot";
import { useT } from "@/i18n";

import { applyClassProposal, makeClassProposalDescriptor, parseClassProposal } from "./classCopilotProposal";

/**
 * The class-management co-pilot — the shared floating co-pilot configured for
 * manage-class. Drops onto /teacher/classes so the teacher creates classes and
 * creates group codes by talking, beside the list and the New-class button, and watches
 * the results appear (propose → Apply → `onChanged` refetch). Reads + analytics
 * answer in chat.
 */
export function ManageClassCopilot({ onChanged }: { onChanged?: () => void }) {
  const t = useT("ManageClassCopilot");
  const tProposal = useT("ClassProposal");
  const descriptor = useMemo(() => makeClassProposalDescriptor(tProposal), [tProposal]);
  return (
    <TeacherCopilot
      skillName="manage-class"
      title={t("title")}
      placeholder={t("placeholder")}
      emptyText={t("empty")}
      parseProposal={parseClassProposal}
      proposalDescriptor={descriptor}
      // The created class / new group codes appear in the list (onChanged refetch),
      // so the card removes itself on Apply rather than leaving a lingering badge.
      dismissOnApply
      onApplyProposal={async (proposal) => {
        await applyClassProposal(proposal);
        onChanged?.();
      }}
    />
  );
}
