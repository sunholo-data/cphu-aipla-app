import { NextResponse, type NextRequest } from "next/server";

import { isPublicSiteHost } from "@/lib/publicSite";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (!isPublicSiteHost(request.headers.get("host"))) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/|favicon.ico).*)"],
};
