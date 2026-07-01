"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AutoReadToggle } from "@/components/chat/AutoReadToggle";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import type { PersonaSummary } from "@/components/chat/MessageBubble";
import { ResumeWelcomeBanner } from "@/components/chat/ResumeWelcomeBanner";
import { CallTeacherButton } from "@/components/chat/CallTeacherButton";
import { ImageStagingRow, ImageUploadButtons } from "@/components/chat/ImageComposer";
import { useImageAttachments, MAX_IMAGES } from "@/hooks/useImageAttachments";
import { VoiceComposerControls } from "@/components/chat/VoiceComposerControls";
import { LessonRecordingPanel } from "@/components/chat/LessonRecordingPanel";
import { useVoiceConfig } from "@/hooks/useVoiceConfig";
import type { DocTabData } from "@/components/doc-browser/DocTab";
import { DocListView } from "@/components/doc-browser/DocListView";
import { DocTabsBar } from "@/components/doc-browser/DocTabsBar";
import { UploadDropZone } from "@/components/doc-browser/UploadDropZone";
import type { ParsedDocument } from "@/hooks/useDocBrowser";
import {
  isAnonymousGroupAuthMode,
  readStoredGroupSession,
} from "@/lib/anonymousGroupAuth";
import { useAuth } from "@/contexts/AuthContext";
import type { User } from "@/lib/firebase";
import { useSkillAgent, type StreamError } from "@/hooks/useSkillAgent";
import { useSkillMeta } from "@/hooks/useSkillMeta";
import { useUserSkills } from "@/hooks/useUserSkills";
import { useSessionMessages } from "@/hooks/useSessionMessages";
import { useGroupPulse } from "@/hooks/useGroupPulse";
import { Loader2 } from "lucide-react";
import { useEnteredViaResume } from "@/hooks/useEnteredViaResume";
import { useSessionDocuments } from "@/hooks/useSessionDocuments";
import { useStableThreadId } from "@/hooks/useStableThreadId";
import { useProactiveGreet } from "@/lib/proactiveGreet";
import {
  HumanToolEventsProvider,
  useSyncMessageCount,
  useSeedRestoredInteractions,
  type HumanToolEvent,
} from "@/hooks/useHumanToolEvents";
import { fetchWithAuth } from "@/lib/apiClient";
import { computeIncludedDocIds } from "@/lib/docContext";
import type { EncodedImage } from "@/lib/imageResize";
import { notifySessionsChanged, subscribeSessionsChangedDetailed } from "@/lib/sessionEvents";
import { useSkillSessions } from "@/hooks/useSkillSessions";
import { useSlugResolution } from "@/hooks/useSlugResolution";
import { SkillSessionPanel } from "@/components/chat/SkillSessionPanel";
import DocumentHistoryPanel from "@/components/chat/DocumentHistoryPanel";
import { SkillsBar } from "@/components/navigation/SkillsBar";
import {
  ProactiveSimProvider,
  useSetProactiveSimWiring,
} from "@/contexts/ProactiveSimContext";
import { AGUIProvider } from "@/providers/AGUIProvider";
import {
  SurfaceRegistryProvider,
  useClearSurfacesOnSessionChange,
  useSurfaceState,
} from "@/providers/SurfaceRegistry";
import { A2UISurfaceMount } from "@/components/protocols/A2UISurfaceMount";
import { DocumentPanel } from "@/components/document/DocumentPanel";
import { LatencyHUD } from "@/components/dev/LatencyHUD";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { type ChecklistItem } from "@/components/workspace/ProgressChecklist";
import { type TableElementDef } from "@/components/workspace/WorkbenchTable";
import { type ChartElementDef } from "@/components/workspace/WorkbenchChart";
import { type CalculatorElementDef } from "@/components/workspace/WorkbenchCalculator";
import { type NoteElementDef } from "@/components/workspace/WorkbenchNote";
import { type ActivityArtefact } from "@/components/workspace/GenericArtefactFrame";
import { StudentWorkspace } from "@/components/workspace/StudentWorkspace";
import type { SolutionElementDef } from "@/components/workspace/SolutionElementMount";
import type { DocumentElementDef } from "@/components/workspace/DocumentElementMount";
import { DocumentsPanel, type ActivityMaterial } from "@/components/workspace/DocumentsPanel";
import { reportDocumentEvent } from "@/lib/documentApi";
import { workspaceContentKind } from "./workspaceContent";
import { useResizableWorkspaceRatio } from "@/hooks/useResizableWorkspaceRatio";

// Sandbox origin for the sim artefact iframes. NEXT_PUBLIC_MCP_SANDBOX_URL
// points at /sandbox.html on the sandbox service; strip the suffix so we
// have the bare origin, then GenericArtefactFrame (inside StudentWorkspace)
// appends the artefact path.
// Empty string => sim launcher disabled (graceful — workspace still works).
const BOLDKAST_SANDBOX_ORIGIN = (process.env.NEXT_PUBLIC_MCP_SANDBOX_URL ?? "")
  .replace(/\/sandbox\.html$/, "");


/**
 * MULTI-SURFACE-A2UI M3 — chat page surface mounts.
 *
 * The chat page wraps in <SurfaceRegistryProvider> and declares mounts for
 * the four named A2UI surfaces. Each mount is conditional on having content
 * — empty surfaces don't add visible DOM. Layout intent:
 *   - workspace : displaces or sits alongside the DocumentPanel (w-1/2 region)
 *   - sidebar   : appends to the bottom of the existing aside
 *   - modal     : fixed-position overlay at page root (M4 wires the
 *                 user-gesture guard; M3 just shows it when populated)
 */
function WorkspaceSurfaceRegion({ sessionId }: { sessionId: string | null }) {
  const state = useSurfaceState("workspace");
  if (!state?.surface) return null;
  // Workspace is a flex sibling of the chat panel. Each gets `flex-1
  // min-w-0` so they share the parent row proportionally and BOTH can
  // shrink below their natural content size when the viewport is narrow.
  // `max-w-xl` caps the workspace so it doesn't dominate on wide screens;
  // the chat is the primary interaction surface and shouldn't be squeezed
  // by small dashboard content. Cap is generous (576px) — forks with
  // larger dashboards override via SurfaceRegistry policy.
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r md:max-w-xl">
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <A2UISurfaceMount
          surfaceId="workspace"
          className="h-full"
          sessionId={sessionId}
        />
      </div>
    </div>
  );
}

function SidebarSurfaceRegion({ sessionId }: { sessionId: string | null }) {
  const state = useSurfaceState("sidebar");
  if (!state?.surface) return null;
  return (
    <div className="border-t px-2 py-2">
      <A2UISurfaceMount surfaceId="sidebar" sessionId={sessionId} />
    </div>
  );
}

