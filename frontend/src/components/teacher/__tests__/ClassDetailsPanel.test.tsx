import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import { ClassDetailsPanel } from "@/components/teacher/ClassDetailsPanel";

/**
 * 1.1.112 — the class rename control.
 *
 * The backend PATCH and `patchClass()` both already existed and were tested; the
 * gap was that no UI called it. So the assertion that matters is that this
 * component actually reaches `patchClass` — not that it renders an input.
 */

function renderPanel(over: Partial<React.ComponentProps<typeof ClassDetailsPanel>> = {}) {
  const onSaved = vi.fn();
  render(
    <ClassDetailsPanel
      classId="c-1"
      initialName="Fysik C Energi"
      initialDescription={null}
      onSaved={onSaved}
      {...over}
    />,
  );
  return { onSaved };
}

afterEach(() => vi.restoreAllMocks());

describe("ClassDetailsPanel", () => {
  it("renames the class through patchClass and tells the parent to refresh", async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(teacherApi, "patchClass")
      .mockResolvedValue({} as unknown as teacherApi.ClassPayload);
    const { onSaved } = renderPanel();

    const name = screen.getByLabelText(/Class name/i);
    await user.clear(name);
    await user.type(name, "Fysik C — Energi og effekt");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("c-1", {
        name: "Fysik C — Energi og effekt",
        description: "",
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("Save is disabled until something actually changes", async () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeDisabled();
  });

  it("refuses an empty name rather than sending a 422 the teacher cannot read", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(teacherApi, "patchClass");
    renderPanel();

    await user.clear(screen.getByLabelText(/Class name/i));

    // A whitespace-only name is not a change worth enabling Save for, and must
    // never reach the backend's min_length=1.
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces a failed save instead of silently doing nothing", async () => {
    const user = userEvent.setup();
    vi.spyOn(teacherApi, "patchClass").mockRejectedValue(new Error("update class failed: 403"));
    const { onSaved } = renderPanel();

    await user.type(screen.getByLabelText(/Class name/i), " 2026");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/403/);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("an emptied description box clears the description", async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(teacherApi, "patchClass")
      .mockResolvedValue({} as unknown as teacherApi.ClassPayload);
    renderPanel({ initialDescription: "Old note" });

    await user.clear(screen.getByLabelText(/Description/i));
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("c-1", { name: "Fysik C Energi", description: "" }),
    );
  });
});
