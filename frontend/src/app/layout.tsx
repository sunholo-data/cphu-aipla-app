import type { Metadata } from "next";
import { LocalModeBanner } from "@/components/LocalModeBanner";
import { BRANDING } from "@/lib/branding";
import { AppProviders } from "@/providers/AppProviders";
import "./globals.css";

export const metadata: Metadata = {
  title: BRANDING.appName,
  description: BRANDING.description,
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
        <div className="flex-1 min-h-0 flex flex-col overflow-auto">
          <AppProviders>{children}</AppProviders>
        </div>
      </body>
    </html>
  );
}
