"use client";

import { useT } from "@/i18n";

import type { CopilotLabels } from "./types";

/** The co-pilot's own chrome in the teacher's language (1.1.108 M2), with any
 *  per-surface overrides on top. `DEFAULT_LABELS` stays as the English shape of
 *  record for code outside a component. */
export function useCopilotLabels(overrides?: Partial<CopilotLabels>): CopilotLabels {
  const t = useT("TeacherCopilot");
  return {
    apply: t("apply"),
    useEdited: t("useEdited"),
    edit: t("edit"),
    dismiss: t("dismiss"),
    applied: t("applied"),
    thinking: t("thinking"),
    editAriaLabel: t("editAriaLabel"),
    ...overrides,
  };
}
