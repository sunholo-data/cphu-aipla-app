"use client";

import { X } from "lucide-react";

import { useT } from "@/i18n";

interface ResumeWelcomeBannerProps {
  onDismiss: () => void;
}

export function ResumeWelcomeBanner({ onDismiss }: ResumeWelcomeBannerProps) {
  const t = useT("ResumeWelcomeBanner");
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
      {/* 1.1.108: was both languages stacked; now the activity's one. */}
      <span>{t("continuing")}</span>
      <button
        onClick={onDismiss}
        aria-label={t("dismiss")}
        className="shrink-0 rounded p-1 hover:bg-blue-100 dark:hover:bg-blue-900"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
