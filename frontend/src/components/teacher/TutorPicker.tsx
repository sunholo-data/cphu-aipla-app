"use client";

import { useEffect, useState } from "react";
import { BookOpen, Check, Info } from "lucide-react";

import {
  type InteractionStyleSpec,
  type TutorCatalogue,
  type TutorPayload,
  fetchPersonaCatalogue,
  fetchTutorCatalogue,
  setClassTutor,
} from "@/lib/teacherApi";
import { INTERACTION_STYLE_HELP, INTERACTION_STYLE_LABEL } from "@/lib/personaDisplay";
import { TeachingStyleDisclosure } from "@/components/teacher/TeachingStyleDisclosure";
import { TutorVariantDialog } from "@/components/teacher/TutorVariantDialog";
import { useIsResearcher } from "@/hooks/useIsResearcher";

/**
 * The one tutor choice for a class (1.1.91 M1).
 *
 * A teacher has ONE question — how should this tutor teach? — and used to
 * answer it in three places (persona, teaching style, and a framework would
 * have been a third). A tutor bundles them: picking a card sets the avatar,
 * the voice, the tone and the pedagogy together.
 *
 * Class-level on purpose. The 1.1.32 Q4 decision put identity in class settings
 * and shows it read-only on the activity, because a duplicate per-activity
 * picker was problem 4 of teacher-ux-refinement.md. This is the same place, now
 * carrying more.
 *
 * Two UX rules this component exists to keep:
 *  1. **No bare acronyms.** The backend sends `frameworkName` already in plain
 *     language ("Question-and-use cycle (ESRU)"). Never re-derive it here.
 *  2. **The teacher can always see what the tutor is actually told.** The
 *     framework summary is one disclosure away, not buried in a design doc —
 *     the same reviewability principle as the public /project/tutors pages.
 */
export function TutorPicker({
  classId,
  selectedTutorId,
  onChange,
}: {
  classId: string;
  selectedTutorId: string | null;
  onChange?: (tutorId: string | null) => void;
}) {
  const isResearcher = useIsResearcher();
  const [tutors, setTutors] = useState<TutorPayload[]>([]);
  const [frameworks, setFrameworks] = useState<TutorCatalogue["frameworks"]>([]);
  const [variantOf, setVariantOf] = useState<TutorPayload | null>(null);
  const [styles, setStyles] = useState<InteractionStyleSpec[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(selectedTutorId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSelected(selectedTutorId), [selectedTutorId]);

  useEffect(() => {
    let cancelled = false;
    fetchTutorCatalogue()
      .then((cat) => {
        if (cancelled) return;
        setTutors(cat.tutors);
        setFrameworks(cat.frameworks);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    // The "how teaching styles are enforced" transparency (1.1.32) reads the
    // REAL preamble text from the backend, so it can never drift from what is
    // actually injected. Carried over when the tutor picker replaced the
    // persona panel — a teacher losing sight of what the tutor is told would
    // have been a real regression, not just a moved control.
    fetchPersonaCatalogue()
      .then((cat) => !cancelled && setStyles(cat.interactionStyles ?? []))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = async (tutorId: string) => {
    const next = tutorId === selected ? null : tutorId;
    setSaving(tutorId);
    setError(null);
    const previous = selected;
    setSelected(next); // optimistic — the list is the teacher's own click
    try {
      await setClassTutor(classId, next);
      onChange?.(next);
    } catch {
      setSelected(previous);
      setError("Could not save that choice. Nothing has changed — try again.");
    } finally {
      setSaving(null);
    }
  };

  if (state === "loading") {
    return <p className="text-sm text-muted-foreground">Loading tutors&hellip;</p>;
  }
  if (state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        Could not load the tutor list. Reload the page to try again.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        One choice sets the tutor&rsquo;s name, picture, voice, tone and teaching approach for
        every activity in this class.
      </p>

      <ul className="grid gap-2 sm:grid-cols-2">
        {tutors.map((t) => (
          <li key={t.id}>
            <TutorCard
              tutor={t}
              selected={selected === t.id}
              saving={saving === t.id}
              onClick={() => void choose(t.id)}
            />
          </li>
        ))}
      </ul>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {styles.length > 0 ? <TeachingStyleDisclosure styles={styles} /> : null}

      {/* Researcher-only (1.1.91 M5). A teacher picks from the library; a
          researcher extends it — the two-tier authoring model, where a teacher
          gets variants of researched tutors rather than blank frameworks. */}
      {isResearcher ? (
        variantOf ? (
          <TutorVariantDialog
            parent={variantOf}
            frameworks={frameworks}
            onCancel={() => setVariantOf(null)}
            onCreated={(v) => {
              setTutors((list) => [...list, v]);
              setVariantOf(null);
            }}
          />
        ) : (
          <details className="rounded border bg-muted/20 p-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Researcher: create a variant of a tutor
            </summary>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {tutors.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setVariantOf(t)}
                    className="rounded border px-2 py-1 text-xs hover:bg-accent"
                  >
                    {t.displayName}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )
      ) : null}

      {selected === null ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          No tutor chosen — this class uses the default identity and teaches as it always has.
        </p>
      ) : null}
    </div>
  );
}

function TutorCard({
  tutor,
  selected,
  saving,
  onClick,
}: {
  tutor: TutorPayload;
  selected: boolean;
  saving: boolean;
  onClick: () => void;
}) {
  const style = INTERACTION_STYLE_LABEL[tutor.interactionStyle];
  // The second line is the whole point of bundling: tone AND pedagogy, in
  // words a teacher can act on, without opening anything.
  const teaches = tutor.frameworkName ?? "no set teaching approach";

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        selected ? "border-brand bg-brand/5" : "border-border hover:bg-accent"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        disabled={saving}
        className="flex w-full items-start gap-3 text-left disabled:opacity-60"
      >
        {tutor.persona?.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tutor.persona.avatar}
            alt=""
            aria-hidden="true"
            className="h-12 w-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">
            {tutor.displayName[0]?.toUpperCase() ?? "?"}
          </span>
        )}

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium text-foreground">{tutor.displayName}</span>
            {tutor.isVariant ? (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                variant
              </span>
            ) : null}
            {selected ? <Check className="ml-auto h-4 w-4 shrink-0 text-brand" aria-hidden /> : null}
          </span>
          <span className="mt-0.5 text-xs text-muted-foreground">
            {style.toLowerCase()} &middot; {teaches}
          </span>
        </span>
      </button>

      {/* Reviewability, one disclosure away — a teacher can see what the
          teaching approach actually asks the tutor to do before choosing it. */}
      {tutor.frameworkSummary ? (
        <details className="mt-2">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <BookOpen className="h-3 w-3" aria-hidden />
            What does this teaching approach do?
          </summary>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {tutor.frameworkSummary}
          </p>
        </details>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{INTERACTION_STYLE_HELP[tutor.interactionStyle]}</p>
      )}
    </div>
  );
}