function ModalSurfaceRegion({ sessionId }: { sessionId: string | null }) {
  const state = useSurfaceState("modal");
  if (!state?.surface) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="max-w-xl rounded-lg border bg-background p-4 shadow-xl">
        <A2UISurfaceMount surfaceId="modal" sessionId={sessionId} />
      </div>
    </div>
  );
}

/**
 * MULTI-SURFACE-A2UI M4 — wires the session-id transition to surface
 * lifecycle policy. When the user starts/switches sessions, session-scoped
 * surfaces (workspace, sidebar by default) clear automatically. The hook
 * is idempotent on the same sessionId so it won't fire on render.
 */
function SurfaceSessionLifecycle({ sessionId }: { sessionId: string | null }) {
  useClearSurfacesOnSessionChange(sessionId);
  return null;
}

export default function ChatPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  // Wait for auth to hydrate AND the user to be signed in before firing the
  // by-slug fetch. Without `user` in the gate, an unauth visitor would fire
  // a tokenless request, get 401, and see "Skill not found" before the
  // redirect to / kicks in.
  const { skillId, loading: resolving, notFound } = useSlugResolution(path, !loading && !!user);

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  if (loading || resolving) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!user) return null;
  if (notFound || !skillId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <p>Skill not found.</p>
        <Link className="underline" href="/">Back to home</Link>
      </div>
    );
  }

  // path is validated by useSlugResolution. Friendly URL is 2 segments
  // (@owner/slug); a raw skill id is 1 segment (/chat/{skillId}). Build the
  // matching prefix for session-URL navigation either way.
  const pathPrefix = path.length >= 2 ? `/chat/${path[0]}/${path[1]}` : `/chat/${path[0]}`;

  return (
    <ProactiveSimProvider>
      <ChatPageInner skillId={skillId} pathPrefix={pathPrefix} user={user} />
    </ProactiveSimProvider>
  );
}

