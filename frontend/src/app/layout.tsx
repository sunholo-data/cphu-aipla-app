import type { Metadata } from "next";
import { EnvironmentBanner } from "@/components/EnvironmentBanner";
import { LocalModeBanner } from "@/components/LocalModeBanner";
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
  },
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
        <LocalModeBanner />
        <EnvironmentBanner />
        <div className="flex-1 min-h-0 flex flex-col overflow-auto">
          <AppProviders>{children}</AppProviders>
        </div>
      </body>
    </html>
  );
}
