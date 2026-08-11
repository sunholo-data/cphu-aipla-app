import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The footer used to be mounted page-by-page, and had already been forgotten
 * on `/guides` and `/lessons` — the two non-chat surfaces users actually sit
 * on. It is now structural (`app/(site)/layout.tsx`), and this test is what
 * keeps it that way: a new public page added outside the group fails CI by
 * name rather than silently shipping without a footer.
 *
 * Three categories, all deliberate:
 *
 *  - `(site)`      — chrome comes from the group layout. Nothing to assert
 *                    per page; being in the group IS the assertion.
 *  - own-shell     — surfaces with bespoke chrome (`/teacher`'s nav shell,
 *                    `/lessons`' group-code bar). They must mount SiteFooter
 *                    THEMSELVES, so we check they still do.
 *  - no-footer     — `/chat/*` only. Needs the vertical space for the input
 *                    bar and workspace. Asserted so a refactor cannot quietly
 *                    add one.
 *  - non-public    — dev/debug and route handlers. Not framing surfaces.
 */

const APP_DIR = join(__dirname, "..");

/** Route segments whose pages own their chrome and mount SiteFooter directly. */
const OWN_SHELL = ["teacher", "lessons"];
/** Segments that must NOT render a footer. */
const NO_FOOTER = ["chat"];
/** Segments that are not public framing surfaces. */
const NON_PUBLIC = ["dev", "skills", "api"];

function findPages(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      findPages(full, acc);
    } else if (entry === "page.tsx") {
      acc.push(full);
    }
  }
  return acc;
}

/** First path segment of a route, ignoring the `(group)` wrapper. */
function topSegment(pagePath: string): string {
  const rel = relative(APP_DIR, pagePath);
  const segments = rel.split("/").filter((s) => !s.startsWith("("));
  return segments[0] === "page.tsx" ? "" : segments[0];
}

function isInSiteGroup(pagePath: string): boolean {
  return relative(APP_DIR, pagePath).startsWith("(site)/");
}

describe("route chrome coverage", () => {
  const pages = findPages(APP_DIR);

  it("finds the app's pages at all (guards against a broken walk)", () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  it("every public page is in the (site) group or explicitly categorised", () => {
    const uncategorised = pages.filter((p) => {
      if (isInSiteGroup(p)) return false;
      const seg = topSegment(p);
      return (
        !OWN_SHELL.includes(seg) &&
        !NO_FOOTER.includes(seg) &&
        !NON_PUBLIC.includes(seg)
      );
    });

    expect(
      uncategorised.map((p) => relative(APP_DIR, p)),
      "New public page(s) outside app/(site)/ would ship with no footer. " +
        "Either move the route into the (site) group, or — if it owns its " +
        "chrome — add its segment to OWN_SHELL here and mount <SiteFooter /> " +
        "in the page itself.",
    ).toEqual([]);
  });

  it("own-shell surfaces mount SiteFooter themselves", () => {
    for (const segment of OWN_SHELL) {
      const files = pages.filter((p) => topSegment(p) === segment);
      expect(files.length, `no pages found under /${segment}`).toBeGreaterThan(0);

      // The footer may be mounted on the page or on its shell/layout, so look
      // across the whole segment rather than requiring it on every page.
      const segmentDir = join(APP_DIR, segment);
      const sources = findAllSources(segmentDir);
      const mounts = sources.some((s) => s.includes("<SiteFooter />"));
      expect(
        mounts,
        `/${segment} owns its chrome, so it must mount <SiteFooter /> itself`,
      ).toBe(true);
    }
  });

  it("the chat surface renders no footer", () => {
    const sources = findAllSources(join(APP_DIR, "chat"));
    for (const src of sources) {
      expect(
        src.includes("<SiteFooter />"),
        "/chat/* is deliberately footer-free — it needs the vertical space " +
          "for the input bar and workspace. Remove the mount, or change this " +
          "test with a reason.",
      ).toBe(false);
    }
  });
});

function findAllSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      findAllSources(full, acc);
    } else if (entry.endsWith(".tsx")) {
      acc.push(readFileSync(full, "utf-8"));
    }
  }
  return acc;
}
