import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";

import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

/**
 * Activities index — the nav destination for the activity library.
 * Minimal for now (P2): a header + first-run empty state on the new
 * primitives. The full library/builder re-home is a later phase (P4).
 */
export default function TeacherActivitiesPage() {
  return (
    <TeacherPage
      title="Activities"
      actions={
        <Link
          href="/teacher/activities/new"
          className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New activity
        </Link>
      }
    >
      <EmptyState
        icon={ClipboardList}
        title="Your activities live here"
        description="Create a from-scratch activity — a concept dialogue, a quiz, a lab notebook, or a sim — and hand it to a class with a group code."
        action={
          <Link
            href="/teacher/activities/new"
            className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New activity
          </Link>
        }
      />
    </TeacherPage>
  );
}
