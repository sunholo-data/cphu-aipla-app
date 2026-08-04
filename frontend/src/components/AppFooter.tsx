import Link from "next/link";
import { BRANDING } from "@/lib/branding";

/**
 * AppFooter — slim host-attribution + legal-links footer for the
 * framing pages (/, /group). Deliberately NOT mounted on /chat/* —
 * the chat surface needs the vertical space for the input bar and
 * the workspace, and the privacy/terms can be reached by navigating
 * back to home.
 *
 * Mount this once per framing page so /privacy and /terms are always
 * one tap away. Both pages exist as placeholder stubs (see
 * frontend/src/app/{privacy,terms}/page.tsx) — they say "draft pending
 * DPIA sign-off" for now. v1 fills in real copy when the Strand A
 * compliance review lands.
 */
export function AppFooter() {
  return (
    <footer className="mt-12 flex flex-col items-center gap-3 text-center text-[11px] text-muted-foreground/80 max-w-2xl">
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={BRANDING.logo.headerMark}
          alt=""
          aria-hidden="true"
          className="h-5 w-5 opacity-80"
        />
        <span>
          Hosted by{" "}
          <strong className="font-medium">Institut for Naturfagenes Didaktik</strong>
          , Københavns Universitet
        </span>
      </div>

      <nav className="flex flex-wrap justify-center gap-3 text-[10px]">
        <Link
          href="/project"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          About AIPLA
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/privacy"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          Privatlivspolitik / Privacy
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/terms"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          Vilkår / Terms
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/credits"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          Krediteringer / Credits
        </Link>
      </nav>
    </footer>
  );
}
