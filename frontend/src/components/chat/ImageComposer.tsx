"use client";

import { useRef } from "react";
import { Camera, Paperclip, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StagedImage } from "@/hooks/useImageAttachments";

/** Accept list shared by both inputs — images only (docs go via the doc path). */
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

interface StagingRowProps {
  staged: StagedImage[];
  notice: string | null;
  onRemove: (id: string) => void;
}

/**
 * Thumbnail strip + soft notice, rendered ABOVE the composer form. Shows the
 * images staged for the next turn with a per-thumb remove button. Empty render
 * (null) when there's nothing staged and no notice, so it costs no layout.
 */
export function ImageStagingRow({ staged, notice, onRemove }: StagingRowProps) {
  if (staged.length === 0 && !notice) return null;
  return (
    <div className="mb-2 space-y-2">
      {notice && (
        <p className="text-xs text-amber-600 dark:text-amber-500">{notice}</p>
      )}
      {staged.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {staged.map((img) => (
            <li key={img.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.previewUrl}
                alt={img.name || "attachment"}
                className="h-14 w-14 rounded-md border object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(img.id)}
                aria-label={`Remove ${img.name || "image"}`}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground/80 p-0.5 text-background hover:bg-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface UploadButtonsProps {
  onFiles: (files: FileList | null) => void;
  disabled?: boolean;
  /** true once the per-turn cap is reached — buttons go inert. */
  full?: boolean;
}

/**
 * Paperclip (file picker, multi-select) + camera (capture) buttons, rendered
 * INSIDE the composer form to the left of the text input. Both drive hidden
 * file inputs. The camera input sets `capture` so mobile opens the rear camera
 * directly; on desktop it falls back to a normal file picker.
 *
 * MOBILE-1 (2026-08-13): the camera button used to carry `hidden sm:inline-flex`,
 * which hid it below 640px — i.e. on every phone in portrait, the only devices
 * where `capture="environment"` does anything at all. A student photographing a
 * chalk diagram on the asphalt is the whole point of this button, so it is now
 * visible at every width. Both mount points inherit the fix: this composer and
 * `SolutionElementMount` ("upload a photo of your handwritten solution").
 */
export function ImageUploadButtons({ onFiles, disabled, full }: UploadButtonsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const inert = disabled || full;

  const pick = (ref: React.RefObject<HTMLInputElement | null>) => () => {
    if (inert) return;
    ref.current?.click();
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFiles(e.target.files);
    // reset so re-picking the same file fires change again
    e.target.value = "";
  };

  // 44px is the Apple HIG minimum touch target; the composer is used outdoors
  // with cold/wet fingers on a phone shared by three students. Desktop reverts
  // to the compact icon button so the composer row stays tight.
  const btn = cn(
    "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border",
    "text-muted-foreground hover:text-foreground sm:min-h-0 sm:min-w-0 sm:px-2 sm:py-2",
    inert && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
  );

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        className="hidden"
        onChange={onChange}
      />
      <input
        ref={cameraRef}
        type="file"
        accept={IMAGE_ACCEPT}
        capture="environment"
        className="hidden"
        onChange={onChange}
      />
      <button
        type="button"
        onClick={pick(fileRef)}
        disabled={inert}
        aria-label="Attach image"
        title={full ? "Maximum images reached" : "Attach image"}
        className={btn}
      >
        <Paperclip className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={pick(cameraRef)}
        disabled={inert}
        aria-label="Take photo"
        title={full ? "Maximum images reached" : "Take photo"}
        className={btn}
      >
        <Camera className="h-4 w-4" />
      </button>
    </>
  );
}
