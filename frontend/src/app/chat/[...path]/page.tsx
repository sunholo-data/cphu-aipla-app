"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AutoReadToggle } from "@/components/chat/AutoReadToggle";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { LangToggle } from "@/components/chat/LangToggle";
import { ResumeWelcomeBanner } from "@/components/chat/ResumeWelcomeBanner";
import { VoiceStatusPill } from "@/components/chat/VoiceStatusPill";
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
import { useSessionDocuments } from "@/hooks/useSessionDocuments";
import { useStableThreadId } from "@/hooks/useStableThreadId";
import { useProactiveGreet } from "@/lib/proactiveGreet";
import { HumanToolEventsProvider, useSyncMessageCount } from "@/hooks/useHumanToolEvents";
import { fetchWithAuth } from "@/lib/apiClient";
import { computeIncludedDocIds } from "@/lib/docContext";
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
import { BoldkastWorkbench } from "@/components/workspace/BoldkastWorkbench";
import {
  BoldkastSimFrame,
  type BoldkastSimFrameHandle,
} from "@/components/workspace/BoldkastSimFrame";
import { useBoldkastSnapshot } from "@/hooks/useBoldkastSnapshot";
import {
  LedPlanckLabFrame,
  type LedPlanckLabFrameHandle,
} from "@/components/workspace/LedPlanckLabFrame";
import { LedPlanckLabButton } from "@/components/workspace/LedPlanckLabButton";
import { LedPlanckWorkbench } from "@/components/workspace/LedPlanckWorkbench";
import { useLedPlanckSnapshot } from "@/hooks/useLedPlanckSnapshot";
import {
  KineBotFrame,
  type KineBotFrameHandle,
} from "@/components/workspace/KineBotFrame";
import { KineBotWorkbench } from "@/components/workspace/KineBotWorkbench";
import { useKineBotSnapshot } from "@/hooks/useKineBotSnapshot";
import { useResizableWorkspaceRatio } from "@/hooks/useResizableWorkspaceRatio";

// PEDCTX M5 — sub-parts of the Boldkast problem-set-hints v0.1 skill.
// v1's problem-set-helper-config will source this from skill metadata;
// for the Jutland demo we ship hardcoded Danish sub-part labels.
const BOLDKAST_SUBPARTS = [
  { id: "a", label: "a) Hvor lang tid er bolden i luften?" },
  { id: "b", label: "b) Hvor langt rækker den (vandret distance)?" },
  { id: "c", label: "c) Hvad er den maksimale højde?" },
  { id: "d", label: "d) Tegn en skitse over banen." },
];

// Sandbox origin for the Boldkast sim iframe. NEXT_PUBLIC_MCP_SANDBOX_URL
// points at /sandbox.html on the sandbox service; strip the suffix so we
// have the bare origin, then BoldkastSimFrame appends the artefact path.
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

/**
 * 1.1.11 voice controls — language picker + auto-read toggle pill row
 * at the top of the chat. Split into a child component so the
 * useVoiceConfig hook doesn't run on every parent render.
 */
