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

  useEffect(() => subscribeAccessTier(setTier), []);

  if (tier === TIER_PILOT) return null;

  return (
    <div
      role="status"
      aria-label="Exploring with a recorded demonstration"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-[12px] text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Du udforsker AIPLA med en optaget demonstration.{" "}
        <span className="opacity-80">
          You&rsquo;re exploring AIPLA with a recorded demonstration.
        </span>
      </span>
      <Link
        href={ACCESS_REQUEST_PATH}
        className="font-medium underline underline-offset-2 hover:no-underline"
      >
        Bliv en del af programmet / Join the programme
      </Link>
    </div>
  );
}
