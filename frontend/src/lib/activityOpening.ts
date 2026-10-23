/** Student-facing facts from /activity-configs/active; default prose lives in messages/. */
export interface ActivityOpening {
  text: string;
  source: "default" | "teacher";
  firstItem: { kind: string; title: string } | null;
  steps: string[];
  starterPrompts: string[];
  byTeacher: boolean;
}
