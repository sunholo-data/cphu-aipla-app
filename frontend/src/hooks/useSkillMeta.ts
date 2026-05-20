"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/apiClient";

interface SkillMeta {
  displayName: string;
  ownerId: string | null;
  slug: string | null;
  /** MCP server IDs this skill is configured to use, sourced from
   * skillMetadata.toolConfigs.mcp.servers. Empty array if none. The chat
   * page passes this to MessageBubble so MCPAppToolCallRouter can decide
   * which tool calls have a UI surface. */
  mcpServerIds: readonly string[];
  /** Markdown welcome rendered on the empty-chat state. Sourced from
   * the skill's `initialMessage` field. Empty string when the skill
   * declares none — caller decides whether to fall back to a generic
   * "Send a message" prompt. Added 2026-05-20. */
  initialMessage: string;
  /** Markdown problem statement rendered in the AIPLA WorkspaceShell —
   * full worksheet text + sub-parts a/b/c/d for skills that pin to one
   * specific problem (v0.1: problem-set-hints + Boldkast). Empty string
   * for skills that don't pin to a problem. Added 2026-05-21 for the
   * Jutland-demo PEDCTX sprint M3. */
  problemStatement: string;
  loading: boolean;
}

interface SkillResponse {
  displayName?: string;
  display_name?: string;
  name?: string;
  ownerId?: string;
  owner_id?: string;
  slug?: string | null;
  initialMessage?: string;
  initial_message?: string;
  problemStatement?: string;
  problem_statement?: string;
  skillMetadata?: { toolConfigs?: { mcp?: { servers?: unknown } } };
  skill_metadata?: { toolConfigs?: { mcp?: { servers?: unknown } } };
}

function extractMcpServerIds(data: SkillResponse): readonly string[] {
  const meta = data.skillMetadata ?? data.skill_metadata;
  const servers = meta?.toolConfigs?.mcp?.servers;
  if (!Array.isArray(servers)) return [];
  return servers.filter((s): s is string => typeof s === "string");
}

export function useSkillMeta(skillId: string): SkillMeta {
  const [displayName, setDisplayName] = useState<string>(skillId.slice(0, 8));
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [mcpServerIds, setMcpServerIds] = useState<readonly string[]>([]);
  const [initialMessage, setInitialMessage] = useState<string>("");
  const [problemStatement, setProblemStatement] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchWithAuth(`/api/proxy/api/skills/${skillId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SkillResponse;
        if (!cancelled) {
          const display = data.displayName || data.display_name || data.name || skillId.slice(0, 8);
          setDisplayName(display);
          setOwnerId(data.ownerId || data.owner_id || null);
          setSlug(data.slug ?? null);
          setMcpServerIds(extractMcpServerIds(data));
          setInitialMessage(data.initialMessage || data.initial_message || "");
          setProblemStatement(data.problemStatement || data.problem_statement || "");
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
        // displayName stays as truncated UUID fallback; mcpServerIds stays empty
      });
    return () => {
      cancelled = true;
    };
  }, [skillId]);

  return { displayName, ownerId, slug, mcpServerIds, initialMessage, problemStatement, loading };
}
