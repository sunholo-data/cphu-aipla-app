import { Info, Lightbulb, TriangleAlert } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { ProjectMarkdown } from "@/components/project/ProjectMarkdown";

/**
 * Renders a guide's markdown with the app's own typography (1.1.116).
 *
 * Two things the guides need that the /project pages do not:
 *
 *  1. **Callouts.** The prose carries Quarto's `::: callout-note` fences, kept
 *     verbatim through the move so no guide had to be reworded. They are split
 *     out here and rendered as panels; the `## Heading` on the first line of a
 *     fence is the panel's title.
 *  2. **Captioned screenshots.** A guide's image alt text is a caption a
 *     reader is meant to SEE ("The class list shows each class with its group
 *     codes…"), so images render as a <figure> with a visible <figcaption>.
 *     On /project an image is decorative and its alt stays alt.
 *
 * Everything else — headings, lists, tables, links, code — comes from the
 * shared component map, which is the point: a guide should look like the rest
 * of the site, not like a document that wandered in.
 */
const CALLOUT = {
  note: { Icon: Info, label: "Note", className: "border-brand/30 bg-brand/[0.06]", icon: "text-brand" },
  tip: { Icon: Lightbulb, label: "Tip", className: "border-emerald-500/30 bg-emerald-500/[0.07]", icon: "text-emerald-600 dark:text-emerald-400" },
  warning: { Icon: TriangleAlert, label: "Warning", className: "border-amber-500/40 bg-amber-500/[0.09]", icon: "text-amber-600 dark:text-amber-400" },
} satisfies Record<
  string,
  { Icon: ComponentType<{ className?: string }>; label: string; className: string; icon: string }
>;

type CalloutKind = keyof typeof CALLOUT;

const FIGURE_COMPONENTS = {
  img: ({ src = "", alt = "" }: { src?: string | Blob; alt?: string }) => (
    <figure className="my-8">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={typeof src === "string" ? src : ""}
        alt={alt}
        className="w-full rounded-xl border border-border bg-muted/30 object-contain"
      />
      {alt ? (
        <figcaption className="mt-2 text-sm text-muted-foreground">{alt}</figcaption>
      ) : null}
    </figure>
  ),
  // A <figure> is block-level and react-markdown wraps a lone image in <p>,
  // which the browser re-parents on hydration. Unwrap exactly that case and
  // leave every real paragraph a paragraph.
  p: ({
    node,
    children,
  }: {
    node?: { children?: { type?: string; tagName?: string; value?: string }[] };
    children?: ReactNode;
  }) => {
    // `node` is the HAST node by the time a component sees it, so the child of
    // an image-only paragraph is `{type: "element", tagName: "img"}` — NOT the
    // mdast `{type: "image"}` it is easy to assume.
    const kids = (node?.children ?? []).filter(
      // Whitespace between elements only — real text means real prose, and a
      // paragraph of "see this: <img>" must stay a paragraph.
      (child) => !(child.type === "text" && !(child.value ?? "").trim()),
    );
    if (kids.length === 1 && (kids[0]?.tagName === "img" || kids[0]?.type === "image")) {
      return <>{children}</>;
    }
    return <p className="mt-4 text-[1.02rem] leading-8 text-muted-foreground">{children}</p>;
  },
};

function Callout({ kind, title, body }: { kind: CalloutKind; title: string | null; body: string }) {
  const { Icon, className, icon } = CALLOUT[kind];
  return (
    <aside className={`my-8 rounded-xl border px-5 py-4 ${className}`}>
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className={`h-4 w-4 shrink-0 ${icon}`} aria-hidden="true" />
        {title ?? CALLOUT[kind].label}
      </p>
      <div className="mt-1 [&>*:first-child]:mt-2">
        <ProjectMarkdown components={FIGURE_COMPONENTS}>{body}</ProjectMarkdown>
      </div>
    </aside>
  );
}

/** Split the body into prose and callout segments, in document order. */
function segments(markdown: string): ({ kind: "prose"; body: string } | {
  kind: "callout"; callout: CalloutKind; title: string | null; body: string;
})[] {
  const out: ReturnType<typeof segments> = [];
  const fence = /^::: callout-([a-z]+)\n([\s\S]*?)\n:::[ \t]*$/gm;
  let cursor = 0;
  for (const match of markdown.matchAll(fence)) {
    const start = match.index ?? 0;
    if (start > cursor) out.push({ kind: "prose", body: markdown.slice(cursor, start) });
    const kind = (match[1] in CALLOUT ? match[1] : "note") as CalloutKind;
    const inner = match[2];
    const heading = inner.match(/^#{2,4}\s+(.+)\n?/);
    out.push({
      kind: "callout",
      callout: kind,
      title: heading ? heading[1] : null,
      body: (heading ? inner.slice(heading[0].length) : inner).trim(),
    });
    cursor = start + match[0].length;
  }
  if (cursor < markdown.length) out.push({ kind: "prose", body: markdown.slice(cursor) });
  return out;
}

export function GuideBody({ markdown }: { markdown: string }) {
  return (
    <div>
      {segments(markdown).map((segment, index) =>
        segment.kind === "callout" ? (
          <Callout
            key={index}
            kind={segment.callout}
            title={segment.title}
            body={segment.body}
          />
        ) : segment.body.trim() ? (
          <ProjectMarkdown key={index} components={FIGURE_COMPONENTS}>
            {segment.body.trim()}
          </ProjectMarkdown>
        ) : null,
      )}
    </div>
  );
}
