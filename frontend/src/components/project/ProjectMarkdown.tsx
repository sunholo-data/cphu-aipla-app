import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ProjectArtefactDemo } from "@/components/project/ProjectArtefactDemo";
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
        blockquote: ({ children: quote }) => (
          <blockquote className="my-7 border-l-4 border-brand bg-muted/50 px-5 py-3 text-foreground">
            {quote}
          </blockquote>
        ),
        table: ({ children: table }) => (
          <div className="my-7 overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-left text-sm">{table}</table>
          </div>
        ),
        thead: ({ children: head }) => <thead className="bg-muted text-foreground">{head}</thead>,
        th: ({ children: cell }) => <th className="border-b border-border px-4 py-3 font-semibold">{cell}</th>,
        td: ({ children: cell }) => <td className="border-b border-border px-4 py-3 align-top leading-6 text-muted-foreground last:border-b-0">{cell}</td>,
        img: ({ src = "", alt = "" }) => {
          const projectDiagram = typeof src === "string" && src.includes("/project-diagrams/");
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt}
              className={`my-7 w-full rounded-xl border border-border bg-muted/30 object-contain p-4 ${projectDiagram ? "max-h-[34rem]" : "max-h-72"}`}
            />
          );
        },
        code: ({ children: code }) => (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">{code}</code>
        ),
        hr: () => <hr className="my-10 border-border" />,
        strong: ({ children: text }) => <strong className="font-semibold text-foreground">{text}</strong>,
        a: ({ href = "", children: label }) => {
          if (href === "/project/demo/boldkast") return <ProjectArtefactDemo />;
          const external = href.startsWith("http");
          return (
            <a
              href={href}
              className="font-medium text-brand underline decoration-brand/30 underline-offset-4 hover:decoration-brand"
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
