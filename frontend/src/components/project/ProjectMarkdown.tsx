import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { slugifyProjectHeading } from "@/lib/projectHeadings";

function childText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) return children.map(childText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return childText((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function Heading({ level, children }: { level: 2 | 3; children: ReactNode }) {
  const id = slugifyProjectHeading(childText(children));
  const classes =
    level === 2
      ? "mb-4 mt-12 scroll-mt-24 text-2xl font-semibold tracking-tight text-foreground"
      : "mb-3 mt-8 scroll-mt-24 text-lg font-semibold text-foreground";

  if (level === 2) return <h2 id={id} className={classes}>{children}</h2>;
  return <h3 id={id} className={classes}>{children}</h3>;
}

export function ProjectMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children: heading }) => (
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {heading}
          </h1>
        ),
        h2: ({ children: heading }) => <Heading level={2}>{heading}</Heading>,
        h3: ({ children: heading }) => <Heading level={3}>{heading}</Heading>,
        p: ({ children: paragraph }) => (
          <p className="mt-4 text-[1.02rem] leading-8 text-muted-foreground">{paragraph}</p>
        ),
        ul: ({ children: items }) => (
          <ul className="my-5 ml-6 list-disc space-y-2 text-[1.02rem] leading-7 text-muted-foreground">
            {items}
          </ul>
        ),
        ol: ({ children: items }) => (
          <ol className="my-5 ml-6 list-decimal space-y-2 text-[1.02rem] leading-7 text-muted-foreground">
            {items}
          </ol>
        ),
        strong: ({ children: text }) => <strong className="font-semibold text-foreground">{text}</strong>,
        a: ({ href = "", children: label }) => {
          const external = href.startsWith("http");
          return (
            <a
              href={href}
              className="font-medium text-red-800 underline decoration-red-800/30 underline-offset-4 hover:decoration-red-800"
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {label}
            </a>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
