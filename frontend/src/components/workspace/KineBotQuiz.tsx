"use client";

import { useCallback, useEffect, useState } from "react";

interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
}

interface KineBotQuizProps {
  /** Sandbox origin (no trailing /sandbox.html). The quiz bank is
   *  fetched from `${sandboxOrigin}/artefacts/kinebot/v1/quizzes/<topic>.json`
   *  — same-origin to the artefact, CORS-open (the sandbox serves
   *  Access-Control-Allow-Origin: *). */
  sandboxOrigin: string;
  /** Current topic key (e.g. "projectile"). Drives which bank loads. */
  topic: string;
  /** Report a quiz attempt up to the shared snapshot hook. */
  onAttempt: (questionId: string, answeredCorrectly: boolean) => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; questions: QuizQuestion[] };

export function KineBotQuiz({ sandboxOrigin, topic, onAttempt }: KineBotQuizProps) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    setIdx(0);
    setSelected(null);
    const origin = sandboxOrigin.replace(/\/$/, "");
    fetch(`${origin}/artefacts/kinebot/v1/quizzes/${encodeURIComponent(topic)}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { questions?: QuizQuestion[] }) => {
        if (cancelled) return;
        const qs = Array.isArray(data.questions) ? data.questions : [];
        if (qs.length === 0) {
          setLoad({ status: "error" });
        } else {
          setLoad({ status: "ready", questions: qs });
        }
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [sandboxOrigin, topic]);

  const handleAnswer = useCallback(
    (q: QuizQuestion, choice: number) => {
      if (selected !== null) return; // locked after first answer
      setSelected(choice);
      onAttempt(q.id, choice === q.correct);
    },
    [selected, onAttempt],
  );

  const handleNext = useCallback(() => {
    setSelected(null);
    setIdx((i) => i + 1);
  }, []);

  if (load.status === "loading") {
    return (
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-1.5 text-sm font-semibold">Quiz</h3>
        <p className="text-xs text-muted-foreground">Loading questions…</p>
      </section>
    );
  }

  if (load.status === "error") {
    return (
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-1.5 text-sm font-semibold">Quiz</h3>
        <p className="text-xs text-muted-foreground">
          No quiz available for this topic yet.
        </p>
      </section>
    );
  }

  const { questions } = load;
  const done = idx >= questions.length;

  if (done) {
    return (
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-1.5 text-sm font-semibold">Quiz</h3>
        <p className="text-xs text-muted-foreground">
          You&rsquo;ve worked through all {questions.length} questions for this
          topic. Pick another topic to keep going.
        </p>
        <button
          type="button"
          onClick={() => {
            setIdx(0);
            setSelected(null);
          }}
          className="mt-2 rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
        >
          Restart quiz
        </button>
      </section>
    );
  }

  const q = questions[idx];
  const answered = selected !== null;

  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Quiz</h3>
        <span className="text-[10px] text-muted-foreground">
          {idx + 1} / {questions.length}
        </span>
      </div>
      <p className="mb-2 text-xs font-medium">{q.prompt}</p>
      <ul className="space-y-1.5">
        {q.options.map((opt, i) => {
          const isCorrect = i === q.correct;
          const isChosen = i === selected;
          let cls =
            "w-full rounded border px-2 py-1.5 text-left text-xs transition";
          if (!answered) {
            cls += " border-border bg-background hover:border-primary hover:bg-muted/40";
          } else if (isCorrect) {
            cls += " border-green-500/60 bg-green-500/10 text-foreground";
          } else if (isChosen) {
            cls += " border-red-500/60 bg-red-500/10 text-foreground";
          } else {
            cls += " border-border bg-background opacity-60";
          }
          return (
            <li key={i}>
              <button
                type="button"
                disabled={answered}
                onClick={() => handleAnswer(q, i)}
                className={cls}
              >
                {opt}
              </button>
            </li>
          );
        })}
      </ul>
      {answered ? (
        <div className="mt-2">
          <p
            className={`text-xs font-medium ${
              selected === q.correct ? "text-green-600" : "text-red-600"
            }`}
          >
            {selected === q.correct ? "Correct" : "Not quite"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{q.explanation}</p>
          <button
            type="button"
            onClick={handleNext}
            className="mt-2 rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
          >
            {idx + 1 < questions.length ? "Next question" : "Finish"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
