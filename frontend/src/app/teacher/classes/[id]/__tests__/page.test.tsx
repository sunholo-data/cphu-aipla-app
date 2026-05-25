import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MOCK_CLASSES } from "@/app/teacher/_mock-data";

const targetClass = MOCK_CLASSES[0]!;

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: targetClass.id }),
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));

// Importing after vi.mock so the mocked hook is wired before the page resolves.
import TeacherClassDetailPage from "@/app/teacher/classes/[id]/page";

describe("/teacher/classes/[id] — class detail", () => {
  it("renders the class name and groups from mock data", () => {
    render(<TeacherClassDetailPage />);
    expect(
      screen.getByRole("heading", { name: targetClass.name }),
    ).toBeInTheDocument();
    for (const g of targetClass.groups) {
      expect(screen.getByText(g.code)).toBeInTheDocument();
    }
  });

  it("'+ New group' click appends a fake group code and shows a confirmation", async () => {
    render(<TeacherClassDetailPage />);
    const before = screen.getAllByText(/-/, { selector: "code" }).length;

    fireEvent.click(screen.getByRole("button", { name: /new group/i }));

    await waitFor(() => {
      const after = screen.getAllByText(/-/, { selector: "code" }).length;
      expect(after).toBe(before + 1);
    });
    // The toast region announces the new code (status / aria-live)
    expect(screen.getByRole("status").textContent ?? "").toMatch(
      /group code .*-.* created/i,
    );
  });
});
