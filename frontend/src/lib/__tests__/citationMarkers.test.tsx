import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { stripCitationMarkers } from "../citationMarkers";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";

// 1.1.122 — real prod text from 2026-09-22.
describe("stripCitationMarkers", () => {
  it("removes the marker and its leading space", () => {
    expect(stripCitationMarkers("på en spilleplade med 14 felter [rag-source-1].")).toBe(
      "på en spilleplade med 14 felter.",
    );
    expect(stripCitationMarkers("konstant [rag-source-1], og λ = v·T [rag-source-3].")).toBe(
      "konstant, og λ = v·T.",
    );
  });

  it("leaves look-alikes alone", () => {
    const s = "Se [kilde], [1], [rag-source] og [rag-source-x].";
    expect(stripCitationMarkers(s)).toBe(s);
  });
});

describe("ChatMarkdown", () => {
  it("never renders a [rag-source-N] marker (stored pre-fix turns)", () => {
    const { container } = render(
      <ChatMarkdown
        content={"Bølgehastigheden er konstant [rag-source-1]. Hvad sker der med $T$?"}
        navigateToBlock={() => {}}
      />,
    );
    expect(container.textContent).not.toMatch(/\[rag-source-\d+\]/);
    expect(container.textContent).toContain("Bølgehastigheden er konstant.");
  });
});
