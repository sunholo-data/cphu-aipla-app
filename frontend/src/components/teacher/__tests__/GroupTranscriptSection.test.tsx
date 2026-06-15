import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchGroupTranscript = vi.fn();
vi.mock("@/lib/transcriptApi", () => ({
  fetchGroupTranscript: (...a: unknown[]) => fetchGroupTranscript(...a),
}));

import { GroupTranscriptSection } from "../GroupTranscriptSection";

afterEach(() => vi.clearAllMocks());

describe("GroupTranscriptSection", () => {
  it("renders nothing when the group has no transcript", async () => {
    fetchGroupTranscript.mockResolvedValue({ groupId: "g1", segments: [], text: "" });
    const { container } = render(<GroupTranscriptSection groupId="g1" />);
    await waitFor(() => expect(fetchGroupTranscript).toHaveBeenCalledWith("g1"));
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the fetch fails (null)", async () => {
    fetchGroupTranscript.mockResolvedValue(null);
    const { container } = render(<GroupTranscriptSection groupId="g1" />);
    await waitFor(() => expect(fetchGroupTranscript).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("renders one timestamped row per segment + the segment count", async () => {
    fetchGroupTranscript.mockResolvedValue({
      groupId: "g1",
      segments: [
        { seq: 0, text: "first part", createdAt: "2026-06-15T13:00:00Z" },
        { seq: 1, text: "second part", createdAt: "2026-06-15T13:01:00Z" },
      ],
      text: "first part second part",
    });
    render(<GroupTranscriptSection groupId="g1" />);
    // Each segment is its own row (not one joined blob).
    await waitFor(() => expect(screen.getByText("first part")).toBeInTheDocument());
    expect(screen.getByText("second part")).toBeInTheDocument();
    expect(screen.getByText(/2 segments/)).toBeInTheDocument();
    expect(screen.getByText("Lesson recording transcript")).toBeInTheDocument();
  });
});
