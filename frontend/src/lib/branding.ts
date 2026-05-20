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

  /** Public-facing logo paths. v0.1 ships with a plain text wordmark
   * (Open Question 2 in docs/design/aipla/v0.1.0-jutland/jutland-demo.md
   * resolved to fallback) — logo files still point at the inherited
   * paths so any consumer that hard-codes the path doesn't break;
   * swap SVGs in /public/images/logo/ to install proper AIPLA marks. */
  logo: {
    /** Browser tab favicon (SVG — works in all modern browsers). */
    favicon: "/images/logo/sunholo-logo.svg",
    /** Welcome-screen mark (SVG). */
    heroAnimated: "/images/logo/sunholo-logo.svg",
    /** Square chat-message-bubble avatar (SVG). */
    chatAvatar: "/images/logo/sunholo-logo.svg",
  },

  /** Contact / community links. AIPLA repo is private at sunholo-data/cphu-aipla-app. */
  contact: {
    email: "mark@aitanalabs.com",
    githubRepo: "https://github.com/sunholo-data/cphu-aipla-app",
  },
} as const;

export type Branding = typeof BRANDING;
