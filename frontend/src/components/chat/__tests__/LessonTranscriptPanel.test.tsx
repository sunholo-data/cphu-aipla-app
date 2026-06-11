import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMyTranscript = vi.fn();
vi.mock("@/lib/transcriptApi", () => ({
  fetchMyTranscript: () => fetchMyTranscript(),
}));

import { LessonTranscriptPanel } from "../LessonTranscriptPanel";

afterEach(() => vi.clearAllMocks());

describe("LessonTranscriptPanel", () => {
  it("is collapsed by default and does not fetch until opened", () => {
    render(<LessonTranscriptPanel />);
    expect(screen.getByText("Lesson transcript")).toBeInTheDocument();
    expect(fetchMyTranscript).not.toHaveBeenCalled();
  });

  it("reveals + fetches + renders the transcript text when opened", async () => {
    fetchMyTranscript.mockResolvedValue({
      groupId: "g1",
      segments: [{ seq: 0, text: "hej", createdAt: "" }],
      text: "hej fra gruppen",
    });
    render(<LessonTranscriptPanel />);
    fireEvent.click(screen.getByText("Lesson transcript"));
    await waitFor(() => expect(screen.getByText("hej fra gruppen")).toBeInTheDocument());
    expect(fetchMyTranscript).toHaveBeenCalled();
  });

  it("shows an empty-state when there's no transcript yet", async () => {
    fetchMyTranscript.mockResolvedValue({ groupId: "g1", segments: [], text: "" });
    render(<LessonTranscriptPanel />);
    fireEvent.click(screen.getByText("Lesson transcript"));
    await waitFor(() => expect(screen.getByText(/No transcript yet/i)).toBeInTheDocument());
  });
});
