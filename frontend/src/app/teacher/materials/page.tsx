/**
 * /teacher/materials — the standalone document library (1.1.61).
 *
 * Why this page exists: `MaterialsSection` was mounted in exactly one place,
 * the activity builder, so the ONLY way to retag a document, move it into a
 * folder, or set its subject was to open (or invent) an activity. That is the
 * friction that left the whole shared corpus Unfiled: `seed_curriculum_folders`
 * created the nine physics folders on 2026-07-30 but deliberately refused to
 * guess a subject for each doc, deferring to a classifier that does not exist
 * yet — leaving manual filing as the only path, behind a door nobody would
 * think to open.
 *
 * Scope note: the corpus is SHARED (teacher-curated) plus the signed-in
 * teacher's own uploads — it is not class-scoped, which is why this is a
 * top-level destination rather than a tab inside a class.
 *
 * Permissions: `PATCH /api/curriculum/{doc_id}` is teacher-only and accepts any
 * doc whose ownerScope is `shared` or the caller's uid, so every teacher can
 * refile every shared document. The page adds no gate of its own; the teacher
 * shell already blocks non-teachers, and the backend is the real boundary.
 */

"use client";

import { MaterialsSection } from "@/components/teacher/MaterialsSection";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

/** The library curates the corpus; it cites nothing. A frozen empty set and a
 *  no-op keep the controlled component honest — there is no activity here whose
 *  materials could change. */
const NO_MATERIALS: never[] = [];
const noop = () => {};

export default function TeacherMaterialsPage() {
  return (
    <TeacherPage
      title="Materials"
      subtitle="Upload, organise and read the documents your activities draw on."
    >
      <MaterialsSection mode="library" materials={NO_MATERIALS} onChange={noop} />
    </TeacherPage>
  );
}
