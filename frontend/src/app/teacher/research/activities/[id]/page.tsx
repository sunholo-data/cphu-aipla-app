"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ClipboardList, ShieldAlert } from "lucide-react";

import { type ActivityPayload, fetchActivity } from "@/lib/teacherApi";
import { VisibilityBadge } from "@/components/teacher/activityDisplay";
import { ConceptMapView } from "@/components/workspace/ConceptMapView";
import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

type Status = "loading" | "ok" | "forbidden" | "notfound" | "error";

/**
 * Research view — read-only DETAIL of one activity (RVIEW-1 M1). The list
 * (`/teacher/research/activities`) shows summary cards; this drills into
 * everything the teacher configured in the editor — identity, teaching goal,
 * every element in detail (incl. the concept-map graph), and materials — with
 * no edit affordances. Researcher-only: the single-activity GET allows the
 * owner OR a researcher (the `_load_for_modify` bypass); a plain teacher
 * reaching another teacher's activity 404s, surfaced here as not-found.
 */
export default function ResearchActivityDetailPage() {
  const id = String(useParams().id ?? "");
  const [status, setStatus] = useState<Status>("loading");
  const [activity, setActivity] = useState<ActivityPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetchActivity(id)
      .then((a) => {
        if (cancelled) return;
        setActivity(a);
        setStatus("ok");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "";
        setStatus(msg.includes(" 403") ? "forbidden" : msg.includes(" 404") ? "notfound" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const backLink = (
    <Link
      href="/teacher/research/activities"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All activities
    </Link>
  );

  if (status !== "ok" || !activity) {
    return (
      <TeacherPage title="Research" breadcrumb={backLink}>
        {status === "loading" ? (
          <p className="text-sm text-muted-foreground">Loading activity&hellip;</p>
        ) : status === "forbidden" ? (
          <EmptyState
            icon={ShieldAlert}
            title="Researcher access required"
            description="This read-only research detail is available to accounts with the researcher role."
          />
        ) : status === "notfound" ? (
          <EmptyState icon={ClipboardList} title="Activity not found" description="It may have been deleted." />
        ) : (
          <EmptyState
            icon={ClipboardList}
            title="Couldn’t load the activity"
            description="Something went wrong. Try again in a moment."
          />
        )}
      </TeacherPage>
    );
  }

  const a = activity;
  return (
    <TeacherPage
      title={a.title || a.activityId}
      subtitle={`Owner: ${a.ownerLabel ?? a.ownerUid}`}
      breadcrumb={backLink}
      actions={<VisibilityBadge visibility={a.visibility} />}
    >
      <p className="mb-3 flex items-center gap-1.5 rounded border border-dashed border-border bg-muted/40 p-2 text-xs text-muted-foreground">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Research view — read-only. This is exactly what the teacher configured; nothing here is editable.
      </p>

      <div className="flex flex-col gap-3">
        <Section title="Setup">
          <Field label="Language">{a.language === "da" ? "Dansk" : "English"}</Field>
          <Field label="Difficulty">{a.difficulty ?? "standard"}</Field>
          {a.interactionStyle ? <Field label="Interaction style">{a.interactionStyle}</Field> : null}
          {a.persona ? <Field label="Persona">{a.persona}</Field> : null}
          <Field label="Runs skill">{a.skillId}</Field>
          {a.artefactId ? <Field label="Simulation">{a.artefactId}</Field> : null}
          {a.sourceOwnerUid ? (
            <Field label="Adapted from">{a.sourceOwnerLabel ?? a.sourceOwnerUid}</Field>
          ) : null}
        </Section>

        <Section title="Lesson prompt (teaching goal)">
          {a.teachingGoal ? (
            <p className="whitespace-pre-wrap text-sm">{a.teachingGoal}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No lesson prompt set.</p>
          )}
        </Section>

        {a.checklist?.length ? (
          <Section title={`Checklist (${a.checklist.length})`}>
            <ol className="list-decimal pl-5 text-sm">
              {a.checklist.map((c) => (
                <li key={c.id}>{c.label}</li>
              ))}
            </ol>
          </Section>
        ) : null}

        {a.table?.length ? (
          <Section title="Data table">
            {a.table.map((t) => (
              <div key={t.id} className="text-sm">
                {t.title ? <p className="font-medium">{t.title}</p> : null}
                <p className="text-muted-foreground">
                  {t.rows} rows · columns: {t.columns.map((c) => `${c.label}${c.unit ? ` (${c.unit})` : ""}`).join(", ")}
                </p>
              </div>
            ))}
          </Section>
        ) : null}

        {a.chart?.length ? (
          <Section title="Chart">
            {a.chart.map((c) => (
              <p key={c.id} className="text-sm">
                {c.title || "Chart"} — {c.chartKind}
              </p>
            ))}
          </Section>
        ) : null}

        {a.calculator?.length ? (
          <Section title="Calculator">
            {a.calculator.map((c) => (
              <div key={c.id} className="text-sm">
                {c.title ? <p className="font-medium">{c.title}</p> : null}
                <p className="font-mono text-xs">
                  {c.formula} · inputs: {c.inputs.map((i) => i.id).join(", ")}
                </p>
              </div>
            ))}
          </Section>
        ) : null}

        {a.note?.length ? (
          <Section title="Note">
            {a.note.map((n) => (
              <div key={n.id} className="text-sm">
                {n.title ? <p className="font-medium">{n.title}</p> : null}
                <p className="whitespace-pre-wrap text-muted-foreground">{n.body}</p>
              </div>
            ))}
          </Section>
        ) : null}

        {a.solution?.length ? (
          <Section title="Solution (student submits)">
            <p className="text-sm">{a.solution[0]!.prompt || "(no prompt)"}</p>
          </Section>
        ) : null}

        {a.document?.length ? (
          <Section title="Document upload (student submits)">
            <p className="text-sm">{a.document[0]!.prompt || "(no prompt)"}</p>
          </Section>
        ) : null}

        {a.conceptMap?.length ? (
          <Section title="Concept map">
            <ConceptMapView conceptMap={a.conceptMap} />
            <ConceptCheckQuestions conceptMap={a.conceptMap} />
          </Section>
        ) : null}

        {a.materials?.length ? (
          <Section title={`Materials (${a.materials.length})`}>
            <ul className="text-sm">
              {a.materials.map((m, i) => (
                <li key={m.docId || m.materialId || i} className="flex items-center gap-2">
                  <span>{m.origin || m.alt || m.docId || "material"}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.kind === "image" ? "image" : m.kind === "context" ? "in context" : "curriculum"} ·{" "}
                    {m.studentVisible ? "student-visible" : "grounding only"}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </TeacherPage>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <TeacherCard>
      <h2 className="mb-1.5 text-sm font-semibold">{title}</h2>
      <div className="flex flex-col gap-1.5">{children}</div>
    </TeacherCard>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="flex gap-2 text-sm">
      <span className="w-32 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span>{children}</span>
    </p>
  );
}

/** Per-node check questions — the concept map graph shows structure; this
 *  surfaces the chat-native checkpoint questions the teacher authored. */
function ConceptCheckQuestions({ conceptMap }: { conceptMap: ActivityPayload["conceptMap"] }) {
  const nodes = (conceptMap?.[0]?.nodes ?? []).filter((n) => n.checkQuestions?.length);
  if (nodes.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5 text-sm">
      {nodes.map((n) => (
        <div key={n.id}>
          <p className="font-medium">{n.label}</p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {n.checkQuestions!.map((q) => (
              <li key={q.id}>{q.prompt}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
