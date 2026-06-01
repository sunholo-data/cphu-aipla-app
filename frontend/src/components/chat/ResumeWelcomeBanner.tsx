"use client";

import { X } from "lucide-react";

interface ResumeWelcomeBannerProps {
  onDismiss: () => void;
}

export function ResumeWelcomeBanner({ onDismiss }: ResumeWelcomeBannerProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
      <div className="flex flex-col gap-0.5">
        <span>Continuing from your last session</span>
        <span className="text-xs text-blue-600 dark:text-blue-400">
          Fortsætter fra din forrige session
        </span>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 hover:bg-blue-100 dark:hover:bg-blue-900"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
