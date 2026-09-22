"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertCircle, Loader2, UserRoundCog } from "lucide-react";

import { ACCESS_REQUEST_PATH } from "@/lib/accessTier";
import { switchGoogleAccount } from "@/lib/firebase";
import { useSignedInEmail } from "@/hooks/useSignedInEmail";

/**
 * What a 402 from the spend gate should say (1.1.124).
 *
 * The backend's refusal was already clear about WHAT was refused — "uploading
 * curriculum to the tutor is available to programme participants". What it
 * could not say is the thing that actually costs the hour: WHICH ACCOUNT is
 * being refused, and what to do about it.
 *
 * The failure this exists for: a KU professor was invited to the register under
 * his university address, but Google silently auto-selected the personal Gmail
 * already open in his browser (see `googleProvider` in lib/firebase.ts). Every
 * paid surface then refused him. From the outside the product looked broken by
 * an admin who had, in fact, registered him correctly — the grant and the
 * signed-in identity were two different addresses, and NOTHING on screen showed
 * the second one. Diagnosing it took a Firestore read plus a Cloud Logging trawl
 * to recover a uid, for a fact the browser knew all along.
 *
 * So: name the account, offer the switch, keep the join link for someone who
 * genuinely has no grant. Those are the only three outcomes.
 */
export function SpendDeniedNotice({ message }: { message?: string }) {
  const email = useSignedInEmail();
  const [switching, setSwitching] = useState(false);

  async function handleSwitch() {
    setSwitching(true);
    try {
      await switchGoogleAccount();
    } catch {
      // The popup was dismissed or blocked. Nothing to report — they are still
      // signed in as before, and the notice they are reading still applies.
      setSwitching(false);
    }
  }

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          {message ??
            "Upload til tutoren er forbeholdt deltagere i programmet. / Uploading to the tutor is for programme participants."}
        </p>
      </div>

      {email ? (
        <p className="pl-6">
          Du er logget ind som <strong className="font-semibold">{email}</strong>.{" "}
          <span className="opacity-80">You are signed in as this account.</span>{" "}
          Hvis du er inviteret under en anden adresse (fx din universitetsmail),
          så skift konto.{" "}
          <span className="opacity-80">
            If you were invited under a different address — your university mail,
            for instance — switch account.
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 pl-6">
        <button
          type="button"
          onClick={handleSwitch}
          disabled={switching}
          className="flex items-center gap-1.5 rounded border border-amber-400 px-2.5 py-1 font-medium hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700 dark:hover:bg-amber-900"
        >
          {switching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <UserRoundCog className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Skift konto / Switch account
        </button>
        <Link
          href={ACCESS_REQUEST_PATH}
          className="font-medium underline underline-offset-2 hover:no-underline"
        >
          Bliv en del af programmet / Join the programme
        </Link>
      </div>
    </div>
  );
}
