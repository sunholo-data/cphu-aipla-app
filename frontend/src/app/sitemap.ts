import type { MetadataRoute } from "next";

import { PROJECT_ALL_PAGES } from "@/lib/projectContent";
import { PUBLIC_SITE_ORIGIN } from "@/lib/publicSite";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes: Array<{ path: string; priority: number; lastModified?: string }> = [
    { path: "", priority: 1 },
    { path: "/project", priority: 0.9 },
    ...PROJECT_ALL_PAGES.map((page) => ({
      path: `/project/${page.slug}`,
      priority: page.nav ? 0.8 : 0.7,
      lastModified: page.reviewed,
    })),
    { path: "/guides", priority: 0.7 },
    { path: "/privacy", priority: 0.3 },
    { path: "/terms", priority: 0.3 },
  ];

  return routes.map(({ path, priority, lastModified }) => ({
    url: `${PUBLIC_SITE_ORIGIN}${path}`,
    lastModified: new Date(lastModified ?? "2026-08-04"),
    changeFrequency: path.startsWith("/project") ? "monthly" as const : "yearly" as const,
    priority,
  }));
}
