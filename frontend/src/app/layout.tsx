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
      <body className="font-sans bg-background text-foreground h-screen flex flex-col antialiased">
        <LocalModeBanner />
        <EnvironmentBanner />
        <div className="flex-1 min-h-0 flex flex-col overflow-auto">
          <AppProviders>{children}</AppProviders>
        </div>
      </body>
    </html>
  );
}
