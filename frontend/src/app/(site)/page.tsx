import { BackendHealthBadge } from "@/components/BackendHealthBadge";
import { SignInButton } from "@/components/SignInButton";
import { HomeEntryLinks } from "@/components/site/HomeEntryLinks";
import { skillHref } from "@/components/navigation/skillHref";
import { BRANDING } from "@/lib/branding";
import Link from "next/link";

interface SkillSummary {
  skillId: string;
  ownerId: string;
  slug: string | null;
  name: string;
  description: string;
}

async function getMarketplaceSkills(): Promise<SkillSummary[]> {
  try {
    const backendUrl =
      process.env.BACKEND_URL ?? "http://localhost:1956";
    const res = await fetch(`${backendUrl}/api/skills/marketplace?limit=10`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

/**
 * The footer (attribution, legal links, the KU ecosystem, and the
 * platform-engineering credit) is rendered structurally by
 * `app/(site)/layout.tsx` — it is no longer mounted per page.
 *
 * No `SiteHeader` here: this IS the landing, and its CTA stack already
 * carries the Guides / About links a header would duplicate.
 */
export default async function HomePage() {
  // In anonymous-group-id mode, the home page is a single-CTA landing that
  // routes students to /group. Showing the marketplace shelf with
  // /chat/@aitana-platform/<slug> links is misleading — those routes
  // require a group token the user doesn't have yet.
  const isAnonymousGroupMode =
    process.env.NEXT_PUBLIC_AUTH_MODE === "anonymous_group_id";
  const skills = isAnonymousGroupMode ? [] : await getMarketplaceSkills();

  return (
    <main className="flex flex-col items-center justify-center px-8 py-16 sm:py-24">
      <div className="flex flex-col items-center gap-6 max-w-2xl text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={BRANDING.logo.heroAnimated}
          alt={BRANDING.appName}
          className="w-32 h-32"
        />
        <h1 className="text-4xl font-semibold tracking-tight">
          {BRANDING.appName}
        </h1>
        <p className="text-muted-foreground text-lg">{BRANDING.tagline}</p>

        {isAnonymousGroupMode ? (
          // AIPLA v0.1 — anonymous group join is the primary student-facing
          // auth path. Students go straight to /group; teachers get a quiet
          // secondary link to the email/Google sign-in (ADR-001 teacher auth).
          <HomeEntryLinks />
        ) : (
          <SignInButton />
        )}
        <BackendHealthBadge />

        {skills.length > 0 && (
          <div className="w-full mt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
              Public skills
            </p>
            <ul className="flex flex-col gap-2 w-full">
              {skills.map((skill) => (
                <li key={skill.skillId}>
                  <Link
                    href={skillHref(skill)}
                    className="flex flex-col items-start px-4 py-3 rounded-lg border border-border hover:bg-accent transition-colors text-left w-full"
                  >
                    <span className="font-medium text-sm">{skill.name}</span>
                    {skill.description && (
                      <span className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                        {skill.description}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
