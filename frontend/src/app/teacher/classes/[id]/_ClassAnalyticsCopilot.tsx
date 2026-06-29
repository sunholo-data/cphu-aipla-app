"use client";

import { TeacherCopilot } from "@/components/teacher/copilot";

/**
 * Read-only analytics co-pilot scoped to ONE class — the shared shell with no
 * proposal/apply config (analytics answers in chat, nothing to Apply). Floats
 * on the class detail page so a teacher can ask about the class they're looking
 * at ("how active this week?", "which group did most?", "common misconceptions?")
 * right where they're working — no separate analytics page. Scope rides the
 * message prefix, the same `[class_id=…]` contract the analytics-chat skill uses.
 */
export function ClassAnalyticsCopilot({ classId, className }: { classId: string; className?: string }) {
  return (
    <TeacherCopilot
      skillName="analytics-chat"
      title="Analytics co-pilot"
      // Per-class thread — each class resumes its own analytics conversation.
      persistKey={`analytics-chat:${classId}`}
      scopePrefix={`[class_id=${classId} time_scope="this week"] `}
      placeholder={`Ask about ${className ?? "this class"}…`}
      emptyText="Ask about this class — messages this week, most-active groups, time on task, common misconceptions. I answer here; I don't change anything."
      stripPrefix={(content) => content.replace(/^\[class_id=[^\]]+\]\s*/, "")}
    />
  );
}
