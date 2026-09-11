"use client";

import { Bot, GraduationCap, Settings2 } from "lucide-react";

import type { ChatLogTurn } from "@/lib/teacherApi";

/** UI copy, lifted out of JSX (1.1.108 M4) so a translator can reach it. */
const copy = {
  loading: "Loading transcript…",
  failed: "Could not read this transcript.",
  empty: "No turns recorded for this conversation.",
  synthetic: "System opened the conversation",
  student: "Student",
  tutor: "Tutor",
  unknownRole: "Unattributed",
} as const;

export interface ChatLogTranscriptProps {
  turns: ChatLogTurn[] | null;
  status: "loading" | "ok" | "error";
}

function roleLabel(turn: ChatLogTurn): string {
  if (turn.role === "student") return copy.student;
  if (turn.role === "tutor") return copy.tutor;
  return copy.unknownRole;
}

/**
 * One conversation, in order (1.1.109).
 *
 * ⚠️ A synthetic turn is MARKED, not hidden. `[session_start]` is the non-empty
 * sentinel a system-driven turn has to send — `ag_ui_adk._convert_latest_message`
 * drops a message with falsy content — and it is logged under role='student'
 * like anything else. Rendering it as a student utterance would put words in a
 * student's mouth in a research record. Dropping it silently would hide that
 * the system, not the student, opened the conversation. So it is shown as what
 * it is.
 */
export function ChatLogTranscript({ turns, status }: ChatLogTranscriptProps) {
  if (status === "loading") {
    return <p className="text-sm text-muted-foreground">{copy.loading}</p>;
  }
  if (status === "error") {
    return <p className="text-sm text-destructive">{copy.failed}</p>;
  }
  if (!turns || turns.length === 0) {
    return <p className="text-sm text-muted-foreground">{copy.empty}</p>;
  }

  return (
    <ol className="flex flex-col gap-3">
      {turns.map((turn, i) => {
        const key = `${turn.turn_index ?? "x"}-${i}`;
        if (turn.is_synthetic) {
          return (
            <li
              key={key}
              className="flex items-center gap-2 rounded border border-dashed border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
            >
              <Settings2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{copy.synthetic}</span>
              <code className="ml-auto font-mono text-[11px] opacity-70">{turn.content}</code>
            </li>
          );
        }
        const isStudent = turn.role === "student";
        const Icon = isStudent ? GraduationCap : Bot;
        return (
          <li
            key={key}
            className={
              isStudent
                ? "rounded border border-border bg-background px-3 py-2"
                : "rounded border border-border bg-muted/40 px-3 py-2"
            }
          >
            <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{roleLabel(turn)}</span>
              {turn.turn_index !== null ? <span className="opacity-60">#{turn.turn_index}</span> : null}
              {turn.model ? <span className="ml-auto font-mono opacity-60">{turn.model}</span> : null}
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground">{turn.content}</p>
          </li>
        );
      })}
    </ol>
  );
}
