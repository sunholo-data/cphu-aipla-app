/**
 * "AIPLA is busy" — one signal any part of the student page can raise, and one
 * notice that shows it (2026-11-26).
 *
 * On 2026-11-25 one student dragging a sim slider took prod past Google's
 * per-minute quota. Every group's workbench push failed for a minute and four
 * chat turns were lost from the tutor's history, and no student saw anything,
 * so nobody could report it. The backend now answers a quota failure it could
 * not absorb with HTTP 503 and `X-AIPLA-Busy: 1` (backend/observability/busy.py).
 * `apiClient` raises this signal on that header, and the chat stream raises it
 * on a quota error. `BusyNotice` tells the student to wait a moment and gives
 * them the time to quote when they tell the teacher.
 */

import { reportClientError } from "@/lib/clientErrorReporting";

export const BUSY_HEADER = "x-aipla-busy";
const EVENT = "aipla:busy";

/** Where the busy answer came from: for the report, never shown. */
export type BusySource = "request" | "chat";

/** Raise the signal. Safe anywhere, including during SSR (it does nothing). */
export function reportBusy(source: BusySource): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { at: Date.now(), source } }));
  // So the platform sees it even if nobody reports it: deduplicated per page.
  reportClientError({ kind: "busy", message: `busy: ${source}` });
}

/** Raise the signal if a response says the platform was busy. Returns the response. */
export function noteBusyResponse(resp: Response): Response {
  if (resp.status === 503 && resp.headers.get(BUSY_HEADER)) reportBusy("request");
  return resp;
}

export function onBusy(listener: (at: number) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => listener((e as CustomEvent<{ at: number }>).detail.at);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
