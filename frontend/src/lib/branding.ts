/**
 * Branding — the single file a public fork rebrands.
 *
 * Every user-visible product string in chrome (page titles, marketing
 * copy, contact email, the welcome screen logo path) lives here. A
 * downstream fork rewrites this one file; everything else is generic
 * protocol-stack code.
 *
 * Upstream identity: Sunholo (the public template at
 * sunholo-data/ai-protocol-platform). Downstream consumers (Aitana,
 * AIPLA, etc.) override this object in their own forks.
 *
 * NOT in scope here:
 * - Skill content (lives in Firestore + skill templates)
 * - User-uploaded assets (lives in GCS)
 * - SVG logo file itself (lives in /public/images/logo/, swap the file)
 */

export const BRANDING = {
  /** Short product name used in page <title>, banners, marketing hero. */
  appName: "AIPLA",

  /** One-line product tagline shown under the logo on the welcome screen. */
  tagline: "AI in Physics Learning and Assessment",

  /** Long form description used in <meta name="description">. */
  description: "Research pilot — generative AI for upper-secondary (stx) physics in Denmark. University of Copenhagen Center for Digital Education.",

  /** Public-facing logo paths. AIPLA uses two marks:
   * - The official Københavns Universitet coat-of-arms (square SVG
   *   from Wikimedia Commons, CC BY-SA 4.0 — see CREDITS.md) for
   *   the welcome-screen hero. Signals institutional backing.
   * - A small square AIPLA-"A" mark (from the scoping site's
   *   favicon.svg, KU red on a rounded white tile) for the browser
   *   tab and chat avatar — works at favicon sizes where the
   *   detailed crest pixelates. */
  logo: {
    /** Browser tab favicon — square. AIPLA "A" on KU-red. */
    favicon: "/images/logo/aipla-mark.svg",
    /** Welcome-screen mark. Official KU coat-of-arms SVG. */
    heroAnimated: "/images/logo/ku-logo.svg",
    /** Chat top-bar header (28px). Official KU coat-of-arms — at this
     * size the crest reads as a red disc with crown silhouette, which
     * signals institutional identity to teachers without being mistaken
     * for a generic app icon. */
    headerMark: "/images/logo/ku-logo.svg",
    /** Per-message chat avatar (20px inside an orange-gradient circle).
     * Stays on the AIPLA "A" — the KU crest pixelates illegibly at
     * 20px and the gradient circle would conflict with the KU red. */
    chatAvatar: "/images/logo/sunholo-logo.svg",
  },

  /** Contact / community links. AIPLA repo is private at sunholo-data/cphu-aipla-app. */
  contact: {
    email: "ind@ind.ku.dk",
    githubRepo: "https://github.com/sunholo-data/cphu-aipla-app",
  },
} as const;

export type Branding = typeof BRANDING;
