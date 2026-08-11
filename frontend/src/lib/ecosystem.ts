/**
 * ecosystem.ts — the outbound links that place AIPLA in its institutional
 * context, plus the platform-engineering credit.
 *
 * One source of truth so the footer, the /project prose, and the JSON-LD
 * `sameAs` block cannot drift apart. Before this file the three ind.ku.dk
 * URLs lived only inside `frontend/content/project/*.md` body text, so they
 * were invisible from every surface except /project.
 *
 * All four ku.dk URLs verified live 2026-08-11.
 *
 * NOTE ON REFERRER: every link here is rendered with `referrerPolicy` set to
 * "no-referrer". The class join link carries the group code in the URL
 * (`/group?code=...`), so a default Referer on an outbound click would hand
 * that code to ind.ku.dk and sunholo.com. Use `outboundLinkProps()` rather
 * than hand-writing the attributes.
 */

export interface EcosystemLink {
  href: string;
  /** Label as shown. Bilingual pairs follow the app's `Dansk / English` idiom. */
  label: string;
  /** Longer description — used for the link title and by the JSON-LD block. */
  description: string;
}

/**
 * Official University of Copenhagen pages describing the project.
 * The ind.ku.dk project page is the authoritative record: it carries the
 * formal description, the funder, the period, and the project lead.
 */
export const KU_ECOSYSTEM: readonly EcosystemLink[] = [
  {
    href: "https://www.ind.ku.dk/projekter/artificial-intelligence-in-physics-learning-and-assessment-aipla/",
    label: "Officiel projektside / Official project page",
    description:
      "The University of Copenhagen's formal record of the AIPLA project — description, funding period, and contacts.",
  },
  {
    href: "https://www.ind.ku.dk/english/research/center-for-digital-education/",
    label: "Center for Digital Education",
    description:
      "The research centre AIPLA sits within — a collaboration between the Department of Computer Science and the Department of Science Education.",
  },
  {
    href: "https://www.ind.ku.dk/Nyheder/nyheder-2026/aipla/",
    label: "Projektomtale / Project announcement",
    description:
      "“Nyt projekt skal teste AI i fysikklassen: AI må gerne tage det kedelige” — 26 March 2026.",
  },
  {
    href: "https://www.ind.ku.dk/",
    label: "Institut for Naturfagenes Didaktik",
    description:
      "The Department of Science Education, University of Copenhagen — the project's host department.",
  },
] as const;

/** Who built and runs the AI platform underneath AIPLA. */
export const ENGINEERING_CREDIT = {
  href: "https://www.sunholo.com",
  label: "Sunholo",
  prefix: "AI platform engineering by",
} as const;

/** Institutional attribution shown above the credit line. */
export const HOST_ATTRIBUTION = {
  department: "Institut for Naturfagenes Didaktik",
  university: "Københavns Universitet",
  funder: "Novo Nordisk Foundation",
  period: "2026–2028",
} as const;

/**
 * Attributes every outbound link must carry. `no-referrer` is the load-bearing
 * one — see the referrer note at the top of this file.
 */
export function outboundLinkProps() {
  return {
    target: "_blank",
    rel: "noopener noreferrer",
    referrerPolicy: "no-referrer",
  } as const;
}
