import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectMarkdown } from "@/components/project/ProjectMarkdown";
import { slugifyProjectHeading } from "@/lib/projectHeadings";

describe("ProjectMarkdown", () => {
  it("renders navigable heading ids and internal links", () => {
    render(
      <ProjectMarkdown>{`# Research\n\n## Teacher control\n\nRead the [guides](/guides).`}</ProjectMarkdown>,
    );

    expect(screen.getByRole("heading", { name: "Research", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Teacher control", level: 2 })).toHaveAttribute(
      "id",
      "teacher-control",
    );
    expect(screen.getByRole("link", { name: "guides" })).toHaveAttribute("href", "/guides");
  });

  it("normalises punctuation and Danish characters for stable anchors", () => {
    expect(slugifyProjectHeading("Analyse, design & evaluation")).toBe(
      "analyse-design-evaluation",
    );
    expect(slugifyProjectHeading("Læring før automation")).toBe("laering-for-automation");
  });

  it("renders the project demo marker as a maintained artefact panel", () => {
    render(<ProjectMarkdown>{`[Open the interactive demonstration](/project/demo/boldkast)`}</ProjectMarkdown>);

    expect(screen.getByText(/interactive demonstration is unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /group join page/i })).toHaveAttribute("href", "/group");
  });

  it("drops HTML comments instead of printing them (generated-file and sim-prompt markers)", () => {
    render(<ProjectMarkdown>{"<!-- GENERATED — DO NOT EDIT -->\n\nVisible.\n\n<!-- sim-prompt:start -->"}</ProjectMarkdown>);

    expect(screen.getByText("Visible.")).toBeInTheDocument();
    expect(screen.queryByText(/GENERATED|sim-prompt/)).toBeNull();
  });

  it("renders a fenced block as a copyable <pre> and keeps inline code as a pill", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <ProjectMarkdown>{"Paste `<<< BRIEF >>>`.\n\n```text\nline one\nline two\n```"}</ProjectMarkdown>,
    );

    // The sim authoring prompt is ~370 lines; the point of the block is the
    // copy button, which must hand the chat the exact text.
    fireEvent.click(screen.getByRole("button", { name: /copy this block/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("line one\nline two\n"));

    const pre = screen.getByText(/line one/).closest("pre");
    expect(pre).not.toBeNull();
    expect(pre?.querySelector("code")?.className).not.toMatch(/rounded/);
    expect(screen.getByText("<<< BRIEF >>>").className).toMatch(/rounded/);
  });
});
