import { type NextRequest, NextResponse } from "next/server";

import { isPublicSiteHost, PUBLIC_SITE_ORIGIN } from "@/lib/publicSite";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const isPublic = isPublicSiteHost(request.headers.get("host"));
  const body = isPublic
    ? `User-agent: *\nAllow: /\nSitemap: ${PUBLIC_SITE_ORIGIN}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n";
  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
