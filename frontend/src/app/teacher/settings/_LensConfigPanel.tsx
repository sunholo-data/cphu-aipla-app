"use client";

// Researcher lens-config panel (RUBRIC-1 M3 / 1.1.57) — the first researcher
// CONFIG-WRITE surface of the prompt-transparency direction: experiment with
// the competency-judge lenses (model, enabled, prompt override) and run one
// against a captured session, all without a deploy or reseed.
//
// RESEARCHER-ONLY (useIsResearcher; the API 404s everyone else) and
// R1-quarantined: nothing here is teacher- or student-visible vocabulary.
// Abstains render as DESIGNED states — an uncalibrated judge says so, it
// never fabricates a score.

import { useCallback, useEffect, useState } from "react";
import { ClipboardCopy, FlaskConical, RotateCcw } from "lucide-react";

import { useIsResearcher } from "@/hooks/useIsResearcher";
import { fetchWithTeacherAuth } from "@/lib/apiClient";
import ModelSelector from "@/components/skill/ModelSelector";

interface LensConfig {
  lens_id: string;
  label: string;
  model: string;
  prompt_version: string;
  enabled: boolean;
  prompt_override: string | null;
  /** The code-default judge preamble — shown read-only so a researcher edits
   *  FROM it instead of a blank box (RUBRIC-1 M3 follow-up). */
  default_prompt: string;
}

interface RubricScore {
  lensId: string;
  promptVersion: string;
  model: string;
  abstained: boolean;
  abstainReason?: string;
  profile: Record<string, { score: number | string; rationale?: string }>;
  partitionSummary: { student_initiated?: number; tutor_prompted?: number };
}


export function LensConfigPanel() {
  const isResearcher = useIsResearcher();
  const [lenses, setLenses] = useState<LensConfig[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchWithTeacherAuth("/api/proxy/api/research/lens-configs")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d) => setLenses(d.lenses ?? []))
      .catch(() => setError("Couldn't load lens configs."));
  }, []);

  useEffect(() => {
    if (isResearcher) load();
  }, [isResearcher, load]);

  if (!isResearcher) return null;

  return (
    <section data-testid="lens-config-panel" className="flex flex-col gap-4 rounded-lg border border-violet-200 p-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-violet-900">
          <FlaskConical className="h-4 w-4" /> Research · judge lenses
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Competency-rubric judges (1.1.57) — researcher-only; nothing here is shown to teachers or
          students. Prompt edits bump the version, and every score is stamped with the version that
          produced it.
        </p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {lenses === null && !error ? <p className="text-sm text-slate-400">Loading lenses…</p> : null}

      {(lenses ?? []).map((lens) => (
        <LensCard key={lens.lens_id} lens={lens} onSaved={load} />
      ))}

      <ExperimentBox lenses={lenses ?? []} />
    </section>
  );
}

