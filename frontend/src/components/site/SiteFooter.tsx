"use client";

import Link from "next/link";

import { LanguageSwitch } from "@/components/site/LanguageSwitch";
import { useT, type MessageKey } from "@/i18n";
import { BRANDING } from "@/lib/branding";
import {
  ENGINEERING_CREDIT,
  HOST_ATTRIBUTION,
  KU_ECOSYSTEM,
  outboundLinkProps,
} from "@/lib/ecosystem";

/**
 * SiteFooter — the one footer, carrying legal links, the KU ecosystem, and
 * the platform-engineering credit.
 *
 * Was `AppFooter`, which was mounted page-by-page and therefore reached only
 * 7 of 11 framing surfaces (`/guides` and `/lessons`, the two non-chat
 * surfaces people actually sit on, both missed it). It is now rendered
 * structurally by `app/(site)/layout.tsx`; the two surfaces with their own
 * shell (`/teacher`, `/lessons`) mount it themselves, and a test asserts they
 * still do.
 *
 * Deliberately NOT on `/chat/*` — that surface needs the vertical space for
 * the input bar and the workspace, and privacy/terms are one tap away via the
 * chat header. `SiteFooter.test.tsx` locks that exemption so a later refactor
 * cannot quietly add one.
 */

// 1.1.108 — the footer speaks the person's own language (the DA | EN switch),
// no longer both at once. Labels are message keys.
const APP_LINKS = [
  { href: "/guides", key: "guides" },
  { href: "/group", key: "join" },
  { href: "/teacher/sign-in", key: "teacherSignIn" },
] as const;

const ABOUT_LINKS = [
  { href: "/project", key: "aboutAipla" },
  { href: "/privacy", key: "privacy" },
  { href: "/terms", key: "terms" },
  { href: "/credits", key: "credits" },
] as const;

// The two KU links whose labels are ours to translate; the others are proper
// names. Keyed by href so the shared ecosystem data (also JSON-LD) stays as is.
const ECOSYSTEM_KEYS: Record<string, MessageKey<"SiteFooter">> = {
  "https://www.ind.ku.dk/projekter/artificial-intelligence-in-physics-learning-and-assessment-aipla/": "officialPage",
  "https://www.ind.ku.dk/Nyheder/nyheder-2026/aipla/": "announcement",
};

function ColumnHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground/70">
      {children}
    </h2>
  );
}

const linkClass =
  "underline-offset-2 hover:text-foreground hover:underline";

export function SiteFooter() {
  const t = useT("SiteFooter");
  return (
    <footer className="mt-16 border-t border-border print:hidden">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={BRANDING.logo.headerMark}
            alt=""
            aria-hidden="true"
            className="h-7 w-7"
          />
          <div className="text-sm font-medium text-foreground">
            {BRANDING.appName}
            <span className="ml-2 font-normal text-muted-foreground">
              {BRANDING.tagline}
            </span>
          </div>
          <LanguageSwitch className="ml-auto" />
        </div>

        <div className="mt-7 grid gap-7 text-xs text-muted-foreground sm:grid-cols-3">
          <nav aria-labelledby="footer-project">
            <ColumnHeading>
              <span id="footer-project">{t("project")}</span>
            </ColumnHeading>
            <ul className="flex flex-col gap-1.5">
              {KU_ECOSYSTEM.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    title={link.description}
                    className={linkClass}
                    {...outboundLinkProps()}
                  >
                    {ECOSYSTEM_KEYS[link.href] ? t(ECOSYSTEM_KEYS[link.href]) : link.label}
                    <span aria-hidden="true" className="ml-1 opacity-60">
                      ↗
                    </span>
                    <span className="sr-only"> {t("newTab")}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-app">
            <ColumnHeading>
              <span id="footer-app">{t("app")}</span>
            </ColumnHeading>
            <ul className="flex flex-col gap-1.5">
              {APP_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>
                    {t(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-about">
            <ColumnHeading>
              <span id="footer-about">{t("about")}</span>
            </ColumnHeading>
            <ul className="flex flex-col gap-1.5">
              {ABOUT_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>
                    {t(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-8 border-t border-border pt-5 text-[11px] leading-relaxed text-muted-foreground/90">
          <p>
            {t.rich("hosted", {
              ...HOST_ATTRIBUTION,
              b: (chunks) => <strong className="font-medium text-foreground/80">{chunks}</strong>,
            })}
          </p>
          <p className="mt-1.5">
            <a
              href={ENGINEERING_CREDIT.href}
              className={`font-medium ${linkClass}`}
              {...outboundLinkProps()}
            >
              {t("engineering")}
              <span aria-hidden="true" className="ml-1 opacity-60">
                ↗
              </span>
              <span className="sr-only"> {t("newTab")}</span>
            </a>{" "}
            {t("engineeringSuffix")}
          </p>
        </div>
      </div>
    </footer>
  );
}
