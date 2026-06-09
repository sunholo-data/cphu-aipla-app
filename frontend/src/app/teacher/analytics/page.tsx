"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";

import { AnalyticsChat } from "./_AnalyticsChat";
import { InsightsTabs } from "@/components/teacher/insights/InsightsTabs";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { type ClassPayload, listClasses } from "@/lib/teacherApi";

const TIME_SCOPES = ["All time", "This week", "Today"];

export default function TeacherAnalyticsPage() {
  const [classes, setClasses] = useState<ClassPayload[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [timeScope, setTimeScope] = useState(TIME_SCOPES[0]!);

  useEffect(() => {
    void listClasses()
      .then((cls) => {
        setClasses(cls);
        if (cls[0]) setSelectedClassId(cls[0].classId);
      })
      .catch(() => {
        // API unavailable (e.g. no auth yet) — show empty state; page
        // still renders and the teacher can try again after sign-in.
      });
  }, []);

  const selectedClass = classes.find((c) => c.classId === selectedClassId);

  return (
    <TeacherPage
      breadcrumb={
        <Link
          href="/teacher/classes"
          className="flex w-fit items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </Link>
      }
      title="Insights"
      subtitle="Ask the data"
      actions={
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Data scope:</span>
          <ClassSelect classes={classes} value={selectedClassId} onChange={setSelectedClassId} />
          <TimeSelect value={timeScope} onChange={setTimeScope} options={TIME_SCOPES} />
        </div>
      }
    >
      <InsightsTabs />

      <AnalyticsChat
        classId={selectedClassId}
        className={selectedClass?.name ?? ""}
        timeScope={timeScope}
      />
    </TeacherPage>
  );
}

function ClassSelect({
  classes,
  value,
  onChange,
}: {
  classes: ClassPayload[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (classes.length === 0) {
    return (
      <span className="rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
        Loading classes…
      </span>
    );
  }
  return (
    <label className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground">
      <span className="sr-only">Class</span>
      <select
        aria-label="Filter by class"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent text-xs focus:outline-none"
      >
        {classes.map((c) => (
          <option key={c.classId} value={c.classId}>
            {c.name}
          </option>
        ))}
      </select>
      <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
    </label>
  );
}

function TimeSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground">
      <span className="sr-only">Time range</span>
      <select
        aria-label="Filter by time range"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent text-xs focus:outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
    </label>
  );
}
