"use client";

import { FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "@/i18n";
import { fetchWithTeacherAuth } from "@/lib/apiClient";
import { cn } from "@/lib/utils";

/** Where a catalogued sim's screenshot is served (backend artefacts/screenshots.py). */
export function simScreenshotUrl(id: string, shot: "700" | "driven" = "700"): string {
  return `/api/proxy/api/artefacts/${encodeURIComponent(id)}/screenshot/${shot}`;
}

// A sim's screenshot sits behind the teacher's sign-in, so an <img src> cannot
// fetch it: it comes down once as a blob and every thumbnail of that sim on the
// page shares the object URL. A failure is remembered too (null), so a sim with
// no screenshot does not refetch on every render.
const blobUrls = new Map<string, Promise<string | null>>();

function loadAuthed(url: string): Promise<string | null> {
  let p = blobUrls.get(url);
  if (!p) {
    p = fetchWithTeacherAuth(url)
      .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
      .catch(() => null);
    blobUrls.set(url, p);
  }
  return p;
}

/** The image URL to render: a plain URL as is, an API path once fetched (null until then, or if absent). */
function useThumbnailSrc(thumbnail: string | null | undefined): string | null | undefined {
  // The public library route needs no sign-in, so it can be a plain <img src>.
  const authed = !!thumbnail && thumbnail.startsWith("/api/proxy/") && !thumbnail.startsWith("/api/proxy/api/public/");
  const [src, setSrc] = useState<string | null | undefined>(authed ? undefined : thumbnail);
  useEffect(() => {
    if (!thumbnail || !authed) {
      setSrc(thumbnail);
      return;
    }
    let alive = true;
    setSrc(undefined);
    void loadAuthed(thumbnail).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [thumbnail, authed]);
  return src;
}

// A small palette of restrained accent tiles. The sim id picks one
// deterministically, so a given sim always wears the same colour across the
// site — a stable visual handle even before a real screenshot exists.
const TILES = [
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
];

function tileFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TILES[h % TILES.length];
}

function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface SimThumbnailProps {
  /** Sim catalogue id — picks the deterministic accent tile. */
  id: string;
  displayName: string;
  /** A real screenshot/preview image, when available. */
  thumbnail?: string | null;
  /** Tailwind size classes — defaults to a 40px square. */
  className?: string;
  /** No screenshot: draw the monogram tile (default), or nothing at all — for a
   *  large preview, where a big empty tile would say less than no picture. */
  fallback?: "tile" | "none";
}

/**
 * SimThumbnail — a visual handle for a catalogue sim, so a teacher can identify
 * one at a glance. Renders the supplied screenshot when present (an API path is
 * fetched with the teacher's sign-in); otherwise a
 * deterministic accent tile with the sim's monogram over a flask icon. Shared so
 * every sim listing across the site looks consistent.
 */
export function SimThumbnail({ id, displayName, thumbnail, className, fallback = "tile" }: SimThumbnailProps) {
  const t = useT("SimThumbnail");
  const loaded = useThumbnailSrc(thumbnail);
  const [broken, setBroken] = useState<string | null>(null);
  const src = loaded && loaded !== broken ? loaded : null;
  const box = cn("relative shrink-0 overflow-hidden rounded-md", className ?? "h-10 w-10");
  if (src) {
    return (
      // A blob: URL of a screenshot (or a plain image path); next/image adds nothing here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={t("preview", { name: displayName })}
        data-testid={`sim-thumbnail-${id}`}
        onError={() => setBroken(src)}
        // The top of a sim is its title and stage: crop from there, not the middle.
        className={cn(box, "border border-border bg-white object-cover object-top")}
      />
    );
  }
  if (fallback === "none") return null;
  return (
    <span
      className={cn(box, "flex items-center justify-center", tileFor(id))}
      role="img"
      aria-label={t("icon", { name: displayName })}
    >
      <FlaskConical className="absolute h-4 w-4 opacity-20" aria-hidden="true" />
      <span className="relative text-xs font-semibold leading-none">{monogram(displayName)}</span>
    </span>
  );
}
