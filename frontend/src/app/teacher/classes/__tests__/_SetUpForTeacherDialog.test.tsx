import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import * as programmeApi from "@/lib/programmeApi";
import { SetUpForTeacherDialog } from "@/app/teacher/classes/_SetUpForTeacherDialog";

afterEach(() => vi.restoreAllMocks());

/** 1.1.124 M2 — one dialog takes a teacher from "demo only" to "waiting for students". */
describe("SetUpForTeacherDialog", () => {
  it("offers only signed-in granted teachers and the researcher's own non-demo classes, then submits", async () => {
    vi.spyOn(programmeApi, "fetchOnboarding").mockResolvedValue({
      count: 2,
      teachers: [
        { email: "bob@ku.dk", uid: "u-bob", tier: "pilot", grantedAt: "", classes: 1, stage: "demo_only", since: null, days: 9, nextStep: "Create the class" },
        { email: "never@ku.dk", uid: null, tier: "pilot", grantedAt: "", classes: 0, stage: "invited", since: null, days: 2, nextStep: "Sign in" },
      ],
    });
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([
      { classId: "demo", name: "Demo class", demo: true, ownerUid: "r", description: null, tagNamespace: "", lessons: [], activityIds: ["a"], groupCodes: [], revoked: false, createdAt: "", updatedAt: "", revokedAt: null },
      { classId: "tpl", name: "Starter", ownerUid: "r", description: null, tagNamespace: "", lessons: [], activityIds: ["a", "b"], groupCodes: [], revoked: false, createdAt: "", updatedAt: "", revokedAt: null },
    ]);
    const create = vi.spyOn(teacherApi, "createClassForTeacher").mockResolvedValue({
      classId: "new", name: "Bob's first", ownerUid: "u-bob", description: null, tagNamespace: "", lessons: [], activityIds: ["x", "y"], groupCodes: ["k"], revoked: false, createdAt: "", updatedAt: "", revokedAt: null,
      codes: ["soft-otter-44"], copiedActivityIds: ["x", "y"],
    });
    const onCreated = vi.fn();
    render(<SetUpForTeacherDialog onCreated={onCreated} onCancel={() => {}} />);

    const teacherSelect = (await screen.findByRole("combobox", { name: /teacher/i })) as HTMLSelectElement;
    await waitFor(() => expect(teacherSelect.options.length).toBe(2)); // placeholder + bob; never@ has no uid
    expect(teacherSelect.options[1].textContent).toContain("bob@ku.dk — Demo only — 9 days");
    const templateSelect = screen.getByRole("combobox", { name: /copy activities from/i }) as HTMLSelectElement;
    await waitFor(() => expect(templateSelect.options.length).toBe(2)); // none + Starter; demo excluded
    expect(templateSelect.options[1].textContent).toBe("Starter (2)");

    fireEvent.change(teacherSelect, { target: { value: "u-bob" } });
    fireEvent.change(screen.getByRole("textbox", { name: /class name/i }), { target: { value: "Bob's first" } });
    fireEvent.change(templateSelect, { target: { value: "tpl" } });
    fireEvent.click(screen.getByRole("button", { name: /set up class/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ ownerUid: "u-bob", name: "Bob's first", templateClassId: "tpl" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("2 activities copied, join code soft-otter-44");
    expect(onCreated).toHaveBeenCalled();
  });

  it("says plainly when the teacher got no code because they cannot spend", async () => {
    vi.spyOn(programmeApi, "fetchOnboarding").mockResolvedValue({
      count: 1,
      teachers: [{ email: "v@ku.dk", uid: "u-v", tier: "visitor", grantedAt: "", classes: 0, stage: "demo_only", since: null, days: 1, nextStep: "x" }],
    });
    vi.spyOn(teacherApi, "listClasses").mockResolvedValue([]);
    vi.spyOn(teacherApi, "createClassForTeacher").mockResolvedValue({
      classId: "new", name: "V", ownerUid: "u-v", description: null, tagNamespace: "", lessons: [], activityIds: [], groupCodes: [], revoked: false, createdAt: "", updatedAt: "", revokedAt: null,
      codes: [], copiedActivityIds: [],
    });
    render(<SetUpForTeacherDialog onCreated={() => {}} onCancel={() => {}} />);
    const teacherSelect = (await screen.findByRole("combobox", { name: /teacher/i })) as HTMLSelectElement;
    await waitFor(() => expect(teacherSelect.options.length).toBe(2));
    fireEvent.change(teacherSelect, { target: { value: "u-v" } });
    fireEvent.change(screen.getByRole("textbox", { name: /class name/i }), { target: { value: "V" } });
    fireEvent.click(screen.getByRole("button", { name: /set up class/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/no join code, the teacher is not on the spend register/);
  });
});
