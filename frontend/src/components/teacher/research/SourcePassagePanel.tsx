"use client";

// SourcePassagePanel — check the claim against the paper (2026-09-29).
//
// The backend has been able to do this since 1.1.110 and no UI ever called it,
// so `vouchedBy: M` stayed a claim a reader had to take on trust — in the one
// part of the product whose whole argument is that a prompt can be held against
// its source. Found by the check-client-api gate.
//
// ⚠️ RESEARCHER-ONLY, and not for tidiness: these are verbatim extracts from
// copyrighted journal articles. No teacher tier renders this, and no
// student-facing surface may reach it (check-literature-corpus-isolation.sh).

import { useState } from "react";
import { BookMarked, Loader2, Search } from "lucide-react";

import { searchFrameworkSources, type SourcePassages } from "@/lib/teacherApi";
import { useT } from "@/i18n";

// Copy lives in messages/*/teacher-research.json — 1.1.108.

export function SourcePassagePanel({ frameworkId }: { frameworkId: string }) {
  const t = useT("SourcePassagePanel");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SourcePassages | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setFailed(false);
    try {
      setResult(await searchFrameworkSources(frameworkId, query.trim()));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t pt-3" data-testid="source-passages">
      <h4 className="flex items-center gap-1.5 text-xs font-medium">
        <BookMarked className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        {t("title")}
      </h4>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("blurb")}</p>

      <div className="mt-2 flex gap-2">
        <label className="sr-only" htmlFor={`src-${frameworkId}`}>
          {t("title")}
        </label>
        <input
          id={`src-${frameworkId}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          placeholder={t("placeholder")}
          className="flex-1 rounded border bg-background px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !query.trim()}
          className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Search className="h-3.5 w-3.5" aria-hidden />}
          {busy ? t("searching") : t("search")}
        </button>
      </div>

      {failed ? <p className="mt-2 text-xs text-destructive">{t("failed")}</p> : null}

      {result && !result.configured ? (
        <p data-testid="sources-not-configured" className="mt-2 text-xs text-muted-foreground">
          {t("notConfigured")}
        </p>
      ) : null}

      {result?.configured && result.passages.length === 0 ? (
        <p data-testid="sources-none" className="mt-2 text-xs text-muted-foreground">
          {t("none")}
        </p>
      ) : null}

      {result?.configured && result.passages.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2">
          {result.passages.map((p, i) => (
            <li key={`${p.text.slice(0, 24)}-${i}`} className="rounded bg-muted p-2 text-xs leading-relaxed">
              {/* Verbatim, deliberately: paraphrasing here would defeat the
                  point — you cannot check a claim against a summary. */}
              {p.text}
            </li>
          ))}
        </ul>
      ) : null}

      {result?.citations?.length ? (
        <div className="mt-3">
          <h5 className="text-[11px] font-medium text-muted-foreground">{t("citationsHeading")}</h5>
          <ul className="mt-1 flex flex-col gap-0.5">
            {result.citations.map((c) => (
              <li key={c.citation} className="text-[11px] text-muted-foreground">
                {c.citation} — {t("vouchedBy", { who: c.vouchedBy })}
                {c.note ? ` · ${c.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
