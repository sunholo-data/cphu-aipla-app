"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { UserLocaleProvider } from "@/i18n/userLocale";

/**
 * Composite provider tree. PHASE1-UI will add A2UI + CopilotKit providers here.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <UserLocaleProvider>
      <AuthProvider>{children}</AuthProvider>
    </UserLocaleProvider>
  );
}
