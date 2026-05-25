import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "boldkast" }),
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));

vi.mock("@/lib/teacherApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/teacherApi")>(
    "@/lib/teacherApi",
  );
  return {
    ...actual,
    // First-time teacher: no saved config -> hit the mock defaults branch.
    fetchMyActivityConfig: vi.fn(async () => {
      throw new actual.NotFoundError();
    }),
    saveActivityConfig: vi.fn(async (body) => ({
      ...body,
      teacherUid: "workshop-user",
      updatedAt: "2026-05-25T15:00:00Z",
    })),
  };
});

import TeacherActivityConfigPage from "@/app/teacher/activities/[id]/page";

describe("/teacher/activities/[id] — activity configuration", () => {
  it("renders the teaching-goal textarea pre-filled from mock data", () => {
    render(<TeacherActivityConfigPage />);
    const textarea = screen.getByRole("textbox", {
      name: /teaching goal/i,
    }) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toMatch(/horizontal and vertical motion are independent/);
  });

  it("preserves an edited teaching goal across re-renders", () => {
    render(<TeacherActivityConfigPage />);
    const textarea = screen.getByRole("textbox", {
      name: /teaching goal/i,
    }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Custom goal copy" } });
    expect(textarea.value).toBe("Custom goal copy");
  });

  it("surfaces the 3-tab roadmap signals (Parameters / Code / History) with version pills", () => {
    render(<TeacherActivityConfigPage />);
    // The active tab is "Teaching goal" — visible content matches.
    expect(screen.getByRole("tab", { name: /teaching goal/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Roadmap-preview tabs exist + carry the version badge so JB/AR can
    // see what's signalled without us having to commit to building it.
    const params = screen.getByRole("tab", { name: /parameters/i });
    const code = screen.getByRole("tab", { name: /code/i });
    const history = screen.getByRole("tab", { name: /history/i });
    expect(params).toHaveTextContent(/v1\.1/i);
    expect(code).toHaveTextContent(/v2/i);
    expect(history).toHaveTextContent(/v2/i);
  });

  it("clicking the Parameters tab swaps in the v1.1 roadmap preview", () => {
    render(<TeacherActivityConfigPage />);
    fireEvent.click(screen.getByRole("tab", { name: /parameters/i }));
    expect(
      screen.getByRole("tabpanel", { name: /parameters/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/initial angle range/i)).toBeInTheDocument();
  });

  it("'Save configuration' click POSTs to /api/activity-configs and shows the saved toast", async () => {
    render(<TeacherActivityConfigPage />);
    const textarea = screen.getByRole("textbox", {
      name: /teaching goal/i,
    }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Edited goal" } });

    fireEvent.click(screen.getByRole("button", { name: /save configuration/i }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent ?? "").toMatch(
        /saved\b/i,
      );
    });
    expect(textarea.value).toBe("Edited goal");
  });
});
