"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Eye } from "lucide-react";

import {
  ACCESS_REQUEST_PATH,
  getAccessTier,
  subscribeAccessTier,
  TIER_PILOT,
} from "@/lib/accessTier";
import { switchGoogleAccount } from "@/lib/firebase";
import { useSignedInEmail } from "@/hooks/useSignedInEmail";
import { useT } from "@/i18n";

/**
 * The visitor nudge (ACCESS-1 M4).
 *
 * Shown on teacher surfaces when the signed-in account is not on the access
 * register. Deliberately non-blocking: the whole premise of the design is that
 * an uninvited person should be able to walk the entire product. This tells
 * them what they are seeing and how to get the live version — it does not stand
 * in their way.
 *
 * Renders nothing at all for a pilot teacher, so the ordinary case pays no
 * chrome.
 */
export function VisitorAccessBanner() {
  const [tier, setTier] = useState(getAccessTier);
  const email = useSignedInEmail();
  const t = useT("VisitorAccessBanner");

  useEffect(() => subscribeAccessTier(setTier), []);

  if (tier === TIER_PILOT) return null;

  return (
    <div
      role="status"
      aria-label={t("ariaLabel")}
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-[12px] text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{t("exploring")}</span>
      {/* 1.1.124 — NAME THE ACCOUNT. A teacher who IS on the register, signed
          in under a second Google account they did not choose, sees this banner
          and has no way to tell that is what happened. The address is the whole
          diagnosis, and the browser has known it all along. */}
      {email ? (
        <span className="opacity-80">
          {t.rich("signedInAs", { email, b: (c) => <strong className="font-semibold">{c}</strong> })}
        </span>
      ) : null}
      <Link
        href={ACCESS_REQUEST_PATH}
        className="font-medium underline underline-offset-2 hover:no-underline"
      >
        {t("join")}
      </Link>
      {email ? (
        <button
          type="button"
          onClick={() => {
            void switchGoogleAccount().catch(() => {});
          }}
          className="font-medium underline underline-offset-2 hover:no-underline"
        >
          {t("switchAccount")}
        </button>
      ) : null}
    </div>
  );
}
