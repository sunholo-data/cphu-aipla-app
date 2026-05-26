import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type MockedFunction,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import TeacherClassesPage from "@/app/teacher/classes/page";
import * as teacherApi from "@/lib/teacherApi";
import type { ClassPayload } from "@/lib/teacherApi";

function makeClass(overrides: Partial<ClassPayload> = {}): ClassPayload {
  return {
    classId: "c-1",
    ownerUid: "teacher-1",
    name: "Physik 9A",
    description: null,
    tagNamespace: "class:teacher-1:c-1",
    lessons: [],
    groupCodes: [],
    revoked: false,
    createdAt: "2026-05-26T00:00:00Z",
    updatedAt: "2026-05-26T00:00:00Z",
    revokedAt: null,
    ...overrides,
  };
}

type ListClassesMock = MockedFunction<typeof teacherApi.listClasses>;
type CreateClassMock = MockedFunction<typeof teacherApi.createClass>;

let listSpy: ListClassesMock;
let createSpy: CreateClassMock;

beforeEach(() => {
  listSpy = vi.spyOn(teacherApi, "listClasses") as unknown as ListClassesMock;
  createSpy = vi.spyOn(teacherApi, "createClass") as unknown as CreateClassMock;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/teacher/classes — dashboard", () => {
  it("renders class cards from the /api/classes response", async () => {
    listSpy.mockResolvedValue([
      makeClass({ classId: "a", name: "Class A" }),
      makeClass({ classId: "b", name: "Class B", lessons: ["s1"], groupCodes: ["x-y-1"] }),
    ]);

    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Class A" })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Class B" })).toBeInTheDocument();
  });

  it("links each class card to its detail page", async () => {
    listSpy.mockResolvedValue([makeClass({ classId: "abc", name: "Alpha" })]);
    render(<TeacherClassesPage />);
    await waitFor(() => {
      const link = screen
        .getAllByRole("link", { name: /manage/i })
        .find((el) => el.getAttribute("href") === "/teacher/classes/abc");
      expect(link).toBeDefined();
    });
  });

  it("shows an empty state when the teacher has no classes", async () => {
    listSpy.mockResolvedValue([]);
    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(screen.getByText(/no classes yet/i)).toBeInTheDocument();
    });
  });

  it("shows an error banner when /api/classes fails", async () => {
    listSpy.mockRejectedValue(new Error("boom"));
    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/boom/);
    });
  });

  it("links to the analytics chat surface", async () => {
    listSpy.mockResolvedValue([]);
    render(<TeacherClassesPage />);
    await waitFor(() => {
      const link = screen.getByRole("link", {
        name: /chat with all session data/i,
      });
      expect(link).toHaveAttribute("href", "/teacher/analytics");
    });
  });

  it("submits the new-class form to createClass and refreshes the list", async () => {
    const user = userEvent.setup();
    listSpy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeClass({ classId: "new", name: "Brand new" })]);
    createSpy.mockResolvedValue(makeClass({ classId: "new", name: "Brand new" }));

    render(<TeacherClassesPage />);
    await waitFor(() => {
      expect(screen.getByText(/no classes yet/i)).toBeInTheDocument();
    });

    // Click the top-right "New class" header button
    const newClassButtons = screen.getAllByRole("button", { name: /new class/i });
    await user.click(newClassButtons[0]!);

    const nameInput = await screen.findByLabelText(/class name/i);
    await user.type(nameInput, "Brand new");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({
        name: "Brand new",
        description: null,
      });
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Brand new" })).toBeInTheDocument();
    });
  });
});
