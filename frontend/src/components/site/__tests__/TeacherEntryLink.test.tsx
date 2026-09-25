import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let emit: (user: unknown) => void = () => {};
vi.mock("@/lib/firebase", () => ({
  subscribeToAuthState: (cb: (user: unknown) => void) => {
    emit = cb;
    cb(null);
    return () => {};
  },
}));

import { TeacherEntryLink } from "../TeacherEntryLink";

const href = () => document.querySelector("a")?.getAttribute("href");

describe("TeacherEntryLink", () => {
  beforeEach(() => {
    emit = () => {};
  });

  it("offers sign-in when no teacher is signed in", () => {
    render(<TeacherEntryLink />);
    expect(href()).toBe("/teacher/sign-in");
  });

  it("goes straight to the classes when a teacher is already signed in", () => {
    const { getByText } = render(<TeacherEntryLink />);
    act(() => emit({ isAnonymous: false, email: "t@example.org" }));
    expect(href()).toBe("/teacher/classes");
    expect(getByText(/t@example.org/)).toBeTruthy();
  });

  it("drops back to sign-in when the teacher signs out", () => {
    render(<TeacherEntryLink />);
    act(() => emit({ isAnonymous: false, email: "t@example.org" }));
    act(() => emit(null));
    expect(href()).toBe("/teacher/sign-in");
  });
});
