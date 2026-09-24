import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createStudentPreview = vi.fn();
vi.mock("@/lib/teacherApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/teacherApi")>();
  return { ...actual, createStudentPreview: (...a: unknown[]) => createStudentPreview(...a) };
});

import { ConflictError } from "@/lib/teacherApi";
import { TryAsStudentButton } from "../TryAsStudentButton";

// 1.1.133
describe("TryAsStudentButton", () => {
  let tab: { location: { href: string }; opener: unknown; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    createStudentPreview.mockReset();
    tab = { location: { href: "" }, opener: window, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  });

  it("opens the tab inside the click, then points it at the join link", async () => {
    createStudentPreview.mockResolvedValue({
      code: "preview-a-b-01",
      classId: "c1",
      next: "/chat/s?activity_id=act-1",
      joinUrl: "/group?code=preview-a-b-01&next=%2Fchat%2Fs",
    });
    render(<TryAsStudentButton activityId="act-1" classId="c1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /try as student/i }));
    });
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(createStudentPreview).toHaveBeenCalledWith("act-1", "c1");
    expect(tab.location.href).toBe("/group?code=preview-a-b-01&next=%2Fchat%2Fs");
    expect(tab.opener).toBeNull();
  });

  it("shows the server's reason and closes the tab when the activity is in no class", async () => {
    createStudentPreview.mockRejectedValue(new ConflictError("Assign this activity to a class first."));
    render(<TryAsStudentButton activityId="act-1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /try as student/i }));
    });
    expect(tab.close).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Assign this activity to a class first.");
  });

  it("says so when the browser blocks the tab", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<TryAsStudentButton activityId="act-1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /try as student/i }));
    });
    expect(createStudentPreview).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/pop-ups/i);
  });
});
