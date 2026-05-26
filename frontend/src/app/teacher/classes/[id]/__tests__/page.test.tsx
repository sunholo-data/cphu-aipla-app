import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  type MockedFunction,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { MOCK_CLASSES } from "@/app/teacher/_mock-data";
import * as teacherApi from "@/lib/teacherApi";
import type { ClassPayload } from "@/lib/teacherApi";

const targetClass = MOCK_CLASSES[0]!;
const CLASS_ID = targetClass.id;

function makeClassPayload(overrides: Partial<ClassPayload> = {}): ClassPayload {
  return {
    classId: CLASS_ID,
    ownerUid: "teacher-1",
    name: targetClass.name,
    description: null,
    tagNamespace: `class:teacher-1:${CLASS_ID}`,
    lessons: [],
    groupCodes: ["bright-fox-12", "soft-otter-44"],
    revoked: false,
    createdAt: "2026-05-26T00:00:00Z",
    updatedAt: "2026-05-26T00:00:00Z",
    revokedAt: null,
    ...overrides,
  };
}

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: CLASS_ID }),
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));

// Importing after vi.mock so the mocked hook is wired before the page resolves.
import TeacherClassDetailPage from "@/app/teacher/classes/[id]/page";

type GetClassMock = MockedFunction<typeof teacherApi.getClass>;
type MintMock = MockedFunction<typeof teacherApi.mintGroupCodes>;

let getSpy: GetClassMock;
let mintSpy: MintMock;

beforeEach(() => {
  getSpy = vi.spyOn(teacherApi, "getClass") as unknown as GetClassMock;
  mintSpy = vi.spyOn(teacherApi, "mintGroupCodes") as unknown as MintMock;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/teacher/classes/[id] — class detail", () => {
  it("renders the class name and groups from /api/classes/{id}", async () => {
    getSpy.mockResolvedValue(makeClassPayload());
    render(<TeacherClassDetailPage />);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: targetClass.name }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("bright-fox-12")).toBeInTheDocument();
    expect(screen.getByText("soft-otter-44")).toBeInTheDocument();
  });

  it("'New group' click calls mintGroupCodes and refreshes the list", async () => {
    getSpy
      .mockResolvedValueOnce(makeClassPayload({ groupCodes: [] }))
      .mockResolvedValueOnce(makeClassPayload({ groupCodes: ["fresh-mint-01"] }));
    mintSpy.mockResolvedValue({
      classId: CLASS_ID,
      codes: ["fresh-mint-01"],
    });

    render(<TeacherClassDetailPage />);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: targetClass.name }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /new group/i }));

    await waitFor(() => {
      expect(mintSpy).toHaveBeenCalledWith(CLASS_ID, 1);
    });
    await waitFor(() => {
      expect(screen.getByText("fresh-mint-01")).toBeInTheDocument();
    });
    expect(screen.getByRole("status").textContent ?? "").toMatch(
      /group code fresh-mint-01 created/i,
    );
  });

  it("shows an error banner when the class fails to load", async () => {
    getSpy.mockRejectedValue(new Error("permission denied"));
    render(<TeacherClassDetailPage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/permission denied/);
    });
  });
});
