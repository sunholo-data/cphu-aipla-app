import { FlaskConical } from "lucide-react";

import { cn } from "@/lib/utils";

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
}

/**
 * SimThumbnail — a visual handle for a catalogue sim, so a teacher can identify
 * one at a glance. Renders the supplied screenshot when present; otherwise a
 * deterministic accent tile with the sim's monogram over a flask icon. Shared so
 * every sim listing across the site looks consistent.
 */
export function SimThumbnail({ id, displayName, thumbnail, className }: SimThumbnailProps) {
  const box = cn("relative shrink-0 overflow-hidden rounded-md", className ?? "h-10 w-10");
  if (thumbnail) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={thumbnail} alt={`${displayName} preview`} className={cn(box, "object-cover")} />
    );
  }
  return (
    <span
      className={cn(box, "flex items-center justify-center", tileFor(id))}
      role="img"
      aria-label={`${displayName} icon`}
    >
      <FlaskConical className="absolute h-4 w-4 opacity-20" aria-hidden="true" />
      <span className="relative text-xs font-semibold leading-none">{monogram(displayName)}</span>
    </span>
  );
}
