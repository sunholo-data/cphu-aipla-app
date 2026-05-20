import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProblemStatementCard } from "../ProblemStatementCard";

// ChatMarkdown's full pipeline (remark-math + rehype-katex + react-markdown)
// is too heavy for a unit test and KaTeX rendering is asserted elsewhere.
// Stub it to a simple `<div>` so we can assert content flows through.
vi.mock("@/components/chat/ChatMarkdown", () => ({
  ChatMarkdown: ({ content }: { content: string }) => (
    <div data-testid="chat-markdown-stub">{content}</div>
  ),
}));

describe("ProblemStatementCard", () => {
  it("renders the content through ChatMarkdown", () => {
    render(<ProblemStatementCard content="### Boldkast\n- sub-part a" />);
    const stub = screen.getByTestId("chat-markdown-stub");
    expect(stub).toHaveTextContent("### Boldkast");
    expect(stub).toHaveTextContent("sub-part a");
  });

  it("returns null when content is empty", () => {
    const { container } = render(<ProblemStatementCard content="" />);
    expect(container.firstChild).toBeNull();
  });

  it("has the Problem statement aria-label", () => {
    render(<ProblemStatementCard content="x" />);
    expect(screen.getByLabelText("Problem statement")).toBeInTheDocument();
  });
});
