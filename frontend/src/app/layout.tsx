import type { Metadata, Viewport } from "next";
import { EnvironmentBanner } from "@/components/EnvironmentBanner";
import { LocalModeBanner } from "@/components/LocalModeBanner";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { BRANDING } from "@/lib/branding";
import { PUBLIC_SITE_ORIGIN } from "@/lib/publicSite";
import { AppProviders } from "@/providers/AppProviders";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE_ORIGIN),
  title: {
    default: BRANDING.appName,
    template: `%s — ${BRANDING.appName}`,
  },
  description: BRANDING.description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: BRANDING.appName,
    title: BRANDING.appName,
    description: BRANDING.description,
  },
  icons: {
    icon: BRANDING.logo.favicon,
    // iOS ignores the manifest's icons for add-to-home-screen and reads this.
    // Without it a home-screen AIPLA is a screenshot of the page.
    apple: "/images/logo/apple-touch-icon.png",
  },
};

/**
 * MOBILE-1 — `theme_color` paints the status bar in standalone mode; declaring
 * it here as well as in the manifest covers browsers that read the meta tag and
 * not the manifest.
 *
 * `viewport-fit` is deliberately left at the default (`auto`). See the note in
 * `manifest.ts`: iOS then insets standalone content into the safe area itself,
 * so nothing can land under the notch or the home indicator without every
 * fixed-position surface opting in to `env(safe-area-inset-*)` first.
 */
export const viewport: Viewport = {
  themeColor: "#901a1e",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* h-dvh, not h-screen: `100vh` on iOS Safari / Chrome Android is the
          LARGE viewport (URL bar collapsed), so a `100vh` body is taller than
          what the student can actually see and the pinned chat composer sits
          below the fold until the toolbar retracts. `100dvh` tracks the live
          viewport. Desktop is unaffected — the two units are equal there. */}
      <body className="font-sans bg-background text-foreground h-dvh flex flex-col antialiased">
        <ServiceWorkerRegistration />
        <LocalModeBanner />
        <EnvironmentBanner />
        <div className="flex-1 min-h-0 flex flex-col overflow-auto">
          <AppProviders>{children}</AppProviders>
        </div>
      </body>
    </html>
  );
}
