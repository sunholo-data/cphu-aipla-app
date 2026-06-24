"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

interface ZoomableImageProps {
  src: string;
  alt?: string;
  /** Tailwind classes for the inline trigger thumbnail. The shared
   *  `cursor-zoom-in` is always applied on top. */
  triggerClassName?: string;
  /** Inline style for the trigger thumbnail (e.g. a maxHeight cap). */
  triggerStyle?: React.CSSProperties;
  /** Called when the full-screen lightbox opens (1.1.45 — lets the documents
   *  surface report an `image.fullscreen` interaction). */
  onOpen?: () => void;
}

function BrokenImageFallback({ alt }: { alt?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
      {/* broken image icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
      {alt ?? "image unavailable"}
    </span>
  );
}

/**
 * An image that opens to a full-screen lightbox on click. Shared by
 * markdown-embedded images (InlineImage) and uploaded attachment thumbnails
 * (MessageBubble) so both get the same zoom + close affordance. The trigger's
 * size/shape is caller-controlled via triggerClassName; the expanded view is
 * always a centred, max-90vw/90vh contain.
 */
export function ZoomableImage({
  src,
  alt,
  triggerClassName,
  triggerStyle,
  onOpen,
}: ZoomableImageProps) {
  const [errored, setErrored] = useState(false);
  const [open, setOpen] = useState(false);

  if (errored) return <BrokenImageFallback alt={alt} />;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onOpen?.();
      }}
    >
      <Dialog.Trigger asChild>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          className={`cursor-zoom-in ${triggerClassName ?? ""}`}
          style={triggerStyle}
          onError={() => setErrored(true)}
        />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">{alt ?? "Image preview"}</Dialog.Title>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt ?? ""}
            className="max-h-[90vh] max-w-[90vw] rounded object-contain shadow-2xl"
          />
          <Dialog.Close
            className="absolute -right-3 -top-3 flex h-6 w-6 items-center justify-center rounded-full bg-white text-black shadow-md hover:bg-muted"
            aria-label="Close"
          >
            ×
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
