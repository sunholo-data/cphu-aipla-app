"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";

import {
  type ClassPayload,
  type PersonaCatalogue,
  type PersonaPayload,
  type TutorCatalogue,
  fetchPersonaCatalogue,
  fetchTutorCatalogue,
} from "@/lib/teacherApi";
import { LoadError } from "@/components/ui/load-error";
import { useT } from "@/i18n";

/**
 * The tutor an activity inherits, per class (1.1.32 Q4 = class-default-only;
 * UI sweep 2026-11-11).
 *
 * The tutor is chosen in ONE place — class settings → Tutor — and every
 * activity in the class inherits it (name, picture, voice, tone and teaching
 * approach). The activity forms show it read-only.
 *
 * Before the sweep this took the page's `?classId=` and, without one, answered
 * "Default tutor — this class hasn't chosen one yet". Every link into the
 * editor except the post-create one omitted the class, so that confident wrong
 * answer was what teachers almost always saw. It now reads the activity's
 * ASSIGNMENTS — the classes that actually run it — and names the tutor in each.
 *
 * ⚠️ Teacher-facing copy says **tutor**, never "persona" (1.1.91) — `persona`
 * is the legacy API field this still reads, and nothing more.
 */

export interface ResolvedTutor {
  persona: PersonaPayload | null;
  /** The teaching approach of the class's tutor, when it has one. */
  approach: string | null;
  /** False when the class has chosen nothing and the global default teaches. */
  chosen: boolean;
}

/** Resolve one class's tutor through the chain the student `/active` endpoint
 *  uses: the class's tutor > its legacy persona > the global default. */
export function resolveClassTutor(
  cls: Pick<ClassPayload, "tutorId" | "persona">,
  personas: PersonaCatalogue,
  tutors: TutorCatalogue | null,
): ResolvedTutor {
  const tutor = cls.tutorId
    ? ([...(tutors?.tutors ?? []), ...(tutors?.skillBoundTutors ?? [])].find((tu) => tu.id === cls.tutorId) ?? null)
    : null;
  const id = tutor?.personaId ?? cls.persona ?? personas.defaultId;
  const persona = id ? (personas.personas.find((p) => p.id === id) ?? null) : null;
  return { persona, approach: tutor?.frameworkName ?? null, chosen: Boolean(cls.tutorId || cls.persona) };
}

type Catalogues = { personas: PersonaCatalogue; tutors: TutorCatalogue | null };

/**
 * "2.g Fysik B: Sofie (POE) · 3.x Fysik A: Niels (CER)" — the tutor in every
 * class that runs the activity. `classes` is null while the caller is still
 * reading them, and `failed` says the read did not answer (never shown as
 * "no class").
 *
 * `showClassNames` is false on the create page, where the class is the one in
 * the class picker right above and naming it again is noise.
 */
export function ClassTutorSummary({
  classes,
  failed = false,
  onRetry,
  showClassNames = true,
}: {
  classes: ClassPayload[] | null;
  failed?: boolean;
  onRetry?: () => void;
  showClassNames?: boolean;
}) {
  const t = useT("ActivitySummary");
  const tTutor = useT("InheritedTutor");
  const tStyle = useT("InteractionStyle");
  const [catalogues, setCatalogues] = useState<Catalogues | null>(null);
  const [catalogueFailed, setCatalogueFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setCatalogueFailed(false);
    Promise.all([fetchPersonaCatalogue(), fetchTutorCatalogue().catch(() => null)])
      .then(([personas, tutors]) => {
        if (alive) setCatalogues({ personas, tutors });
      })
      .catch(() => {
        if (alive) setCatalogueFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (failed || catalogueFailed) {
    return (
      <LoadError
        what={t("tutorWhat")}
        onRetry={() => {
          if (catalogueFailed) setAttempt((n) => n + 1);
          if (failed) onRetry?.();
        }}
      />
    );
  }
  if (classes === null || catalogues === null) {
    return <span className="text-muted-foreground">{t("tutorLoading")}</span>;
  }
  if (classes.length === 0) {
    return <span className="text-muted-foreground">{t("tutorNone")}</span>;
  }

  const resolved = classes.map((cls) => ({ cls, tutor: resolveClassTutor(cls, catalogues.personas, catalogues.tutors) }));
  const single = resolved.length === 1 ? resolved[0].tutor : null;
  return (
    <span className="flex flex-col gap-0.5" data-testid="class-tutor-summary">
      <span>
        {resolved.map(({ cls, tutor }, i) => {
          const name = tutor.persona?.name ?? t("tutorUnknown");
          const label = tutor.approach
            ? t("tutorWithApproach", { name, approach: tutor.approach })
            : tutor.chosen
              ? name
              : t("tutorDefault", { name });
          return (
            <Fragment key={cls.classId}>
              {i > 0 ? <span aria-hidden="true"> · </span> : null}
              {showClassNames ? (
                <>
                  <Link
                    href={`/teacher/classes/${encodeURIComponent(cls.classId)}`}
                    className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {cls.name}
                  </Link>
                  {": "}
                </>
              ) : null}
              <span className="font-medium text-foreground">{label}</span>
            </Fragment>
          );
        })}
      </span>
      {single?.persona ? (
        <span className="text-xs text-muted-foreground">
          {single.persona.title ? `${single.persona.title} · ` : ""}
          {tTutor("tone", { style: tStyle(single.persona.interactionStyle) })}
          {single.persona.voice?.ttsVoice ? ` · ${tTutor("voice", { voice: single.persona.voice.ttsVoice })}` : ""}
        </span>
      ) : null}
    </span>
  );
}

/** Where "Change in the class" goes: the one class, or the class list. */
export function tutorSettingsHref(classes: ClassPayload[] | null): string {
  return classes && classes.length === 1
    ? `/teacher/classes/${encodeURIComponent(classes[0].classId)}`
    : "/teacher/classes";
}
