import { SiteFooter } from "@/components/site/SiteFooter";
import { BRANDING } from "@/lib/branding";
import { HOST_ATTRIBUTION, KU_ECOSYSTEM } from "@/lib/ecosystem";
import { PUBLIC_SITE_ORIGIN } from "@/lib/publicSite";

/**
 * schema.org `ResearchProject` describing AIPLA, with `sameAs` pointing at the
 * University of Copenhagen pages. `sameAs` is the established vocabulary for
 * "this web presence is the same entity as those" — the alternative was
 * inventing a bespoke "related links" convention, and the app already emits
 * Open Graph metadata, so structured metadata is an existing idiom here.
 */
const PROJECT_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "ResearchProject",
  name: BRANDING.appName,
  alternateName: BRANDING.tagline,
  description: BRANDING.description,
  url: PUBLIC_SITE_ORIGIN,
  sameAs: KU_ECOSYSTEM.map((link) => link.href),
  parentOrganization: {
    "@type": "CollegeOrUniversity",
    name: HOST_ATTRIBUTION.university,
    alternateName: "University of Copenhagen",
    url: "https://www.ku.dk/",
    department: {
      "@type": "Organization",
      name: HOST_ATTRIBUTION.department,
      url: "https://www.ind.ku.dk/",
    },
  },
  funder: { "@type": "Organization", name: HOST_ATTRIBUTION.funder },
} as const;

/**
 * Layout for the public framing surfaces — `/`, `/guides`, `/group`,
 * `/credits`, `/privacy`, `/terms`, `/workshop`, `/project/*`.
 *
 * A route group `(site)` rather than a component every page must remember to
 * import: the parentheses mean the segment does NOT appear in any URL, so
 * `(site)/guides/page.tsx` still serves `/guides`, while the chrome becomes
 * structural. That is the whole point — `AppFooter` was mounted by hand and
 * had already been forgotten on `/guides` and `/lessons`.
 *
 * Header is NOT rendered here. `/project` brings its own (header + nav
 * sidebar) and `/` is a full-bleed landing, so each page renders `SiteHeader`
 * where it wants it. The footer is the part that must never be forgotten, and
 * that is the part this layout owns.
 *
 * Outside this group by design:
 * - `/chat/*`   — no footer at all (needs the vertical space)
 * - `/teacher`, `/lessons` — own shells; they mount `SiteFooter` themselves
 * - `/dev`, `/skills`, `/api` — not public framing
 *
 * `__tests__/route-chrome-coverage.test.ts` enforces all of the above.
 */
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <script
        type="application/ld+json"
        // Serialised from a module-level literal — no user input reaches it.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(PROJECT_JSON_LD) }}
      />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
