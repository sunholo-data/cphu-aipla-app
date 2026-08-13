"use client";

import { useEffect } from "react";

/**
 * Registers `/public/sw.js` (MOBILE-1, 2026-08-13).
 *
 * Production only. In `next dev` a service worker caching `/_next/static/`
 * fights hot-reload and produces "my change did nothing" bugs that cost far
 * more than the offline shell is worth on a laptop.
 *
 * Renders nothing. Failures are swallowed on purpose: the offline shell is a
 * progressive enhancement, and a browser that refuses to register (private
 * browsing, an unsupported engine, a locked-down school device) must still get
 * a fully working app.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    // Register after load so the worker's install (and its precache fetches)
    // never competes with the first paint on a slow school connection.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn("[sw] registration failed:", err);
        }
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
