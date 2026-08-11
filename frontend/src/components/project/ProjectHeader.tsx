import { SiteHeader } from "@/components/site/SiteHeader";

/**
 * ProjectHeader — /project's header.
 *
 * Was a standalone near-duplicate of what is now `SiteHeader` (same logo,
 * same layout, same nav shape). It is kept as a thin named wrapper because
 * /project wants a different primary CTA: on the public project pages the
 * call to action is "open the app", whereas everywhere else it is "join your
 * group".
 */
export function ProjectHeader() {
  return (
    <SiteHeader
      // `wide` so the logo lines up with /project's max-w-7xl sidebar layout.
      width="wide"
      cta={{ href: "/", label: "Åbn AIPLA / Open AIPLA" }}
    />
  );
}
