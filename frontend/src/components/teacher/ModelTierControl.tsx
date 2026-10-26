"use client";

/**
 * ModelTierControl — the researcher-only smart-model opt-in for one activity
 * (1.1.142 M3).
 *
 * `smart` starts every tutor turn of the activity on the smart model (better at
 * images and multi-step problems, slower first token, ~2.5x the cost per turn).
 * Researcher-only for now, to protect the cloud-cost envelope until the
 * smart-tier share has been watched on the cost view — so this renders nothing
 * for anyone else, and the backend 403s regardless.
 *
 * Saves on change through its OWN route, never through the builder's
 * full-payload save (which preserves the value it does not send).
 */

import { useState } from "react";

import { useIsResearcher } from "@/hooks/useIsResearcher";
import { type ModelTier, setActivityModelTier } from "@/lib/teacherApi";
import { useT } from "@/i18n";

export function ModelTierControl({
  activityId,
  initialTier,
}: {
  activityId: string;
  initialTier: ModelTier | undefined;
}) {
  const t = useT("ModelTierControl");
  const isResearcher = useIsResearcher();
  const [tier, setTier] = useState<ModelTier>(initialTier ?? "default");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  if (!isResearcher) return null;

  const onChange = async (next: ModelTier) => {
    const previous = tier;
    setTier(next);
    setSaving(true);
    setError(false);
    try {
      const saved = await setActivityModelTier(activityId, next);
      setTier(saved.modelTier ?? next);
    } catch {
      setTier(previous);
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="model-tier-heading"
      className="flex flex-col gap-1.5 rounded border border-dashed border-border p-3 text-sm"
    >
      <h3 id="model-tier-heading" className="font-medium">
        {t("title")}
      </h3>
      <label className="flex items-center gap-2">
        <span>{t("label")}</span>
        <select
          value={tier}
          disabled={saving}
          onChange={(e) => void onChange(e.target.value as ModelTier)}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
        >
          <option value="default">{t("tier_default")}</option>
          <option value="smart">{t("tier_smart")}</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {t("error")}
        </p>
      ) : null}
    </section>
  );
}
