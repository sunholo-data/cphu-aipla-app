"use client";

import { ChatMarkdown } from "@/components/chat/ChatMarkdown";

interface ProblemStatementCardProps {
  /** Markdown body — full problem text + sub-parts. Sourced from the
   * skill's `problemStatement` frontmatter field via useSkillMeta.
   * KaTeX is supported (remark-math + rehype-katex are already plumbed
   * through ChatMarkdown from the 1636038 commit). */
  content: string;
}

/**
 * ProblemStatementCard — the "what you're working on" card in the
 * AIPLA WorkspaceShell. Renders the skill's problem statement as
 * markdown with KaTeX inline math support.
 *
 * Pedagogical purpose: give the student a persistent view of the
 * problem they're tackling so the chat tutor and the student are
 * looking at the same artefact. v0.1 ships Boldkast; v1's
 * problem-set-helper-config will let teachers author per-class
 * worksheets that populate this card.
 *
 * Returns null when `content` is empty so workspace-using skills
 * without a pinned problem (the v1+ general case) don't render an
 * empty card.
 */
export function ProblemStatementCard({ content }: ProblemStatementCardProps) {
  if (!content) return null;

  // navigateToBlock is a no-op — the problem statement doesn't carry
  // doc-citation links. ChatMarkdown's signature requires the prop;
  // pass a stub.
  const noopNavigate = () => {};

  return (
    <section
      className="rounded-lg border border-border bg-card p-4 text-sm text-foreground"
      aria-label="Problem statement"
    >
      <ChatMarkdown content={content} navigateToBlock={noopNavigate} />
    </section>
  );
}
