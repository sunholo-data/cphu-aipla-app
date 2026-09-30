"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAnonymousGroupAuth } from "@/contexts/AnonymousGroupAuthProvider";
import { isAnonymousGroupAuthMode } from "@/lib/anonymousGroupAuth";
import { useT } from "@/i18n";

export function TeacherGroupGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const inAnonMode = isAnonymousGroupAuthMode();
  const groupAuth = useAnonymousGroupAuth();
  const t = useT("TeacherGroupGate");

  useEffect(() => {
    if (!inAnonMode) return;
    if (groupAuth.status === "idle") {
      router.replace("/group");
    }
  }, [inAnonMode, groupAuth.status, router]);

  if (inAnonMode && groupAuth.status === "idle") {
    return (
      <p className="px-4 py-8 text-sm text-muted-foreground">
        {t("loading")}
      </p>
    );
  }
  return <>{children}</>;
}
