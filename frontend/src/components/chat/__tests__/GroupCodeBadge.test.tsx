import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GroupCodeBadge } from "../GroupCodeBadge";

afterEach(() => vi.restoreAllMocks());

describe("GroupCodeBadge", () => {
  it("renders nothing when no code", () => {
    const { container } = render(<GroupCodeBadge code={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the group code", () => {
    render(<GroupCodeBadge code="lazy-flute-39" />);
    expect(screen.getByText("lazy-flute-39")).toBeInTheDocument();
  });

  it("copies the code to the clipboard on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<GroupCodeBadge code="lazy-flute-39" />);
    fireEvent.click(screen.getByRole("button", { name: /lazy-flute-39/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("lazy-flute-39"));
  });
});
