import { Settings as SettingsIcon } from "lucide-react";

import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

/**
 * Settings index — the nav destination for teacher account + class defaults.
 * Placeholder for now (P2); the default language / interaction style / voice
 * settings land here as their config docs ship, each as a SettingRow.
 */
export default function TeacherSettingsPage() {
  return (
    <TeacherPage title="Settings">
      <EmptyState
        icon={SettingsIcon}
        title="Teacher settings are coming here"
        description="Your account and class defaults — default language, interaction style, and voice — will live on this page."
      />
    </TeacherPage>
  );
}