function LensCard({ lens, onSaved }: { lens: LensConfig; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(lens.enabled);
  const [model, setModel] = useState(lens.model);
  const [prompt, setPrompt] = useState(lens.prompt_override ?? "");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const put = async (body: Record<string, unknown>, message: string) => {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetchWithTeacherAuth(`/api/proxy/api/research/lens-configs/${lens.lens_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setNote(message);
      onSaved();
    } catch {
      setNote("Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-testid={`lens-card-${lens.lens_id}`}
      className="flex flex-col gap-2 rounded-md border border-slate-200 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-800">{lens.label}</span>
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{lens.prompt_version}</code>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              void put({ enabled: e.target.checked }, e.target.checked ? "Lens enabled." : "Lens disabled.");
            }}
          />
          enabled
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-slate-600">
        <span>Judge model (from the platform&apos;s curated list)</span>
        <ModelSelector
          value={model}
          providers={["google"]}
          onChange={(apiName) => {
            setModel(apiName);
            void put({ model: apiName }, `Model set to ${apiName}.`);
          }}
        />
        <span className="text-[11px] text-slate-400">
          Gemini for now. Multi-provider judges (local / self-hosted, Ollama-focused) are on the
          roadmap.
        </span>
      </label>

      <details className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2" data-testid={`lens-default-${lens.lens_id}`}>
        <summary className="cursor-pointer text-xs font-medium text-slate-600">
          Default prompt {prompt.trim() ? "" : "(currently in use)"} — click to view
        </summary>
        <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-slate-600" data-testid={`lens-default-text-${lens.lens_id}`}>
          {lens.default_prompt}
        </p>
        <button
          type="button"
          onClick={() => setPrompt(lens.default_prompt)}
          className="mt-2 flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-white"
        >
          <ClipboardCopy className="h-3 w-3" /> Copy into editor
        </button>
      </details>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">
          Judge prompt override (empty = the default above; saving bumps the version)
        </span>
        <textarea
          aria-label={`Prompt override for ${lens.lens_id}`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          maxLength={8000}
          placeholder="Empty → the default prompt above is used. Click “Copy into editor” to start from it."
          className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
        />
        <span className="text-[11px] text-slate-400">
          The override replaces only these instructions. The rubric categories, your anchor pack, the
          attribution, and the student&apos;s evidence are always appended automatically.
        </span>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void put({ promptOverride: prompt.trim() || null }, "Prompt saved — version bumped.")}
          className="rounded border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-50"
        >
          Save prompt
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setPrompt("");
            void put({ promptOverride: null }, "Reset to the code default — version bumped.");
          }}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
        >
          <RotateCcw className="h-3 w-3" /> Reset to default
        </button>
        {note ? <span className="text-xs text-slate-500">{note}</span> : null}
      </div>
    </div>
  );
}

function ExperimentBox({ lenses }: { lenses: LensConfig[] }) {
  const [sessionId, setSessionId] = useState("");
  const [lens, setLens] = useState("maps");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RubricScore | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetchWithTeacherAuth("/api/proxy/api/research/rubric-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.trim(), lens }),
      });
      if (res.status === 404) throw new Error("Session not found.");
      if (!res.ok) throw new Error(`Scoring failed (${res.status}).`);
      setResult((await res.json()) as RubricScore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scoring failed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      data-testid="lens-experiment-box"
      className="flex flex-col gap-2 rounded-md border border-dashed border-violet-300 p-3"
    >
      <span className="text-xs font-semibold text-violet-900">Experiment — score a captured session</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          aria-label="Session id"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="session id"
          className="min-w-56 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select
          aria-label="Lens"
          value={lens}
          onChange={(e) => setLens(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        >
          {lenses.map((l) => (
            <option key={l.lens_id} value={l.lens_id}>
              {l.lens_id}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={running || !sessionId.trim()}
          onClick={() => void run()}
          className="rounded border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-50"
        >
          {running ? "Scoring…" : "Run judge"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {result ? (
        <div data-testid="lens-experiment-result" className="flex flex-col gap-1.5 text-sm">
          <p className="text-xs text-slate-500">
            {result.lensId} · {result.promptVersion} · {result.model} — evidence: student-initiated{" "}
            {result.partitionSummary?.student_initiated ?? 0}, tutor-prompted{" "}
            {result.partitionSummary?.tutor_prompted ?? 0} (excluded)
          </p>
          {result.abstained ? (
            <p className="rounded bg-slate-50 px-2 py-1.5 text-slate-600" data-testid="lens-abstain">
              <span className="font-medium">Abstained</span> — {result.abstainReason}. This is the designed
              outcome for an uncalibrated or evidence-less session, not an error.
            </p>
          ) : (
            <table className="text-left text-xs">
              <tbody>
                {Object.entries(result.profile).map(([category, entry]) => (
                  <tr key={category} className="border-t border-slate-100">
                    <td className="py-1 pr-3 font-medium text-slate-700">{category}</td>
                    <td className="py-1 pr-3">{String(entry.score)}</td>
                    <td className="py-1 text-slate-500">{entry.rationale ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}