function ChatVoiceControls({ skillId }: { skillId: string }) {
  const voiceConfig = useVoiceConfig(skillId);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 px-4 pt-2">
      <VoiceStatusPill voiceConfig={voiceConfig} />
      <LangToggle defaultLang={voiceConfig.tts.language} />
      <AutoReadToggle />
    </div>
  );
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

  // path is validated by useSlugResolution; safe to construct the friendly prefix.
  const pathPrefix = `/chat/${path[0]}/${path[1]}`;

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

  // 1.F: for anonymous-group users, read the resumedSessionId from the
  // stored join response. Memoised with an empty dep array so it's read
  // exactly once at mount — by the time any effect fires the URL may have
  // already been updated, so we freeze the "was there a resume on load?" state.
  const resumedSessionId = useMemo<string | null>(() => {
    if (!isAnonymousGroupAuthMode()) return null;
    if (urlSessionId !== null) return null; // already navigated to a specific session
    return readStoredGroupSession()?.resumedSessionId ?? null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Write ?session=resumedSessionId immediately on mount so useSessionMessages
  // starts loading the prior history without waiting for the first message.
  useEffect(() => {
    if (resumedSessionId && !urlSessionId) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("session", resumedSessionId);
      router.replace(`${pathPrefix}?${params.toString()}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally runs once on mount

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
       *  live inside its return — ChatShell's top-level snapshot hooks
       *  (useBoldkastSnapshot / useLedPlanckSnapshot / useKineBotSnapshot)
       *  call useHumanToolEvents during render. If the provider sits
       *  inside ChatShell's JSX, those hook calls fall outside the
       *  provider's subtree and silently get the no-op fallback — POSTs
       *  still go out, but no "Sendte spørgsmål med …" cards render in
       *  chat. messages.length is synced via useSyncMessageCount inside
       *  ChatShell. (Was lost between 86e24ee → 3563af1; restored 2026-06-01.) */}
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
  } = useSkillAgent();
  const {
    displayName,
    mcpServerIds,
    initialMessage: skillInitialMessage,
    slug: skillSlug,
    problemStatement: skillProblemStatement,
    proactiveGreet: skillProactiveGreet,
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
  const showAiplaWorkspace =
    isAnonymousGroupAuthMode() &&
    (skillSlug === "problem-set-hints" ||
      skillSlug === "led-planck-tutor" ||
      skillSlug === "kinebot-kinematics-tutor");
  const searchParams = useSearchParams();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  // PEDCTX/Boldkast — workspace toggle between default content
  // (problem statement + checklist) and the Boldkast sim iframe.
  const [showBoldkastSim, setShowBoldkastSim] = useState(false);
  // 1.C follow-up / middle-path UX rework — same toggle shape for LED
  // Planck. Default surface is the launcher button + lesson workbench;
  // click to mount the bench-only lab frame. The snapshot now lives in
  // a shared hook (called below, once sessionId is defined) that both
  // the bench iframe and the React Results surface report into.
  const [showLedPlanckLab, setShowLedPlanckLab] = useState(false);
  // 1.D — KineBot. After the workbench-split rework the workbench is
  // the always-on surface (topics + quiz + graph + notes) and the sim
  // opens as a toggle. The snapshot lives in a shared hook (called
  // below, once sessionId is defined) that both the sim iframe and the
  // React workbench report into.
  const [showKinebotLab, setShowKinebotLab] = useState(false);
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
      body: JSON.stringify({ skillId }),
    }).catch((err) => {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[session_bootstrap] failed:", err);
      }
    });
  }, [agentSessionId, skillId]);

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
  // 1.E Phase 2: ref into BoldkastSimFrame so handleSend can ask the
  // artefact to flush any pending slider changes before the user
  // message lands. Optional chaining on the ref means handleSend
  // proceeds unaffected when the frame isn't mounted.
  const boldkastFrameRef = useRef<BoldkastSimFrameHandle | null>(null);
  const ledPlanckFrameRef = useRef<LedPlanckLabFrameHandle | null>(null);
  const kinebotFrameRef = useRef<KineBotFrameHandle | null>(null);

  // Session routing: read ?session= from URL, allow programmatic navigation
  const sessionId = searchParams.get("session");
  const { initialMessages, historyError, sessionGone } = useSessionMessages(sessionId);

  // KineBot shared snapshot (sim iframe + React quiz/graph/topic feed it).
  const { snapshot: kinebotSnapshot, reportEvent: reportKinebotEvent } =
    useKineBotSnapshot(sessionId ?? agentSessionId);

  // LED Planck shared snapshot (bench iframe + React Results feed it).
  const { snapshot: ledPlanckSnapshot, reportEvent: reportLedPlanckEvent } =
    useLedPlanckSnapshot(sessionId ?? agentSessionId);

  // Boldkast shared snapshot (bench iframe feeds it; workbench mirrors it).
  const { snapshot: boldkastSnapshot, reportEvent: reportBoldkastEvent } =
    useBoldkastSnapshot(sessionId ?? agentSessionId);

  // Phase 1.I-PhA proactive greet: fire POST /api/sessions/{id}/greet on
  // chat mount when the skill opts in AND we're starting a brand-new
  // session (no URL ?session= → no historical messages to fetch). The
  // returned text is spliced into `initialMessages` below as a synthetic
  // first assistant message so the student sees the tutor speak first
  // instead of staring at the static welcome banner. Idempotent on the
  // backend; ref-guarded on the frontend.
  const proactiveGreetEnabled = skillProactiveGreet && sessionId === null;
  const { greetMessage: proactiveGreetMessage } = useProactiveGreet({
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
  const [enteredViaResume, setEnteredViaResume] = useState<boolean>(
    () => sessionId !== null,
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

  async function handleSend() {
    const text = draft.trim();
    if (!text || isLoading || error) return;
    lastUserMessageRef.current = text;
    setDraft("");
    // 1.E Phase 2: ask any mounted workbench artefact to flush its
    // pending slider changes BEFORE the user message goes out. The
    // artefact responds synchronously inside its iframe (postMessage
    // is queued in-process) so the resulting state-change ends up on
    // the wire ahead of sendMessage in practice. Fire-and-forget: we
    // don't await, and missing ref = no-op.
    boldkastFrameRef.current?.sendChatFlush();
    ledPlanckFrameRef.current?.sendChatFlush();
    kinebotFrameRef.current?.sendChatFlush();
    // Snap to chat tab on mobile so the student sees the response
    // stream in. No effect on md+ where both panels are visible.
    setMobileTab("chat");
    await sendMessage(text, {
      documentIds: includedDocIds,
      resumedSession: enteredViaResume,
    });
  }

  const handleRetry = useCallback(() => {
    const text = lastUserMessageRef.current;
    if (!text) { clearError(); return; }
    clearError();
    void sendMessage(text, {
      documentIds: includedDocIds,
      resumedSession: enteredViaResume,
    });
  }, [clearError, sendMessage, includedDocIds, enteredViaResume]);

  const handleAction = useCallback(
    (event: { actionName: string; context: Record<string, unknown> }) => {
      void sendMessage(
        `[a2ui:${event.actionName}] ${JSON.stringify(event.context)}`,
        { documentIds: includedDocIds, resumedSession: enteredViaResume },
      );
    },
    [sendMessage, includedDocIds, enteredViaResume],
  );

  // Wraps navigateToSession with the resume signal so we differentiate
  // explicit thread clicks from the URL writeback that happens after a
  // fresh chat's first message.
  const handleSelectSession = useCallback(
    (sid: string) => {
      setEnteredViaResume(true);
      navigateToSession(sid);
    },
    [navigateToSession],
  );

  const handleNewSession = useCallback(() => {
    setEnteredViaResume(false);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("session");
    const qs = params.toString();
    router.replace(qs ? `${pathPrefix}?${qs}` : pathPrefix);
  }, [router, pathPrefix, searchParams]);

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

  // Sprint PROACTIVE-SIM-REACTIVE M8-fix #2 (2026-06-03): populate the
  // ProactiveSimProvider's ref via useEffect AFTER useSkillAgent has
  // produced sendMessage. The provider itself is mounted in ChatPage
  // (the outer component) so the snapshot hooks in THIS component can
  // read context. The ref pattern lets us write the latest wiring on
  // each render without re-rendering the provider.
  const setProactiveSimWiring = useSetProactiveSimWiring();
  const onProactiveTrigger = useCallback(
    (trigger: string) => {
      void sendMessage(trigger, {
        documentIds: includedDocIds,
        resumedSession: enteredViaResume,
      });
    },
    [sendMessage, includedDocIds, enteredViaResume],
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
      {showAiplaWorkspace && (
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
          When showAiplaWorkspace, the mobile tab bar above gates which
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
            showAiplaWorkspace && mobileTab !== "chat" ? "hidden" : "flex"
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
          {/* 1.1.11 voice controls — language picker + auto-read toggle.
              Lives at the top of the chat so the student can flip either
              any time without digging in settings. */}
          <ChatVoiceControls skillId={skillId} />
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
            skillInitialMessage={skillInitialMessage}
            historyError={historyError}
            toolCalls={toolCalls}
            thinkingContent={thinkingContent}
            isThinking={isThinking}
            isLoading={isLoading}
            error={error}
            skillId={skillId}
            skillDisplayName={displayName}
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
                documentIds: includedDocIds,
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
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSend();
              }}
            >
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
                  disabled={!draft.trim() || inputDisabled}
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
        {showAiplaWorkspace && skillSlug === "kinebot-kinematics-tutor" && (
          <WorkspaceShell
            hideOnMobile={mobileTab !== "workspace"}
            ratio={workspaceRatio}
            onRatioChange={setWorkspaceRatio}
          >
            {showKinebotLab && BOLDKAST_SANDBOX_ORIGIN ? (
              <KineBotFrame
                ref={kinebotFrameRef}
                sandboxOrigin={BOLDKAST_SANDBOX_ORIGIN}
                topic={kinebotSnapshot?.currentTopic ?? "intro"}
                reportEvent={reportKinebotEvent}
                onClose={() => setShowKinebotLab(false)}
              />
            ) : (
              <KineBotWorkbench
                snapshot={kinebotSnapshot}
                sandboxOrigin={BOLDKAST_SANDBOX_ORIGIN}
                onOpenSim={() => setShowKinebotLab(true)}
                onTopicChange={(topic) => {
                  reportKinebotEvent({ kind: "kinebot.set-topic", topic });
                  kinebotFrameRef.current?.setTopic(topic);
                }}
                reportEvent={reportKinebotEvent}
                simDisabled={!BOLDKAST_SANDBOX_ORIGIN}
              />
            )}
          </WorkspaceShell>
        )}

        {showAiplaWorkspace && skillSlug === "led-planck-tutor" && (
          <WorkspaceShell
            hideOnMobile={mobileTab !== "workspace"}
            ratio={workspaceRatio}
            onRatioChange={setWorkspaceRatio}
          >
            {showLedPlanckLab && BOLDKAST_SANDBOX_ORIGIN ? (
              <LedPlanckLabFrame
                ref={ledPlanckFrameRef}
                sandboxOrigin={BOLDKAST_SANDBOX_ORIGIN}
                onClose={() => setShowLedPlanckLab(false)}
                reportEvent={reportLedPlanckEvent}
              />
            ) : (
              <div className="space-y-4">
                <LedPlanckLabButton
                  onOpen={() => setShowLedPlanckLab(true)}
                  disabled={!BOLDKAST_SANDBOX_ORIGIN}
                />
                <LedPlanckWorkbench
                  snapshot={ledPlanckSnapshot}
                  reportEvent={reportLedPlanckEvent}
                  sessionId={sessionId ?? agentSessionId}
                />
              </div>
            )}
          </WorkspaceShell>
        )}

        {showAiplaWorkspace && skillSlug === "problem-set-hints" && (
          <WorkspaceShell
            hideOnMobile={mobileTab !== "workspace"}
            ratio={workspaceRatio}
            onRatioChange={setWorkspaceRatio}
          >
            {showBoldkastSim && BOLDKAST_SANDBOX_ORIGIN ? (
              <BoldkastSimFrame
                ref={boldkastFrameRef}
                sandboxOrigin={BOLDKAST_SANDBOX_ORIGIN}
                reportEvent={reportBoldkastEvent}
                onClose={() => setShowBoldkastSim(false)}
              />
            ) : (
              <BoldkastWorkbench
                snapshot={boldkastSnapshot}
                onOpenSim={() => setShowBoldkastSim(true)}
                simDisabled={!BOLDKAST_SANDBOX_ORIGIN}
                skillId={skillId}
                subParts={BOLDKAST_SUBPARTS}
                problemStatement={skillProblemStatement}
                sessionId={sessionId ?? agentSessionId}
              />
            )}
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
