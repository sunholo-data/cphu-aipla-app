"use client";

import { useEffect, useState } from "react";
import { BookOpen, RotateCcw, ShieldAlert } from "lucide-react";

import {
  type FrameworkStructure,
  type TeachingFrameworkPayload,
  listTeachingFrameworks,
  revertFrameworkInstruction,
  saveFrameworkInstruction,
  saveFrameworkStructure,
} from "@/lib/teacherApi";
import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { FrameworkStructureEditor } from "@/components/teacher/research/FrameworkStructureEditor";
import { TutorApproachPanel } from "@/components/teacher/research/TutorApproachPanel";

type Status = "loading" | "ok" | "forbidden" | "error";

/** Which editor is open on a framework.
 *
 *  `structure` edits the theory and regenerates the instruction from it;
 *  `text` edits the rendered instruction directly. Both are kept because they
 *  answer different needs — but they are alternatives, not layers, and saving
 *  one drops the other server-side. The card opens on whichever the researcher
 *  last used (`overrideMode`), defaulting to the structural one, because that is
 *  the edit that keeps the prompt traceable to its sources.
 */
type EditorMode = "structure" | "text";

/**
 * Teaching frameworks (1.1.91 M1) — researcher-only.
 *
 * The surface that makes the design doc's premise false in the right direction:
 * a tutor's pedagogy stops being a file in git that only a developer can edit.
 * A researcher reads the instruction generated from the framework's constructs,
 * edits it, and the next tutor turn uses the edit — no commit, no deploy, no
 * seed.
 *
 * The generated text is always shown beside the override rather than replaced
 * by it, so an edit reads as a *delta from the theory*. That is what keeps a
 * hand-written prompt reviewable, which is the whole reason the framework
 * carries structured constructs instead of a prompt string.
 *
 * Access is enforced by the backend (`assert_researcher` on every route), so a
 * non-researcher who reaches this URL gets an access-required state.
 */
