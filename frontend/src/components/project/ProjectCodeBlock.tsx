"use client";

import { useState, type ReactNode } from "react";

// Every string a reader sees lives here, not inline in the JSX (1.1.108 M4).
const copy = {
  copy: "Copy",
  copied: "Copied",
  failed: "Select and copy manually",
  ariaLabel: "Copy this block to the clipboard",
};

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

/**
 * A fenced code block on a /project page, with a copy button.
 *
 * Exists for the sim authoring prompt on /project/build-a-simulation: ~370
 * lines that physics staff paste into an AI chat. Selecting that by hand on a
 * phone is the kind of friction that makes people email M instead.
 */
export function ProjectCodeBlock({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(textOf(children));
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  }

  const label = state === "copied" ? copy.copied : state === "failed" ? copy.failed : copy.copy;

  return (
    <div className="relative my-7">
      <button
        type="button"
        onClick={onCopy}
        aria-label={copy.ariaLabel}
        className="absolute right-3 top-3 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm hover:bg-muted"
      >
        {label}
      </button>
      <pre className="max-h-[32rem] overflow-auto rounded-lg border border-border bg-muted/40 p-4 pr-24 font-mono text-[0.8rem] leading-6 text-foreground">
        {children}
      </pre>
    </div>
  );
}
