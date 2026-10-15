/**
 * The sim library as anyone may see it: the live built-in sims and the teacher
 * sims a researcher signed off for the shared library — the same set `/mcp`
 * offers. Served without sign-in by `GET /api/public/sims` (backend
 * `protocols/artefact_routes.public_router`), so the homepage gallery and a
 * student's lesson cards can show a sim's screenshot. A class-level teacher sim
 * is not in it, and its screenshot 404s here like a missing one.
 */

/** One sim in the public library: only what a visitor needs to recognise it. */
export interface PublicSim {
  id: string;
  displayName: string;
  description: string;
  topics: string[];
  levels: string[];
  language: string;
  source?: "builtin" | "teacher";
}

/** A library sim's screenshot, for anyone (no sign-in): `700` at rest, `driven` after use. */
export function publicSimScreenshotUrl(id: string, shot: "700" | "driven" = "700"): string {
  return `/api/proxy/api/public/sims/${encodeURIComponent(id)}/screenshot/${shot}`;
}

/** The short handle of a sim — "Boldkast" from "Boldkast — projektilbevægelse". */
export function shortSimName(displayName: string): string {
  return displayName.split(/\s+[—–]\s+/)[0].trim() || displayName;
}
