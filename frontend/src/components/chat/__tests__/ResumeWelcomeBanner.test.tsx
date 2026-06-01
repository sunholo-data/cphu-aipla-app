import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResumeWelcomeBanner } from "@/components/chat/ResumeWelcomeBanner";

describe("ResumeWelcomeBanner", () => {
  it("renders the resume message", () => {
    render(<ResumeWelcomeBanner onDismiss={() => void 0} />);
    expect(screen.getByText(/continuing from your last session/i)).toBeDefined();
  });

  it("renders Danish text", () => {
    render(<ResumeWelcomeBanner onDismiss={() => void 0} />);
    expect(screen.getByText(/fortsætter fra din forrige session/i)).toBeDefined();
  });

  it("calls onDismiss when the dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(<ResumeWelcomeBanner onDismiss={onDismiss} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
