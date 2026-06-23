import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Stub the markdown renderer — WorkbenchNote's job is to pass the body through
// and render the title; ChatMarkdown has its own coverage.
vi.mock("@/components/chat/ChatMarkdown", () => ({
  ChatMarkdown: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

import { WorkbenchNote } from "../WorkbenchNote";

describe("WorkbenchNote", () => {
  it("renders the title and the markdown body", () => {
    render(<WorkbenchNote skillId="s" notes={[{ id: "n1", title: "Husk", body: "**v = s / t**" }]} />);
    expect(screen.getByText("Husk")).toBeInTheDocument();
    expect(screen.getByTestId("md")).toHaveTextContent("**v = s / t**");
  });

  it("renders without a title", () => {
    render(<WorkbenchNote skillId="s" notes={[{ id: "n1", body: "hej" }]} />);
    expect(screen.getByTestId("md")).toHaveTextContent("hej");
  });
});
