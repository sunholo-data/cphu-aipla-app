"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/clientErrorReporting";

/**
 * Last-resort boundary for a throw in the **root layout itself** (1.1.96 M-1) —
 * the one case `app/error.tsx` cannot catch, because that boundary lives inside
 * the layout that failed.
 *
 * Next replaces the whole document here, so this file must render its own
 * `<html>` and `<body>`: the root layout's classes, fonts and providers are all
 * gone. That is why the styling below is inline rather than Tailwind — at this
 * point we cannot assume the stylesheet loaded, and a fallback that depends on
 * the thing that just broke is not a fallback. The KU red is written literally
 * for the same reason `layout.tsx` writes `themeColor: "#901a1e"` literally —
 * there is no CSS custom property to read it from at this point. (This does not
 * trip `check-brand-literals.sh`, which polices Tailwind `red-*` utilities on
 * brand surfaces; a hex here is the documented exception, not drift.)
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError({
      kind: "render",
      message: error.message || "root layout error",
      stack: error.stack ?? "",
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
          color: "#0f172a",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: "2rem",
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            The app failed to start
          </h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.6, marginBottom: "1.25rem", opacity: 0.8 }}>
            The error has been reported automatically. Reloading usually fixes it. If it keeps
            happening, tell us what you were doing — that context is the part we cannot see.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#901a1e",
              color: "#ffffff",
              border: "none",
              borderRadius: "0.375rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ fontSize: "0.75rem", marginTop: "1.25rem", opacity: 0.6 }}>
              Reference: <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
