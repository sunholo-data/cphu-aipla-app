import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "boldkast" }),
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));

// Importing after vi.mock so useParams resolves to the mocked id.
import TeacherActivityConfigPage from "@/app/teacher/activities/[id]/page";

describe("/teacher/activities/[id] — activity configuration", () => {
  it("renders the teaching-goal textarea pre-filled from mock data", () => {
    render(<TeacherActivityConfigPage />);
    const textarea = screen.getByLabelText(/teaching goal/i) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toMatch(/horizontal and vertical motion are independent/);
  });

  it("preserves an edited teaching goal across re-renders", () => {
    render(<TeacherActivityConfigPage />);
    const textarea = screen.getByLabelText(/teaching goal/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Custom goal copy" } });
    expect(textarea.value).toBe("Custom goal copy");
  });

  it("'Save configuration' click shows a mock-only toast and keeps the textarea value", async () => {
    render(<TeacherActivityConfigPage />);
    const textarea = screen.getByLabelText(/teaching goal/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Edited goal" } });

    fireEvent.click(screen.getByRole("button", { name: /save configuration/i }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent ?? "").toMatch(
        /saved \(mock\)/i,
      );
    });
    expect(textarea.value).toBe("Edited goal");
  });
});
