"use client";

/**
 * "Open this document" requests from the chat to the workbench (1.1.147 M3b).
 *
 * A document the tutor names in a reply (an `aitana://doc/{docId}/block/…`
 * chip) is clicked in the chat column; the reader that can open it lives in
 * the workspace column, possibly inside a tab that is not mounted yet. A tiny
 * external store bridges the two: the chat page owns it and calls `request()`,
 * the workspace's tabs switch to Documents when a request is pending, and the
 * DocumentsPanel opens (or explains) the document and `consume()`s it — so a
 * request is acted on once, not again every time the panel remounts.
 */

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

export interface DocumentRequest {
  docId: string;
  /** Distinguishes two clicks on the same chip. */
  nonce: number;
}

export interface DocumentRequestStore {
  get(): DocumentRequest | null;
  request(docId: string): void;
  consume(nonce: number): void;
  subscribe(listener: () => void): () => void;
}

export function createDocumentRequestStore(): DocumentRequestStore {
  let current: DocumentRequest | null = null;
  let nonce = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => current,
    request(docId) {
      current = { docId, nonce: ++nonce };
      emit();
    },
    consume(n) {
      if (current?.nonce !== n) return;
      current = null;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const DocumentRequestContext = createContext<DocumentRequestStore | null>(null);

export const DocumentRequestProvider = DocumentRequestContext.Provider;

const noSubscribe = () => () => {};
const noRequest = () => null;

/** The pending request (null outside a provider, e.g. the builder preview). */
export function useDocumentRequest(): {
  request: DocumentRequest | null;
  consume: (nonce: number) => void;
} {
  const store = useContext(DocumentRequestContext);
  const request = useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    store ? store.get : noRequest,
    noRequest,
  );
  const consume = useCallback((n: number) => store?.consume(n), [store]);
  return { request, consume };
}
