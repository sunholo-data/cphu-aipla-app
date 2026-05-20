import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoldkastSimButton } from "../BoldkastSimButton";

describe("BoldkastSimButton", () => {
  it("renders Danish CTA + descriptor", () => {
    render(<BoldkastSimButton onOpen={() => {}} />);
    expect(screen.getByText(/Åbn Boldkast simulator/i)).toBeInTheDocument();
    expect(screen.getByText(/v₀ og θ/)).toBeInTheDocument();
  });

  it("fires onOpen when clicked", () => {
    const onOpen = vi.fn();
    render(<BoldkastSimButton onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("disabled prop blocks the click + dims the button", () => {
    const onOpen = vi.fn();
    render(<BoldkastSimButton onOpen={onOpen} disabled />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