function ChatPageInner({
  skillId,
  pathPrefix,
  user,
}: {
  skillId: string;
  pathPrefix: string;
  user: User;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSessionId = searchParams.get("session");
  // ALS-1: the activity this chat runs. The group's active session is now scoped
  // per activity (a group runs many activities, each its own conversation), so we
  // resolve/resume by activity below.
  const activityId = searchParams.get("activity_id") || skillId;
  const isActivityChat = (searchParams.get("activity_id") || "").startsWith("act-");

  // 1.F: for anonymous-group users, read the resumedSessionId from the stored
  // join response (a GROUP-level pointer). For an ALS-1 activity chat this is the
  // wrong scope (it would resume some other activity's conversation), so suppress
  // the group-level fast-path there and let the per-activity active-session fetch
  // below be authoritative. Memoised once at mount.
  const resumedSessionId = useMemo<string | null>(() => {
    if (!isAnonymousGroupAuthMode()) return null;
    if (urlSessionId !== null) return null; // already navigated to a specific session
    if (isActivityChat) return null; // per-activity resume is handled by the fetch below
    return readStoredGroupSession()?.resumedSessionId ?? null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Write ?session=resumedSessionId immediately on mount so useSessionMessages
  // starts loading the prior history without waiting for the first message.
  // This is the fast path: it only fires when the STORED resumedSessionId is
  // fresh. The authoritative resolution is the backend fetch below.
  useEffect(() => {
    if (resumedSessionId && !urlSessionId) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("session", resumedSessionId);
      router.replace(`${pathPrefix}?${params.toString()}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally runs once on mount

  // 1.F resume fix (2026-06-13): the stored resumedSessionId is frozen at join
  // time — null on the first join (before any chat) and never refreshed. So a
  // student who joins, chats, then revisits in the same tab keeps reading null
  // and starts a blank session every time (lazy-flute-39: 122 turns, always
  // restarted). Re-resolve the group's live active session from the backend on
  // load and adopt it via ?session= (useStableThreadId picks up the change,
  // useSessionMessages loads the history). No-op once a session is in the URL
  // (mid-chat or already resumed) so we never disrupt an active conversation.
  useEffect(() => {
    if (!isAnonymousGroupAuthMode() || urlSessionId) return;
    let cancelled = false;
    // ALS-1: resolve the active session for THIS activity (per-activity scope).
    fetchWithAuth(`/api/proxy/api/auth/group/active-session?activityId=${encodeURIComponent(activityId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { sessionId?: string | null } | null) => {
        const sid = data?.sessionId;
        // Guard against the LIVE url (the captured searchParams is the mount
        // snapshot): only adopt if the user hasn't navigated to / started a
        // session while we were fetching.
        const liveSession =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("session")
            : null;
        if (cancelled || !sid || liveSession) return;
        const params = new URLSearchParams(window.location.search);
        params.set("session", sid);
        router.replace(`${pathPrefix}?${params.toString()}`);
      })
      .catch(() => {
        /* resume is best-effort; a fresh session is the safe fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once on mount

  // chat-history-deep-fixes-2 Bug A': pre-allocate a stable threadId so the
  // URL-writeback effect after the first turn doesn't change AGUIProvider's
  // sessionId prop. Without this, useMemo([sessionId, …]) rebuilds the
  // HttpAgent the moment ?session= is written, agent.messages is destroyed,
  // and the user sees turn 1 vanish until the GET refills initialMessages.
  const stableThreadId = useStableThreadId(urlSessionId, {
    initialSessionId: resumedSessionId ?? undefined,
  });

  return (
    <AGUIProvider skillId={skillId} sessionId={stableThreadId}>
      {/* HumanToolEventsProvider MUST wrap ChatShell from outside, not
       *  live inside its return — the workspace artefact surface
       *  (StudentWorkspace → GenericArtefactFrame) calls useHumanToolEvents
       *  during render. If the provider sits inside ChatShell's JSX, those
       *  hook calls fall outside the provider's subtree and silently get the
       *  no-op fallback — POSTs still go out, but no "Sendte spørgsmål med …"
       *  cards render in chat. messages.length is synced via
       *  useSyncMessageCount inside ChatShell. (Was lost between
       *  86e24ee → 3563af1; restored 2026-06-01.) */}
      <HumanToolEventsProvider>
        <ChatShell
          skillId={skillId}
          pathPrefix={pathPrefix}
          user={user}
          stableThreadId={stableThreadId}
          resumedSessionId={resumedSessionId}
        />
      </HumanToolEventsProvider>
    </AGUIProvider>
  );
}

function StreamErrorBanner({
  error,
  onRetry,
  onDismiss,
}: {
  error: StreamError;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="inline-block max-w-[80%] space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <p>{error.message}</p>
      <div className="flex gap-2">
        {error.retryable && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-destructive/40 px-2 py-0.5 text-xs hover:bg-destructive/20"
          >
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded border border-destructive/20 px-2 py-0.5 text-xs text-destructive/70 hover:bg-destructive/10"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// Stable empty array for the no-restore branch of useSeedRestoredInteractions
// — a fresh `[]` each render would re-fire the seed effect every render.
const NO_RESTORED_INTERACTIONS: HumanToolEvent[] = [];

function ChatShell({
  skillId,
  pathPrefix,
  user,
  stableThreadId,
  resumedSessionId,
}: {
  skillId: string;
  pathPrefix: string;
  user: User;
  stableThreadId: string;
  resumedSessionId: string | null;
}) {
  // ALS-1 M0: the chat runs a SKILL but is scoped to a specific ACTIVITY. The
  // lesson card opens /chat/{skillId}?activity_id={act-…}; the activity selects the
  // teacher-focus + workbench config. Falls back to skillId for teacher chats /
  // direct skill links (the backend's legacy welding), so nothing else changes.
  const _chatSearchParams = useSearchParams();
  const activityId = _chatSearchParams.get("activity_id") || skillId;
  const {
    sessionId: agentSessionId,
    messages,
    toolCalls,
    thinkingContent,
    isThinking,
    stageLabel,
    sendMessage,
    isLoading,
    error,
    clearError,
    stop,
  } = useSkillAgent({ activityId });
  const {
    displayName,
    mcpServerIds,
    initialMessage: skillInitialMessage,
    slug: skillSlug,
    proactiveGreet: skillProactiveGreet,
    multimodalInput: skillMultimodalInput,
  } = useSkillMeta(skillId);

  const { skills: userSkills, isLoading: skillsLoading } = useUserSkills(user.uid);
  // Anonymous-group users (students joining via teacher-minted codes —
  // ADR-001) don't browse/upload documents in v0.1. Hide the entire
  // doc-browsing surface: tab bar, sidebar doc list, upload zone,
  // document preview panel, document-history panel. Other auth modes
  // see the full inherited template UX. v1 may add a per-skill
  // allowDocumentUpload flag — for v0.1 the auth-mode gate is
  // sufficient since anon-group users only see one skill anyway.
  const showDocumentUI = !isAnonymousGroupAuthMode();
  // PEDCTX M2 — the AIPLA workspace pane mounts only for the v0.1 demo
  // skill (problem-set-hints) in anon-group mode. Non-anon users get
  // the inherited template surface (DocTabs + DocumentPanel). Once v1
  // ships more student-facing skills the gate widens; for now the
  // workspace is purpose-built for the one demo flow.
  // TAA-1 M1: teacher-authored checklist for THIS activity, resolved via the
  // student's group→class binding (M1.2 endpoint). Composed into the workspace
  // generically — for sims it sits alongside the sim handles its own;
  // for no-sim concept activities it IS the workspace.
  const [activeChecklist, setActiveChecklist] = useState<ChecklistItem[]>([]);
  // 1.1.38 M1 — the activity's teacher-defined data tables (student-fillable),
  // rendered in the workspace column via the element registry.
  const [activeTable, setActiveTable] = useState<TableElementDef[]>([]);
  // 1.1.38 M2 — charts that plot the activity's data table.
  const [activeChart, setActiveChart] = useState<ChartElementDef[]>([]);
  // 1.1.38 M3 — formula calculators (computed client-side via the safe parser).
  const [activeCalculator, setActiveCalculator] = useState<CalculatorElementDef[]>([]);
  // 1.1.38 M4 — teacher-authored instructions / reference notes (Markdown).
  const [activeNote, setActiveNote] = useState<NoteElementDef[]>([]);
  // 1.1.45 M4 — the rich-text solution editor element (JB-2 "din løsning").
  const [activeSolution, setActiveSolution] = useState<SolutionElementDef[]>([]);
  // 1.1.41 M1 — the vetted sim artefact this activity hosts (resolved from the
  // catalogue), mounted as the workspace surface via the generic frame.
  const [activeArtefact, setActiveArtefact] = useState<ActivityArtefact | null>(null);
  // 1.1.33 M2b/M1 — the activity's grounding documents (names-always + a
  // studentVisible flag), surfaced in the Documents workbench panel.
  const [activeMaterials, setActiveMaterials] = useState<ActivityMaterial[]>([]);
  // 1.1.48 — the document-upload element (JB-1 "din fil"); reconciled from the
  // legacy workbench_type="document" mode into a composable element.
  const [activeDocument, setActiveDocument] = useState<DocumentElementDef[]>([]);
  // Persona (1.1.12) resolved for this activity — the bot bubbles show its
  // avatar + name. Optional; null leaves the default brand byline.
  const [activePersona, setActivePersona] = useState<PersonaSummary | null>(null);
  // Config-driven workspace gate: any workspace surface present (a vetted
  // artefact or an authored element) → render the column. USR-1: purely
  // content-driven — no skill-slug sim registry.
  const workspaceKind = workspaceContentKind(
    activeChecklist.length > 0 ||
      activeTable.length > 0 ||
      activeChart.length > 0 ||
      activeCalculator.length > 0 ||
      activeNote.length > 0 ||
      activeSolution.length > 0 ||
      activeDocument.length > 0 ||
      activeArtefact != null,
  );
  // 1.1.33 M1 — the student's uploaded photos this session (native AG-UI image
  // parts already on the messages); fed to the Documents panel's gallery.
  const uploadedImages = messages.flatMap((m) => m.images ?? []);
  // Documents (assigned materials OR uploads) also warrant the workspace column,
  // even for a bare concept activity with no sim/checklist.
  const hasDocuments = activeMaterials.length > 0 || uploadedImages.length > 0;
  const showWorkspace =
    isAnonymousGroupAuthMode() && (workspaceKind !== "none" || hasDocuments);
  // The generic-artefact activity surface (sim + elements + documents) is the
  // shared StudentWorkspace — the same component the builder preview renders,
  // and it owns its own documents panel. USR-1: this is now the ONLY workspace
  // render path, so any non-empty workspace uses it; the standalone
  // DocumentsPanel below only serves chat-only activities (workspaceKind ===
  // "none" but with assigned materials / uploads).
  const usesStudentWorkspace = workspaceKind !== "none";

  // Fetch this activity's teacher-authored checklist (M1.2 resolves it from the
  // student's class). Optional — failure/absence leaves the chat-only render.
  useEffect(() => {
    if (!skillId || !isAnonymousGroupAuthMode()) {
      setActiveChecklist([]);
      setActiveTable([]);
      setActiveChart([]);
      setActiveCalculator([]);
      setActiveNote([]);
      setActiveSolution([]);
      setActiveDocument([]);
      setActiveArtefact(null);
      setActivePersona(null);
      setActiveMaterials([]);
      return;
    }
    let alive = true;
    // ALS-1 M0: resolve the workbench config (checklist/tables/persona/materials)
    // by ACTIVITY id, not skill id — so two concept activities in one class show
    // their own elements. The /active endpoint is dual-read (act- → new store,
    // else legacy composite), so this works pre- and post-migration.
    fetchWithAuth(`/api/proxy/api/activity-configs/active/${encodeURIComponent(activityId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        if (Array.isArray(data.checklist)) setActiveChecklist(data.checklist as ChecklistItem[]);
        if (Array.isArray(data.table)) setActiveTable(data.table as TableElementDef[]);
        if (Array.isArray(data.chart)) setActiveChart(data.chart as ChartElementDef[]);
        if (Array.isArray(data.calculator)) setActiveCalculator(data.calculator as CalculatorElementDef[]);
        if (Array.isArray(data.note)) setActiveNote(data.note as NoteElementDef[]);
        if (Array.isArray(data.solution)) setActiveSolution(data.solution as SolutionElementDef[]);
        if (Array.isArray(data.document)) setActiveDocument(data.document as DocumentElementDef[]);
        setActiveArtefact((data.artefact as ActivityArtefact | null) ?? null);
        setActivePersona((data.persona as PersonaSummary | null) ?? null);
        setActiveMaterials(Array.isArray(data.materials) ? (data.materials as ActivityMaterial[]) : []);
      })
      .catch(() => {
        /* checklist + persona are optional — stay chat-only on failure */
      });
    return () => {
      alive = false;
    };
  }, [skillId, activityId]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  // 1.1.7 multimodal upload — staged images for the next turn (gated by the
  // skill's multimodalInput flag at render time). Owns guardrail + resize +
  // object-URL cleanup; handleSend reads `.attachments` and calls `.clear()`.
  const images = useImageAttachments();
  // VOICE-IN-REC M3 — composer mic (talk-to-type XOR record-lesson). Gated on
  // the class capability flags from voice config; dictation fills the draft.
  const composerVoice = useVoiceConfig(skillId);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  // A lesson recording holds the mic — block dictation so only one
  // getUserMedia stream is ever live at a time.
  const [lessonRecording, setLessonRecording] = useState(false);
  // resize-workspace sprint — chat <-> workspace split ratio.
  // Keyed by skillSlug so KineBot remembers a different width than
  // LED Planck (per-skill defaults in the hook).
  const { ratio: workspaceRatio, setRatio: setWorkspaceRatio } =
    useResizableWorkspaceRatio(skillSlug ?? "");
  const workspaceFullscreen = workspaceRatio === 1;
  // Mobile-only tab state. On md+ both chat and workspace render
  // side-by-side and this state is ignored. Below md ("one shared
  // phone per three students" — Jutland-brief target form-factor),
  // a 50/50 split would cram the Boldkast sim to ~180px wide. Tab
  // pattern instead: one panel visible at a time, swap with the
  // header tab bar. Default "chat" because the welcome panel +
  // input bar are the natural first focus. Persists per skill so
  // a refresh keeps the student's place.
  const [mobileTab, setMobileTab] = useState<"chat" | "workspace">("chat");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(`aipla.mobileTab:${skillId}`);
    if (stored === "workspace") setMobileTab("workspace");
  }, [skillId]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(`aipla.mobileTab:${skillId}`, mobileTab);
  }, [skillId, mobileTab]);
  // Bootstrap the ChatSessionIndex doc as soon as we have a session id —
  // closes the 2026-05-21 iframe-context 404 race where workspace POSTs
  // fire before the first chat turn creates the index via
  // make_session_tracker.before_agent_callback. Fire-and-forget: errors
  // are non-fatal because the agent-side callback still runs as a
  // backstop on first turn.
  const bootstrappedSessionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!agentSessionId) return;
    if (bootstrappedSessionsRef.current.has(agentSessionId)) return;
    bootstrappedSessionsRef.current.add(agentSessionId);
    void fetchWithAuth(`/api/proxy/api/sessions/${agentSessionId}/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // ALS-1: scope the group's active-session mapping per activity, so each
      // activity keeps its own conversation instead of sharing the group's.
      body: JSON.stringify({ skillId, activityId }),
    }).catch((err) => {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[session_bootstrap] failed:", err);
      }
    });
  }, [agentSessionId, skillId, activityId]);

  // 1.F: fetch workbench state from the prior session so artefacts can
  // be restored via aipla:restore (M6). Also controls the banner.
  const [restoredWorkbenchState, setRestoredWorkbenchState] = useState<
    Record<string, unknown>
  >({});
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const restoreFetchedRef = useRef(false);
  useEffect(() => {
    if (!resumedSessionId) return;
    if (restoreFetchedRef.current) return;
    restoreFetchedRef.current = true;
    fetchWithAuth(`/api/proxy/api/sessions/${resumedSessionId}/restore`, {
      method: "POST",
    })
      .then((r) => r.json())
      .then(
        (data: {
          workbenchState: Record<string, unknown>;
          messages: unknown[];
        }) => {
          if (
            data.workbenchState &&
            Object.keys(data.workbenchState).length > 0
          ) {
            setRestoredWorkbenchState(data.workbenchState);
          }
          if (data.messages && data.messages.length > 0) {
            setShowResumeBanner(true);
          }
        },
      )
      .catch(() => {
        // Non-fatal — student gets a fresh-looking chat; restore is best-effort
      });
  }, [resumedSessionId]);

  const [showDocBrowser, setShowDocBrowser] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [openTabs, setOpenTabs] = useState<DocTabData[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const lastUserMessageRef = useRef<string>("");
  // Flush hook registered by the mounted sim artefact (StudentWorkspace →
  // GenericArtefactFrame). Awaited before each outgoing message so an artefact
  // that buffers continuous input (Boldkast's commit-on-submit sliders) commits
  // its latest state to the tutor BEFORE the turn reads it. null when no sim is
  // open. Resolves on commit, or a short cap when nothing was pending.
  const artefactFlushRef = useRef<(() => Promise<void>) | null>(null);

  // Session routing: read ?session= from URL, allow programmatic navigation
  const sessionId = searchParams.get("session");

  // 1.1.53 M1 — live pulse for the group's shared session. `pulseActivityId`
  // mirrors what useSkillAgent puts on the wire (activity_id only when it's an
  // `act-…` id, else the turn is keyed group-level), so the pulse reads the SAME
  // group_sessions doc the turn-lock writes.
  const pulseActivityId = activityId.startsWith("act-") ? activityId : null;
  const { revision: groupRevision, turnInFlight: groupTurnInFlightRaw } =
    useGroupPulse(pulseActivityId);
  // A device with no live messages of its own is a "pure watcher": refetching
  // history on a revision bump is duplicate-free (ChatMessageList renders
  // restored history and the live block separately, un-deduped). Once this
  // device sends, it relies on its own live stream and stops live-refetching.
  const watcherRevision = messages.length === 0 ? groupRevision : 0;
  const { initialMessages, initialInteractions, interactionsTruncated, historyError, sessionGone } =
    useSessionMessages(sessionId, watcherRevision);
  // Another group member's turn is streaming (and it isn't THIS device's own
  // send — that's `isLoading`). Drives the composer lock + queue below.
  const groupTurnInFlight = groupTurnInFlightRaw && !isLoading;
  // 1.1.53 M1 — a message the student composed while a groupmate held the turn.
  // Held locally and auto-sent when the shared session frees (soft turn-lock),
  // so two students can't race two parallel turns onto one session.
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);

  // Phase 1.I-PhA proactive greet: fire POST /api/sessions/{id}/greet on
  // chat mount when the skill opts in AND we're starting a brand-new
  // session (no URL ?session= → no historical messages to fetch). The
  // returned text is spliced into `initialMessages` below as a synthetic
  // first assistant message so the student sees the tutor speak first
  // instead of staring at the static welcome banner. Idempotent on the
  // backend; ref-guarded on the frontend.
  const proactiveGreetEnabled = skillProactiveGreet && sessionId === null;
  const { greetMessage: proactiveGreetMessage, loading: greetLoading } = useProactiveGreet({
    sessionId: stableThreadId,
    skillId,
    enabled: proactiveGreetEnabled,
  });
  const { tabs: sessionDocTabs } = useSessionDocuments(sessionId);
  const { sessions, isLoading: sessionsLoading } = useSkillSessions(skillId);

  // Tracks whether the user reached this chat by clicking a conversation
  // thread (resume) vs starting a fresh chat. Backend uses this flag to
  // decide whether to eagerly inline document content into the LLM
  // request (resume → yes, fresh → standard tool-discovery flow).
  // Initial value: ?session= was already in the URL on mount = resume.
  // Updated by handleSelectSession (true) and handleNewSession (false);
  // intentionally NOT set by the URL-writeback effect that runs after a
  // fresh chat's first message — that's not a resume.
  // Whether this mount resumed an existing session — gates rendering of the
  // fetched history (initialMessages). Robust to the anon-group async
  // session-adoption that previously left history unrendered on reload; see
  // useEnteredViaResume for the full rationale. Explicit nav still sets it
  // directly (select-thread → true, new-conversation → false).
  const [enteredViaResume, setEnteredViaResume] = useEnteredViaResume(
    sessionId,
    messages.length,
  );

  // When the URL points at an existing session and we've resolved its
  // documentIds, mount those tabs (with `included: true`) so the user lands
  // on the same workspace they had during the original conversation. Only
  // fires once per session-load — `lastSyncedSessionId` ref guards against
  // wiping subsequent tab edits the user makes inside the same session.
  const lastSyncedSessionId = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId) {
      // Cleared back to a fresh chat — drop the ref so revisiting the same
      // session later still hydrates its tabs.
      lastSyncedSessionId.current = null;
      return;
    }
    if (sessionDocTabs === null) return;
    if (lastSyncedSessionId.current === sessionId) return;
    lastSyncedSessionId.current = sessionId;
    setOpenTabs(sessionDocTabs);
    setActiveTabId(sessionDocTabs[0]?.id ?? null);
  }, [sessionId, sessionDocTabs]);

  const navigateToSession = useCallback(
    (sid: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("session", sid);
      router.replace(`${pathPrefix}?${params.toString()}`);
    },
    [router, pathPrefix, searchParams],
  );

  // Pin the URL to the agent's session id once a fresh chat has produced its
  // first user message. Without this the ChatSessionIndex row exists in
  // Firestore but the URL never reflects it, so a refresh starts a new chat
  // and the existing session looks "lost". Skip when the URL already has a
  // session — the resume path is already pointing at the right id.
  useEffect(() => {
    if (!sessionId && agentSessionId && messages.length > 0) {
      navigateToSession(agentSessionId);
    }
  }, [sessionId, agentSessionId, messages.length, navigateToSession]);

  const userInitial = (user.displayName ?? user.email ?? "U").charAt(0).toUpperCase();
  const userDisplayName = user.displayName ?? user.email ?? "You";

  // Documents currently included in agent context. Every open tab defaults to
  // included; users uncheck the box on a tab to exclude it without closing it.
  // Derivation extracted to lib/docContext.ts so the multi-doc contract is
  // unit-testable independently of the chat-page render tree
  // (multi-doc-context-fix.md / 1.22 D2).
  const includedDocIds = computeIncludedDocIds(openTabs);

  // 1.1.45 M3b — the document-feedback workbench's active file. Merged into the
  // docs sent to the tutor so it critiques whatever file the student is viewing.
  const [workbenchDocId, setWorkbenchDocId] = useState<string | null>(null);
  const outgoingDocIds = useMemo(
    () =>
      workbenchDocId && !includedDocIds.includes(workbenchDocId)
        ? [...includedDocIds, workbenchDocId]
        : includedDocIds,
    [includedDocIds, workbenchDocId],
  );
  const handleWorkbenchActiveDoc = useCallback(
    (docId: string | null) => {
      setWorkbenchDocId(docId);
      // Research telemetry only (best-effort) — never a tutor-context write.
      if (docId) reportDocumentEvent(sessionId ?? agentSessionId, { kind: "document.open", docId });
    },
    [sessionId, agentSessionId],
  );

  async function handleSend() {
    const text = draft.trim();
    const attachments = images.attachments;
    // Allow an image-only turn (no text) when something is staged.
    if ((!text && attachments.length === 0) || isLoading || error) return;
    // 1.1.53 M1 — a groupmate holds the turn: queue this text and let the
    // auto-flush effect send it when the lock clears, instead of racing a second
    // parallel run onto the shared session (the backend would 409 anyway). Only
    // text is queued; staged images stay in the composer for a manual send.
    if (groupTurnInFlight && text) {
      setQueuedMessage(text);
      setDraft("");
      return;
    }
    lastUserMessageRef.current = text;
    setDraft("");
    // Non-retention: the staged bytes ride this one turn only. Clear the
    // composer immediately — the backend injects them transiently and never
    // persists, so there's nothing to show back in history.
    images.clear();
    // Ask the open sim artefact to flush any buffered state (e.g. Boldkast's
    // commit-on-submit slider values) BEFORE the message goes out, so the tutor
    // sees what the student has set this turn. Awaited (bounded) so the flushed
    // state commits ahead of the AI run reading it; no-op when no sim is open.
    await artefactFlushRef.current?.();
    // Snap to chat tab on mobile so the student sees the response
    // stream in. No effect on md+ where both panels are visible.
    setMobileTab("chat");
    await sendMessage(text, {
      documentIds: outgoingDocIds,
      resumedSession: enteredViaResume,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  }

  const handleRetry = useCallback(() => {
    const text = lastUserMessageRef.current;
    if (!text) { clearError(); return; }
    clearError();
    void sendMessage(text, {
      documentIds: outgoingDocIds,
      resumedSession: enteredViaResume,
    });
  }, [clearError, sendMessage, outgoingDocIds, enteredViaResume]);

  // 1.1.53 M1 — flush a queued message once the group's turn-lock clears (and
  // this device isn't mid-send). Sends exactly once, then clears the queue.
  useEffect(() => {
    if (groupTurnInFlight || isLoading || !queuedMessage) return;
    const text = queuedMessage;
    setQueuedMessage(null);
    lastUserMessageRef.current = text;
    void sendMessage(text, {
      documentIds: outgoingDocIds,
      resumedSession: enteredViaResume,
    });
  }, [groupTurnInFlight, isLoading, queuedMessage, sendMessage, outgoingDocIds, enteredViaResume]);

  const handleAction = useCallback(
    (event: { actionName: string; context: Record<string, unknown> }) => {
      void sendMessage(
        `[a2ui:${event.actionName}] ${JSON.stringify(event.context)}`,
        { documentIds: outgoingDocIds, resumedSession: enteredViaResume },
      );
    },
    [sendMessage, outgoingDocIds, enteredViaResume],
  );

  // Wraps navigateToSession with the resume signal so we differentiate
  // explicit thread clicks from the URL writeback that happens after a
  // fresh chat's first message.
  const handleSelectSession = useCallback(
    (sid: string) => {
      setEnteredViaResume(true);
      navigateToSession(sid);
    },
    [navigateToSession, setEnteredViaResume],
  );

  const handleNewSession = useCallback(() => {
    setEnteredViaResume(false);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("session");
    const qs = params.toString();
    router.replace(qs ? `${pathPrefix}?${qs}` : pathPrefix);
  }, [router, pathPrefix, searchParams, setEnteredViaResume]);

  // Defensive auto-clear: when ANY mutation site reports a deletion via the
  // sessions-changed bus and that id matches the URL session we're showing,
  // navigate to a fresh chat even if the originating handler missed the
  // active-session check (e.g. stale closure props on a detached panel).
  // See docs/design/v6.1.0/implemented/session-delete-ui.md.
  useEffect(() => {
    return subscribeSessionsChangedDetailed((detail) => {
      if (detail.deletedSessionId && detail.deletedSessionId === sessionId) {
        handleNewSession();
      }
    });
  }, [sessionId, handleNewSession]);

  // Stranded-session-prevention (1.23) Option 1: GET /messages returned 404,
  // meaning ?session=X points at a session the backend no longer has. Drop
  // ?session= from the URL so useStableThreadId mints a fresh UUID before
  // the next outbound POST. One-shot — handleNewSession clears sessionId,
  // which resets sessionGone via the hook on the next effect cycle.
  useEffect(() => {
    if (sessionGone && sessionId) {
      handleNewSession();
    }
  }, [sessionGone, sessionId, handleNewSession]);

  const handleDeleteSkillSession = useCallback(
    async (sid: string) => {
      // Mirrors DocumentHistoryPanel.handleDelete: confirm + DELETE +
      // dispatch sessions-changed (which both useSkillSessions and any
      // mounted useDocumentSessions listen for, so both panels reconcile)
      // + clear URL if the deleted session is active.
      if (
        !window.confirm(
          "Delete this conversation? This can't be undone from the UI.",
        )
      ) {
        return;
      }
      try {
        const res = await fetchWithAuth(
          `/api/proxy/api/sessions/${encodeURIComponent(sid)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        notifySessionsChanged({ deletedSessionId: sid });
        if (sid === sessionId) {
          handleNewSession();
        }
      } catch {
        // Backend rejected. Reconcile via the same bus.
        notifySessionsChanged();
      }
    },
    [sessionId, handleNewSession],
  );

  const handleDocClick = useCallback((doc: ParsedDocument) => {
    setOpenTabs((prev) => {
      if (prev.find((t) => t.id === doc.id)) return prev;
      return [
        ...prev,
        { id: doc.id, filename: doc.originalFilename, format: doc.sourceFormat, included: true },
      ];
    });
    setActiveTabId(doc.id);
  }, []);

  const handleTabClose = useCallback((id: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) setActiveTabId(next[next.length - 1]?.id ?? null);
      return next;
    });
  }, [activeTabId]);

  const handleTabToggleInclude = useCallback((id: string) => {
    setOpenTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, included: !t.included } : t)),
    );
  }, []);

  const inputDisabled = isLoading || error !== null;

  // Esc cancels an in-flight run — perceived-snappiness affordance from
  // ttft-instrumentation.md M2. Bound at document level because the
  // text input is disabled while isLoading (no keydown fires there).
  // No-op when no run is in flight; lets browser handle Esc otherwise.
  useEffect(() => {
    if (!isLoading) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        stop();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isLoading, stop]);

  // Sync the message count into the surrounding HumanToolEventsProvider
  // (mounted in ChatPageInner) so card dispatches land at the right spot
  // between transcript messages. See provider's comment for why it's
  // upstream of this component.
  useSyncMessageCount(messages.length);

  // 1.1.34 — seed restored MCP-app interaction cards into the provider on a
  // resumed session, so reload re-renders "student did X" before the tutor's
  // reaction (not just the reaction). Gated on enteredViaResume, exactly like
  // initialMessages — a fresh chat seeds nothing (stable empty array).
  useSeedRestoredInteractions(enteredViaResume ? initialInteractions : NO_RESTORED_INTERACTIONS);

  // Sprint PROACTIVE-SIM-REACTIVE M8-fix #2 (2026-06-03): populate the
  // ProactiveSimProvider's ref via useEffect AFTER useSkillAgent has
  // produced sendMessage. The provider itself is mounted in ChatPage
  // (the outer component) so the snapshot hooks in THIS component can
  // read context. The ref pattern lets us write the latest wiring on
  // each render without re-rendering the provider.
  const setProactiveSimWiring = useSetProactiveSimWiring();
  const onProactiveTrigger = useCallback(
    (trigger: string, attachments?: EncodedImage[]) => {
      void sendMessage(trigger, {
        documentIds: outgoingDocIds,
        resumedSession: enteredViaResume,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
      });
    },
    [sendMessage, outgoingDocIds, enteredViaResume],
  );
  useEffect(() => {
    setProactiveSimWiring({ skillId, onProactiveTrigger });
    return () => setProactiveSimWiring(null);
  }, [setProactiveSimWiring, skillId, onProactiveTrigger]);

  return (
    <SurfaceRegistryProvider>
    <SurfaceSessionLifecycle sessionId={sessionId} />
    <main className="flex h-full min-h-0 flex-col">
      <SkillsBar
        skills={userSkills}
        activeSkillId={skillId}
        isLoading={skillsLoading}
        onCreateClick={() => router.push("/skills/new")}
        actions={<AutoReadToggle />}
        groupCode={readStoredGroupSession()?.group_code ?? null}
      />

      {showDocumentUI && (
        <DocTabsBar
          tabs={openTabs}
          activeTabId={activeTabId}
          showBrowser={showDocBrowser}
          onSelect={setActiveTabId}
          onClose={handleTabClose}
          onToggleInclude={handleTabToggleInclude}
          onToggleBrowser={() => setShowDocBrowser((v) => !v)}
          onUploadClick={() => setShowUpload((v) => !v)}
        />
      )}

      {/* Mobile tab bar — visible <md only. Lets students on a shared
          phone (Jutland brief: "one phone per three students") swap
          between chat and the workspace (problem statement / Vis
          markers / Boldkast sim) without cramming both into 350px.
          Above md the tab bar is hidden and both panels render
          side-by-side. */}
      {showWorkspace && (
        <div className="flex md:hidden border-b bg-muted/30" role="tablist" aria-label="Skift mellem chat og arbejdsområde">
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "chat"}
            onClick={() => setMobileTab("chat")}
            className={`flex-1 px-4 py-2 text-sm font-medium ${
              mobileTab === "chat"
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            💬 Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "workspace"}
            onClick={() => setMobileTab("workspace")}
            className={`flex-1 px-4 py-2 text-sm font-medium ${
              mobileTab === "workspace"
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            📐 Arbejde
          </button>
        </div>
      )}

      {/* PEDCTX — stack chat above workspace below md; side-by-side md+.
          Original was always flex-row, which crammed both columns on
          phones / iPad portrait. md:flex-row lets the AIPLA workspace
          drop below the chat on smaller screens instead of hiding.
          When showWorkspace, the mobile tab bar above gates which
          column is visible <md; both are always visible md+. */}
      <div data-workspace-row className="flex min-h-0 flex-1 flex-col md:flex-row">
        {showDocumentUI && showDocBrowser && (
          <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r bg-muted/30">
            <div className="border-b px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sessions</p>
              <div className="mt-1 max-h-40 overflow-y-auto">
                <SkillSessionPanel
                  sessions={sessions}
                  activeSessionId={sessionId}
                  isLoading={sessionsLoading}
                  onSelectSession={handleSelectSession}
                  onDelete={(sid) => void handleDeleteSkillSession(sid)}
                />
              </div>
            </div>
            <DocListView uid={user.uid} onDocClick={handleDocClick} />
            {showUpload && (
              <div className="border-t">
                <UploadDropZone skillId={skillId} />
              </div>
            )}
            {/* MULTI-SURFACE-A2UI M3: sidebar surface mount — only visible
                when agent populates the surface. Sits below the doc list +
                upload zone so it doesn't disturb the existing sidebar UX. */}
            <SidebarSurfaceRegion sessionId={sessionId ?? agentSessionId} />
          </aside>
        )}

        {showDocumentUI && activeTabId && (
          <div className="flex w-1/2 shrink-0 flex-col overflow-hidden border-r">
            <div className="min-h-0 flex-1 overflow-auto">
              <DocumentPanel docId={activeTabId} />
            </div>
            <DocumentHistoryPanel
              documentId={activeTabId}
              activeSessionId={sessionId}
              currentUserUid={user.uid}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
              onDeleteActive={handleNewSession}
            />
          </div>
        )}

        {/* MULTI-SURFACE-A2UI M3: workspace surface mount — takes the
            doc-panel slot when no doc tab is active AND the agent has
            published a workspace tree. Hidden in both other cases. */}
        {!activeTabId && (
          <WorkspaceSurfaceRegion sessionId={sessionId ?? agentSessionId} />
        )}

        {/* min-h-0 is load-bearing: without it the flex column can grow
            past its parent's height, pushing the input footer below the
            viewport. ChatMessageList's overflow-y-auto only works when
            this parent allows shrink-below-content-size. Fix for the
            "can't see the input" UX bug 2026-05-20. */}
        <div
          className={`min-w-0 min-h-0 flex-1 flex-col ${
            // Mobile gate: only show chat column when the chat tab is
            // active. md+ ignores this — both panels render. When the
            // workspace isn't AIPLA-shaped (non-anon-group or different
            // skill), the gate never fires so chat is always visible.
            showWorkspace && mobileTab !== "chat" ? "hidden" : "flex"
          } ${
            // Resize fullscreen gate: when the workspace is at ratio
            // 1.0 (chat hidden by user choice), drop the chat column
            // on md+ so the workspace takes the whole row. Below md
            // ignored (chat still visible via the mobile tab pattern).
            workspaceFullscreen ? "md:hidden" : "md:flex"
          }`}
        >
          {showResumeBanner && (
            <div className="px-4 pt-3">
              <ResumeWelcomeBanner onDismiss={() => setShowResumeBanner(false)} />
            </div>
          )}
          {/* 1.1.12 — the persona now appears as a hero avatar inside the
              welcome/intro block (PinnedWelcome) rather than a horizontal
              header strip, so it reads bigger without adding a vertical bar.
              The per-bubble avatar still reinforces it on each turn. */}
          {/* The auto-read toggle moved into the SkillsBar header (2026-06-13)
              so it no longer claims a horizontal row above the transcript. */}
          <ChatMessageList
            messages={messages}
            // initialMessages are the persisted history fetched by
            // useSessionMessages(sessionId). They're only relevant when the
            // user RESUMED an existing session — in that case the live
            // `messages` array is empty until the first new turn, so the
            // history fills the gap. When the URL is written back mid-chat
            // (fresh chat → server assigns sessionId → URL update), the
            // history fetch returns the same messages that are ALREADY in
            // live `messages` — duplicating every bubble. `enteredViaResume`
            // distinguishes the two cases.
            initialMessages={
              // For a fresh chat (no resume) prepend the proactive-greet
              // message if it arrived. For a resumed session, the
              // historical greet is already in `initialMessages` from
              // useSessionMessages — no need to splice again.
              enteredViaResume
                ? initialMessages
                : proactiveGreetMessage
                  ? [proactiveGreetMessage]
                  : undefined
            }
            interactionsTruncated={enteredViaResume && interactionsTruncated}
            skillInitialMessage={skillInitialMessage}
            historyError={historyError}
            toolCalls={toolCalls}
            thinkingContent={thinkingContent}
            isThinking={isThinking}
            isLoading={isLoading}
            greetLoading={greetLoading}
            error={error}
            skillId={skillId}
            skillDisplayName={displayName}
            persona={activePersona}
            userInitial={userInitial}
            userDisplayName={userDisplayName}
            stageLabel={stageLabel}
            onAction={handleAction}
            mcpServerIds={mcpServerIds}
            sessionId={sessionId ?? agentSessionId}
            onChatMessage={(text) => {
              // MCP App iframe → notification adapter → synthetic chat
              // turn. Goes out as a normal sendMessage (with the same
              // doc-context + resume flags as a typed message).
              void sendMessage(text, {
                documentIds: outgoingDocIds,
                resumedSession: enteredViaResume,
              });
            }}
            errorBanner={
              error ? (
                <StreamErrorBanner
                  error={error}
                  onRetry={handleRetry}
                  onDismiss={clearError}
                />
              ) : undefined
            }
          />

          <footer className="border-t p-3">
            {skillMultimodalInput && (
              <ImageStagingRow
                staged={images.staged}
                notice={images.notice}
                onRemove={images.remove}
              />
            )}
            {composerVoice.capabilities.recording && (
              <div className="mb-2">
                <LessonRecordingPanel
                  lang={composerVoice.tts.language ?? "da"}
                  disabled={inputDisabled}
                  onRecordingChange={setLessonRecording}
                  onNotice={setVoiceNotice}
                />
              </div>
            )}
            {voiceNotice && (
              <p className="mb-2 text-xs text-muted-foreground">{voiceNotice}</p>
            )}
            {groupTurnInFlight && (
              <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                {queuedMessage
                  ? "A classmate is asking the tutor — your message will send when it's your group's turn."
                  : "A classmate is asking the tutor…"}
              </p>
            )}
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSend();
              }}
            >
              {skillMultimodalInput && (
                <ImageUploadButtons
                  onFiles={(files) => void images.addFiles(files)}
                  disabled={inputDisabled}
                  full={images.count >= MAX_IMAGES}
                />
              )}
              <VoiceComposerControls
                skillId={skillId}
                lang={composerVoice.tts.language ?? "da"}
                voiceInputEnabled={composerVoice.capabilities.voiceInput && composerVoice.stt.provider !== "disabled"}
                disabled={inputDisabled || lessonRecording}
                onTranscript={(t) => setDraft((d) => (d.trim() ? `${d} ${t}` : t))}
                onNotice={setVoiceNotice}
              />
              {isAnonymousGroupAuthMode() && <CallTeacherButton disabled={inputDisabled} />}
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message…"
                className="flex-1 rounded-md border px-3 py-2 text-sm"
                disabled={inputDisabled}
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={stop}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                  disabled={(!draft.trim() && images.count === 0) || inputDisabled}
                >
                  Send
                </button>
              )}
            </form>
          </footer>
        </div>

        {/* PEDCTX M2 — AIPLA workspace pane for anon-group +
            problem-set-hints. Sits as a sibling of the chat column so
            the two share the row (60/40 on lg+). M3 fills with the
            problem statement; M5 stretch adds the progress checklist;
            the Boldkast sim lands here later in the buffer week.
            Other auth modes and other skills keep the inherited
            DocumentPanel / WorkspaceSurfaceRegion behaviour above. */}
        {/* TAA-1 workspace composer (generalized): ONE WorkspaceShell driven
            by config — a registered sim block (dispatched by slug) OR, for a
            no-sim concept activity, the teacher-authored checklist. The gate
            (showWorkspace) is config-driven; no per-element shell duplication.
            Adding a non-sim element (quiz, A2UI) composes here from config. */}
        {showWorkspace && (
          <WorkspaceShell
            hideOnMobile={mobileTab !== "workspace"}
            ratio={workspaceRatio}
            onRatioChange={setWorkspaceRatio}
          >
            <>
            {workspaceKind !== "none" && (
              // USR-1 (2026-06-25): ONE sim render path. Every workspace surface
              // — a vetted sim artefact, the 1.1.38 element tools, and the
              // documents panel (1.1.33) — renders through the single generic
              // StudentWorkspace mount, the same component the builder preview
              // uses (1.1.40) so the two can't drift. The slug-driven bespoke
              // sim frames (Boldkast/LED-Planck/KineBot) are gone.
              <StudentWorkspace
                skillId={skillId}
                sessionId={sessionId ?? agentSessionId}
                sandboxOrigin={BOLDKAST_SANDBOX_ORIGIN}
                artefact={activeArtefact}
                checklist={activeChecklist}
                table={activeTable}
                chart={activeChart}
                calculator={activeCalculator}
                note={activeNote}
                solution={activeSolution}
                document={activeDocument}
                onDocumentActiveChange={handleWorkbenchActiveDoc}
                materials={activeMaterials}
                images={uploadedImages}
                activityId={activityId}
                onRegisterArtefactFlush={(fn) => {
                  artefactFlushRef.current = fn;
                }}
              />
            )}
            {/* Documents for the legacy sim frames + chat-only activities. The
                generic StudentWorkspace renders its own (guarded so they never
                double up). Self-hides when there are no materials/uploads. */}
            {usesStudentWorkspace ? null : (
              <DocumentsPanel
                materials={activeMaterials}
                images={uploadedImages}
                activityId={activityId}
              />
            )}
              </>
          </WorkspaceShell>
        )}
      </div>
      <LatencyHUD />
      {/* MULTI-SURFACE-A2UI M3: modal surface mount — fixed-position
          overlay at page root. Only visible when populated; M4 will wire
          the user-gesture guard so the agent can't pop one unprompted. */}
      <ModalSurfaceRegion sessionId={sessionId ?? agentSessionId} />
    </main>
    </SurfaceRegistryProvider>
  );
}
