"use client";

import { ZoomableImage } from "./ZoomableImage";

interface InlineImageProps {
  src: string;
  alt?: string;
}

/** A markdown-embedded image, rendered full-width (capped at 400px tall) and
 *  click-to-zoom via the shared {@link ZoomableImage} lightbox. */
export function InlineImage({ src, alt }: InlineImageProps) {
  return (
    <ZoomableImage
      src={src}
      alt={alt}
      triggerClassName="my-2 max-w-full rounded border border-border object-contain"
      triggerStyle={{ maxHeight: "400px" }}
    />
  );
}
