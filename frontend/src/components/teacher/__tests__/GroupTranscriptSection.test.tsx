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

  it("renders the transcript + segment count when present", async () => {
    fetchGroupTranscript.mockResolvedValue({
      groupId: "g1",
      segments: [
        { seq: 0, text: "a", createdAt: "" },
        { seq: 1, text: "b", createdAt: "" },
      ],
      text: "a b",
    });
    render(<GroupTranscriptSection groupId="g1" />);
    await waitFor(() => expect(screen.getByText("a b")).toBeInTheDocument());
    expect(screen.getByText(/2 segments/)).toBeInTheDocument();
    expect(screen.getByText("Lesson recording transcript")).toBeInTheDocument();
  });
});