export default function ResearchFrameworksPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [frameworks, setFrameworks] = useState<TeachingFrameworkPayload[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("structure");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listTeachingFrameworks()
      .then((rows) => {
        if (cancelled) return;
        setFrameworks(rows);
        setStatus("ok");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const forbidden = err instanceof Error && err.message.includes(" 403");
        setStatus(forbidden ? "forbidden" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const replace = (updated: TeachingFrameworkPayload) =>
    setFrameworks((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));

  const open = (fw: TeachingFrameworkPayload, next?: EditorMode) => {
    setOpenId(fw.id);
    setMode(next ?? (fw.overrideMode === "text" ? "text" : "structure"));
    setDraft(fw.instruction);
    setError(null);
  };

  const saveStructure = async (fw: TeachingFrameworkPayload, structure: FrameworkStructure) => {
    setBusy(true);
    setError(null);
    try {
      replace(await saveFrameworkStructure(fw.id, structure));
      setOpenId(null);
    } catch {
      setError("Could not save. Your edit is still here — try again.");
    } finally {
      setBusy(false);
    }
  };

  const save = async (fw: TeachingFrameworkPayload) => {
    setBusy(true);
    setError(null);
    try {
      replace(await saveFrameworkInstruction(fw.id, draft));
      setOpenId(null);
    } catch {
      setError("Could not save. Your edit is still here — try again.");
    } finally {
      setBusy(false);
    }
  };

  const revert = async (fw: TeachingFrameworkPayload) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await revertFrameworkInstruction(fw.id);
      replace(updated);
      setDraft(updated.instruction);
    } catch {
      setError("Could not revert. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <TeacherPage
      title="Teaching frameworks"
      subtitle={
        status === "ok" ? `${frameworks.length} frameworks · what the tutor is told to do` : undefined
      }
    >
      {status === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading frameworks&hellip;</p>
      ) : status === "forbidden" ? (
        <EmptyState
          icon={ShieldAlert}
          title="Researcher access required"
          description="Teaching frameworks are part of the research instrument set. Ask a platform admin for the researcher role."
        />
      ) : status === "error" ? (
        <EmptyState
          icon={ShieldAlert}
          title="Could not load frameworks"
          description="Something went wrong reading the framework catalogue. Reload to try again."
        />
      ) : (
        <div className="space-y-4">
          <TutorApproachPanel
            frameworks={frameworks.map((f) => ({
              id: f.id,
              // The teacher-facing plain name lives on /api/tutors; here the
              // label is what we have, and a researcher knows the theory names.
              name: f.label,
              isPlaceholder: f.status === "placeholder",
            }))}
          />
          {frameworks.map((fw) => {
            const isOpen = openId === fw.id;
            const editable = fw.status !== "placeholder";
            return (
              <TeacherCard key={fw.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-base font-medium">
                      <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      {fw.label}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">{fw.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {fw.status === "placeholder" ? (
                        <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
                          Awaiting pedagogical content
                        </span>
                      ) : null}
                      {/* A placeholder has no constructs, so there is nothing
                          generated to claim — it gets neither badge. */}
                      {!editable ? null : fw.isOverridden ? (
                        <span className="rounded bg-brand/10 px-2 py-0.5 text-brand">
                          {fw.overrideMode === "text" ? "Wording edited" : "Approach edited"}
                          {fw.overrideVersion ? ` · v${fw.overrideVersion}` : ""}
                        </span>
                      ) : (
                        <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
                          Generated from the theory
                        </span>
                      )}
                    </div>
                  </div>
                  {editable ? (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => (isOpen && mode === "structure" ? setOpenId(null) : open(fw, "structure"))}
                        className="rounded border px-3 py-1.5 text-sm hover:bg-muted"
                      >
                        {isOpen && mode === "structure" ? "Close" : "Edit teaching approach"}
                      </button>
                      <button
                        type="button"
                        onClick={() => (isOpen && mode === "text" ? setOpenId(null) : open(fw, "text"))}
                        className="rounded border px-3 py-1.5 text-sm hover:bg-muted"
                      >
                        {isOpen && mode === "text" ? "Close" : "Edit wording"}
                      </button>
                    </div>
                  ) : null}
                </div>

                {isOpen && mode === "structure" ? (
                  <FrameworkStructureEditor
                    framework={fw}
                    busy={busy}
                    error={error}
                    onCancel={() => setOpenId(null)}
                    onSave={(structure) => void saveStructure(fw, structure)}
                  />
                ) : null}

                {isOpen && mode === "text" ? (
                  <div className="mt-4 space-y-4 border-t pt-4">
                    <p className="text-xs text-muted-foreground">
                      Editing the wording directly replaces what is generated from the theory. The
                      tutor will say what you write here, and the link back to the constructs and
                      sources is not kept — use “Edit teaching approach” to change what it teaches
                      and keep that link.
                    </p>
                    <div>
                      <label
                        htmlFor={`instruction-${fw.id}`}
                        className="mb-1 block text-sm font-medium"
                      >
                        What the tutor is told
                      </label>
                      <textarea
                        id={`instruction-${fw.id}`}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={16}
                        className="w-full rounded border bg-background p-3 font-mono text-xs"
                      />
                    </div>

                    {/* The generated text stays visible so an edit reads as a
                        delta from the theory, not as an opaque prompt. */}
                    <details className="rounded border bg-muted/40 p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        Generated from {fw.constructs.length} constructs — the version without your edits
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                        {fw.defaultInstruction}
                      </pre>
                    </details>

                    {fw.provenance.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {fw.provenance[0].citation} — vouched by {fw.provenance[0].vouchedBy}
                      </p>
                    ) : null}

                    {error ? <p className="text-sm text-destructive">{error}</p> : null}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || !draft.trim() || draft === fw.instruction}
                        onClick={() => void save(fw)}
                        className="rounded bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
                      >
                        {busy ? "Saving…" : "Save"}
                      </button>
                      {fw.isOverridden ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void revert(fw)}
                          className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                          Revert to generated
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </TeacherCard>
            );
          })}
        </div>
      )}
    </TeacherPage>
  );
}
