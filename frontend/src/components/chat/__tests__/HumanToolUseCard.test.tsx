import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HumanToolUseCard } from "../HumanToolUseCard";

describe("HumanToolUseCard", () => {
  it("renders the label", () => {
    render(<HumanToolUseCard label="Markerede 'a' som klar" status="pending" />);
    expect(screen.getByText("Markerede 'a' som klar")).toBeInTheDocument();
  });

  it("shows the pending icon when status=pending", () => {
    render(<HumanToolUseCard label="x" status="pending" />);
    expect(screen.getByLabelText("Pending")).toBeInTheDocument();
    expect(screen.queryByLabelText("Confirmed")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Failed")).not.toBeInTheDocument();
  });

  it("shows the confirmed icon when status=confirmed", () => {
    render(<HumanToolUseCard label="x" status="confirmed" />);
    expect(screen.getByLabelText("Confirmed")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pending")).not.toBeInTheDocument();
  });

  it("shows the failed icon when status=failed", () => {
    render(<HumanToolUseCard label="x" status="failed" />);
    expect(screen.getByLabelText("Failed")).toBeInTheDocument();
  });

  it("always shows the User icon (human-tool-use signal)", () => {
    render(<HumanToolUseCard label="x" status="confirmed" />);
    expect(screen.getByLabelText("You")).toBeInTheDocument();
  });

  it("surfaces httpStatus + detail via the title attribute on failed cards", () => {
    render(
      <HumanToolUseCard label="x" status="failed" httpStatus={404} detail="not found" />,
    );
    const card = screen.getByTestId("human-tool-use-card");
    expect(card).toHaveAttribute("title", "HTTP 404 — not found");
  });

  it("has no title attribute when both httpStatus and detail are absent", () => {
    render(<HumanToolUseCard label="x" status="confirmed" />);
    const card = screen.getByTestId("human-tool-use-card");
    expect(card).not.toHaveAttribute("title");
  });

  it("truncates labels longer than 80 chars", () => {
    const long = "Markerede '".repeat(20);
    render(<HumanToolUseCard label={long} status="pending" />);
    const card = screen.getByTestId("human-tool-use-card");
    expect(card.textContent ?? "").toContain("…");
  });

  it("exposes status via data-status attribute (for integration tests)", () => {
    render(<HumanToolUseCard label="x" status="failed" />);
    expect(screen.getByTestId("human-tool-use-card")).toHaveAttribute("data-status", "failed");
  });
});
