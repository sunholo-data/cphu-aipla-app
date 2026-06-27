"use client";

import { TeacherCopilot } from "@/components/teacher/copilot";

import { applyClassProposal, classProposalDescriptor, parseClassProposal } from "./classCopilotProposal";

/**
 * The class-management co-pilot — the shared floating co-pilot configured for
 * manage-class. Drops onto /teacher/classes so the teacher creates classes and
 * mints codes by talking, beside the list and the New-class button, and watches
 * the results appear (propose → Apply → `onChanged` refetch). Reads + analytics
 * answer in chat.
 */
export function ManageClassCopilot({ onChanged }: { onChanged?: () => void }) {
  return (
    <TeacherCopilot
      skillName="manage-class"
      title="Class co-pilot"
      placeholder="Create a class, mint codes, or ask how a class is doing…"
      emptyText="Tell me what you'd like to do — create a class, mint join-codes, or check how a class is doing. I propose changes you Apply, and they appear in your list."
      parseProposal={parseClassProposal}
      proposalDescriptor={classProposalDescriptor}
      onApplyProposal={async (proposal) => {
        await applyClassProposal(proposal);
        onChanged?.();
      }}
    />
  );
}
