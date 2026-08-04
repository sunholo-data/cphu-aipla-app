import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
});
