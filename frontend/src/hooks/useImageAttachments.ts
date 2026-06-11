"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { resizeImageFile, type EncodedImage } from "@/lib/imageResize";
import { screenImageForPerson } from "@/lib/personGuardrail";

/** A picked image staged for the next turn: preview URL + wire-ready base64. */
export interface StagedImage {
  id: string;
  /** object URL for the thumbnail; revoked on remove/clear/unmount. */
  previewUrl: string;
  encoded: EncodedImage;
  name: string;
}

/** Max images per turn — matches the backend's _MAX_ATTACHMENTS cap. */
export const MAX_IMAGES = 4;

export interface UseImageAttachments {
  staged: StagedImage[];
  /** soft user-facing notice (cap hit / guardrail block / degrade). */
  notice: string | null;
  count: number;
  /** base64 EncodedImage[] for sendMessage opts.attachments. */
  attachments: EncodedImage[];
  addFiles: (files: FileList | File[] | null) => Promise<void>;
  remove: (id: string) => void;
  clear: () => void;
}

/**
 * Owns the staged-image lifecycle for the chat composer (1.1.7).
 *
 * Each picked file is screened on-device for people (personGuardrail) and
 * downscaled (imageResize) before being staged. The cap, the privacy block,
 * and object-URL cleanup all live here so the chat page just wires the UI and
 * reads `attachments` at send time.
 *
 * A ref mirrors the staged list as the authoritative source across the async
 * add loop (state updates are async; the cap must be enforced synchronously).
 */
export function useImageAttachments(): UseImageAttachments {
  const [staged, setStaged] = useState<StagedImage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const stagedRef = useRef<StagedImage[]>([]);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files) return;
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setNotice(null);

    for (const file of images) {
      if (stagedRef.current.length >= MAX_IMAGES) {
        setNotice(`You can attach up to ${MAX_IMAGES} images per message.`);
        break;
      }
      // On-device privacy screen — blocked images never get staged or sent.
      const screen = await screenImageForPerson(file);
      if (screen.blocked) {
        setNotice(screen.message);
        continue;
      }
      if (screen.degraded && screen.message) {
        setNotice(screen.message);
      }
      let encoded: EncodedImage;
      try {
        encoded = await resizeImageFile(file);
      } catch {
        setNotice("Couldn't process that image. Please try another.");
        continue;
      }
      const item: StagedImage = {
        id: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(file),
        encoded,
        name: file.name,
      };
      stagedRef.current = [...stagedRef.current, item];
      setStaged(stagedRef.current);
    }
  }, []);

  const remove = useCallback((id: string) => {
    const hit = stagedRef.current.find((s) => s.id === id);
    if (hit) URL.revokeObjectURL(hit.previewUrl);
    stagedRef.current = stagedRef.current.filter((s) => s.id !== id);
    setStaged(stagedRef.current);
  }, []);

  const clear = useCallback(() => {
    stagedRef.current.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    stagedRef.current = [];
    setStaged([]);
    setNotice(null);
  }, []);

  // Release any outstanding object URLs if the composer unmounts mid-compose.
  useEffect(
    () => () => {
      stagedRef.current.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    },
    [],
  );

  return {
    staged,
    notice,
    count: staged.length,
    attachments: staged.map((s) => s.encoded),
    addFiles,
    remove,
    clear,
  };
}
