"use client";

// PublishedApproachList — the seven published approaches, as a TEACHER reads
// them (TUTOR-2 M1).
//
// 1.1.135's argument is that a teacher authoring a tutor must pick an approach
// SOMEBODY CAN READ. Until now the seven were invisible to a teacher: the
// researcher list 403s, and the page fell back to a tier that offered "try one"
// and "write your own" but never "here is what they are".
//
// Read-only by construction rather than by hiding buttons — the data this
// renders has no editor state in it, because the route serves teachers a
// different, smaller payload. See `fetchApproachCatalogue`.

import { useEffect, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";

import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { fetchApproachCatalogue, type PublishedApproach } from "@/lib/teacherApi";

const copy = {
  title: "The published approaches",
  blurb:
    "Seven teaching approaches drawn from the research literature and maintained by the research team. You can build a tutor on any of them — open one to read what the tutor is actually told.",
  loading: "Loading approaches…",
  failed: "The approaches could not be loaded just now.",
  none: "No published approaches are available.",
  constructsHeading: "What it is made of",
  instructionHeading: "What the tutor is told",
  behaviourCount: (n: number) => `${n} behaviour${n === 1 ? "" : "s"}`,
  placeholder: "Awaiting content",
  open: "Read this approach",
  close: "Close",
};

export function PublishedApproachList() {
  const [rows, setRows] = useState<PublishedApproach[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchApproachCatalogue()
      .then((approaches) => alive && setRows(approaches))
      // Never takes the page with it: the teacher tier's other tabs are the
      // ones they came for, and this is the reading material beside them.
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) return <p className="text-sm text-muted-foreground">{copy.failed}</p>;
  if (rows === null) return <p className="text-sm text-muted-foreground">{copy.loading}</p>;

  return (
    <div className="flex flex-col gap-3" data-testid="published-approaches">
      <p className="text-sm text-muted-foreground">{copy.blurb}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.none}</p>
      ) : (
        rows.map((a) => {
          const isOpen = openId === a.id;
          return (
            <TeacherCard key={a.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-1.5 text-sm font-medium">
                    <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {a.label}
                  </h3>
                  {a.summary ? <p className="mt-0.5 text-xs text-muted-foreground">{a.summary}</p> : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {a.status === "placeholder" ? copy.placeholder : copy.behaviourCount(
                      a.constructs.reduce((n, c) => n + c.behaviours.length, 0),
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : a.id)}
                  aria-label={`${isOpen ? copy.close : copy.open}: ${a.label}`}
                  className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                >
                  {isOpen ? copy.close : copy.open}
                  <ChevronDown className={`h-3.5 w-3.5 ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
              </div>

              {isOpen ? (
                <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                  {a.constructs.length > 0 ? (
                    <div>
                      <h4 className="text-xs font-medium">{copy.constructsHeading}</h4>
                      <ul className="mt-1 flex flex-col gap-2">
                        {a.constructs.map((c) => (
                          <li key={c.name}>
                            <p className="text-xs font-medium">{c.name}</p>
                            {c.summary ? <p className="text-xs text-muted-foreground">{c.summary}</p> : null}
                            <ul className="mt-0.5 list-disc pl-4 text-xs text-muted-foreground">
                              {c.behaviours.map((b) => (
                                <li key={b}>{b}</li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div>
                    <h4 className="text-xs font-medium">{copy.instructionHeading}</h4>
                    {/* The reviewability principle, shown rather than described:
                        this is the text the tutor receives, verbatim. */}
                    <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px] leading-relaxed">
                      {a.instruction}
                    </pre>
                  </div>
                </div>
              ) : null}
            </TeacherCard>
          );
        })
      )}
    </div>
  );
}
