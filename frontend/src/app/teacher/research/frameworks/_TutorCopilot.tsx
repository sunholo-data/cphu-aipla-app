"use client";

import { TeacherCopilot } from "@/components/teacher/copilot";

import {
  type TutorProposal,
  parseTutorProposal,
  tutorProposalDescriptorFor,
} from "./tutorCopilotProposal";
import { useT } from "@/i18n";
import { useMemo } from "react";

/** UI copy, lifted out of JSX (1.1.108 M4) so a translator can reach it. */
// Copy lives in messages/*/teacher-research.json — 1.1.108.

/**
 * The tutor co-pilot (1.1.91 M2) — the fourth mount on the shared shell.
 *
 * Sits on the Approaches surface, beside the frameworks it edits, because that
 * is the surface a researcher already has open when the question arises. The
 * design doc's note that M2 "lands best on M1b + M1c rather than on a text box"
 * is exactly this: the structural editor had to exist first, and it does.
 *
 * ⚠️ **Apply does not write.** It hands the proposal to the page, which opens
 * the structure editor pre-filled. The existing researcher-gated
 * `PUT .../structure` stays the only path to a stored change, so what a
 * researcher signs off in the live preview is byte-identical to what is saved —
 * which is the property the whole layer exists to protect. A co-pilot that
 * wrote directly would have been a second write path with no preview.
 *
 * Researcher-only twice over: the skill is tagged `role:researcher`, and every
 * tool re-checks the claim server-side from the caller's uid.
 */
export function TutorCopilot({
  onProposal,
}: {
  /** Hand an applied proposal to the page, which opens the editor on it. */
  onProposal: (proposal: TutorProposal) => void;
}) {
  const t = useT("TutorCopilot");
  const tProposal = useT("TutorProposal");
  const descriptor = useMemo(() => tutorProposalDescriptorFor(tProposal), [tProposal]);
  return (
    <TeacherCopilot<TutorProposal>
      skillName="tutor-authoring-assistant"
      title={t("title")}
      placeholder={t("placeholder")}
      emptyText={t("empty")}
      testId="tutor-copilot"
      parseProposal={parseTutorProposal}
      proposalDescriptor={descriptor}
      // The effect is visible immediately — the editor opens on the proposal —
      // so the card removes itself rather than leaving a badge behind.
      dismissOnApply
      onApplyProposal={(proposal) => onProposal(proposal)}
    />
  );
}
