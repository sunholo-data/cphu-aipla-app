import type { MetadataRoute } from "next";

import { BRANDING } from "@/lib/branding";

/**
 * PWA manifest — served at `/manifest.webmanifest` by the App Router.
 *
 * Why AIPLA wants one (MOBILE-1, 2026-08-13): students run this on a phone
 * shared by three, outdoors, on school wifi. `display: "standalone"` drops the
 * browser chrome, which on a 390x844 phone is the difference between seeing the
 * chat composer and scrolling for it — the same vertical budget the `h-dvh` fix
 * was about. Add-to-home-screen also gives the lesson a real icon instead of a
 * Safari bookmark, which matters when a teacher is talking thirty students onto
 * the same page in a schoolyard.
 *
 * Deliberately NOT setting `viewport-fit=cover`. Without it, iOS in standalone
 * mode insets the web content into the safe area itself and letterboxes with
 * `background_color`, so nothing can land under the notch or the home
 * indicator. Edge-to-edge would look better, but it makes every fixed-position
 * surface (chat composer, teacher bottom nav, the environment banner)
 * responsible for its own `env(safe-area-inset-*)` padding — a wider change
 * than this one, and one that fails ugly if a single surface is missed. The
 * letterbox is the correct-by-default choice for a first PWA.
 *
 * `orientation` is deliberately unset: the sims are more usable in landscape
 * and the chat in portrait, so locking either is wrong.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRANDING.appName} — AI i fysikundervisning`,
    short_name: BRANDING.appName,
    description:
      "Fysik-tutor til gymnasiet. Tilslut din gruppe med koden fra din lærer. / " +
      "Physics tutor for upper-secondary. Join your group with the code from your teacher.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // KU red — matches `--brand` in globals.css and the icon tile. This is the
    // colour the OS paints the status bar / task switcher with.
    theme_color: "#901a1e",
    background_color: "#ffffff",
    // Danish-first: the students are Danish, the tutor answers in Danish, and
    // the join page leads in Danish.
    lang: "da",
    dir: "ltr",
    categories: ["education"],
    icons: [
      { src: "/images/logo/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/images/logo/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Maskable is a SEPARATE asset, not the same tile rescaled: Android crops
      // to a platform-chosen shape, so this one is full-bleed with the glyph
      // inside the inner 80% safe zone.
      {
        src: "/images/logo/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
