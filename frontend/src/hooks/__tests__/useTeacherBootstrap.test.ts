import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import { useTeacherBootstrap } from "@/hooks/useTeacherBootstrap";

describe("useTeacherBootstrap", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls bootstrap once when signed in, and not again on re-render", async () => {
    const spy = vi.spyOn(teacherApi, "bootstrapTeacher").mockResolvedValue({ seeded: false });
    const { rerender } = renderHook(({ s }: { s: boolean }) => useTeacherBootstrap(s), {
      initialProps: { s: true },
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    rerender({ s: true });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1)); // still once (ran-once ref)
  });

  it("does not call bootstrap when not signed in", async () => {
    const spy = vi.spyOn(teacherApi, "bootstrapTeacher").mockResolvedValue({ seeded: false });
    renderHook(() => useTeacherBootstrap(false));
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });
});
