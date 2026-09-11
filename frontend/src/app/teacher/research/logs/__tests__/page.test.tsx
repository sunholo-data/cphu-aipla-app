import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import type { ChatLogSession, ChatLogTab, ChatLogTurn } from "@/lib/teacherApi";
import ResearchLogsPage from "@/app/teacher/research/logs/page";

const UNASSIGNED = "__unassigned__";

function tab(overrides: Partial<ChatLogTab> = {}): ChatLogTab {
  return {
    framework_id: "authentic-dialogue",
    sessions: 8,
    turns: 48,
    groups_seen: 2,
    student_turns: 24,
    tutor_turns: 24,
    first_ts: "2026-09-11T08:03:15",
    last_ts: "2026-09-11T10:46:10",
    ...overrides,
  };
}

function session(overrides: Partial<ChatLogSession> = {}): ChatLogSession {
  return {
    session_id: "9f2927f6-00c0-4a7d-bbbb-111111111111",
    framework_id: "authentic-dialogue",
    group_id: "crisp-pebble-21",
    tutor_id: "henrik",
    persona_id: "henrik",
    class_id: "0be138dda057",
    activity_id: "act-f3bd4f92a9",
    interaction_style: "rigorous",
    teaching_source: "tutor",
    skill_id: "concept-dialogue",
    revision: "aipla-v01-frontend-00042",
    turns: 4,
    student_turns: 2,
    tutor_turns: 2,
    readable_turns: 3,
    started_at: "2026-09-11T08:03:15",
    last_at: "2026-09-11T08:09:02",
    ...overrides,
  };
}

function turn(overrides: Partial<ChatLogTurn> = {}): ChatLogTurn {
  return {
    ts: "2026-09-11T08:03:15",
    turn_index: 0,
    role: "student",
    content: "why does it fall?",
    is_synthetic: false,
    model: "gemini-2.5-flash",
    framework_id: "authentic-dialogue",
    tutor_id: "henrik",
    persona_id: "henrik",
    class_id: "0be138dda057",
    activity_id: "act-f3bd4f92a9",
    interaction_style: "rigorous",
    teaching_source: "tutor",
    group_id: "crisp-pebble-21",
    skill_id: "concept-dialogue",
    revision: "r1",
    app_version: "v0.1.44",
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("researcher chat-log lens", () => {
  it("renders a tab per teaching approach with its conversation count", async () => {
    vi.spyOn(teacherApi, "listChatLogTabs").mockResolvedValue({
      tabs: [tab(), tab({ framework_id: UNASSIGNED, sessions: 78, turns: 822 })],
      unassignedKey: UNASSIGNED,
    });
    vi.spyOn(teacherApi, "listChatLogSessions").mockResolvedValue([session()]);

    render(<ResearchLogsPage />);

    const tabs = await screen.findAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent("authentic-dialogue");
    expect(tabs[0]).toHaveTextContent("8");
  });

  it("labels the null bucket as NOT RECORDED, never as 'no framework'", async () => {
    // The load-bearing one. Every row before 2026-09-11 is null because the
    // field did not exist — calling that "no framework" turns a gap in the
    // instrumentation into a claim about pedagogy.
    vi.spyOn(teacherApi, "listChatLogTabs").mockResolvedValue({
      tabs: [tab({ framework_id: UNASSIGNED, sessions: 78, turns: 822 })],
      unassignedKey: UNASSIGNED,
    });
    vi.spyOn(teacherApi, "listChatLogSessions").mockResolvedValue([]);

    render(<ResearchLogsPage />);

    const tab0 = await screen.findByRole("tab");
    expect(tab0).toHaveTextContent(/not recorded/i);
    expect(tab0).not.toHaveTextContent(/no framework/i);
    expect(await screen.findByText(/deliberately not backfilled/i)).toBeInTheDocument();
  });

  it("shows a FAILED READ, never an empty tab, when the store is unreadable", async () => {
    // The reassuring-wrong-answer guard: an outage and "nothing ran under this
    // approach" would otherwise look identical, and the second reads as a
    // research finding.
    vi.spyOn(teacherApi, "listChatLogTabs").mockRejectedValue(
      new Error("chat-log store unreadable: 503 failed read"),
    );

    render(<ResearchLogsPage />);

    expect(await screen.findByText(/could not read the conversation store/i)).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("shows the access-required state for a non-researcher", async () => {
    vi.spyOn(teacherApi, "listChatLogTabs").mockRejectedValue(new Error("forbidden: 403 nope"));

    render(<ResearchLogsPage />);

    expect(await screen.findByText(/researcher access required/i)).toBeInTheDocument();
  });

  it("shows which class, tutor, activity and style produced each conversation", async () => {
    vi.spyOn(teacherApi, "listChatLogTabs").mockResolvedValue({ tabs: [tab()], unassignedKey: UNASSIGNED });
    vi.spyOn(teacherApi, "listChatLogSessions").mockResolvedValue([session()]);

    render(<ResearchLogsPage />);

    expect(await screen.findByText("henrik")).toBeInTheDocument();
    expect(screen.getByText("rigorous")).toBeInTheDocument();
    expect(screen.getByText(/0be138dda0/)).toBeInTheDocument();
    expect(screen.getByText(/act-f3bd4f92a9/)).toBeInTheDocument();
  });

  it("reports readable turns apart from total when they differ", async () => {
    // A 4-turn session that is really 3 turns plus a system opener.
    vi.spyOn(teacherApi, "listChatLogTabs").mockResolvedValue({ tabs: [tab()], unassignedKey: UNASSIGNED });
    vi.spyOn(teacherApi, "listChatLogSessions").mockResolvedValue([session({ turns: 4, readable_turns: 3 })]);

    render(<ResearchLogsPage />);

    expect(await screen.findByText("3 of 4")).toBeInTheDocument();
  });

  it("drills into a transcript and marks the synthetic opener as system, not student", async () => {
    vi.spyOn(teacherApi, "listChatLogTabs").mockResolvedValue({ tabs: [tab()], unassignedKey: UNASSIGNED });
    vi.spyOn(teacherApi, "listChatLogSessions").mockResolvedValue([session()]);
    const transcript = vi.spyOn(teacherApi, "getChatLogTranscript").mockResolvedValue([
      turn({ turn_index: 0, role: "student", content: "[session_start]", is_synthetic: true }),
      turn({ turn_index: 2, role: "tutor", content: "Hvilket fysisk fænomen?" }),
    ]);

    render(<ResearchLogsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /read/i }));

    await waitFor(() => expect(transcript).toHaveBeenCalledWith(session().session_id));
    expect(await screen.findByText(/system opened the conversation/i)).toBeInTheDocument();
    expect(screen.getByText("Hvilket fysisk fænomen?")).toBeInTheDocument();
  });

  it("switching tab refetches that tab's conversations", async () => {
    vi.spyOn(teacherApi, "listChatLogTabs").mockResolvedValue({
      tabs: [tab(), tab({ framework_id: "esru", sessions: 2, turns: 9 })],
      unassignedKey: UNASSIGNED,
    });
    const list = vi.spyOn(teacherApi, "listChatLogSessions").mockResolvedValue([session()]);

    render(<ResearchLogsPage />);
    await screen.findAllByRole("tab");
    await userEvent.click(screen.getByRole("tab", { name: /esru/i }));

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ framework: "esru" }, 100),
    );
  });

  it("shows a framework with no conversations at zero rather than hiding it", async () => {
    // "ESRU has been assigned to nobody yet" is a finding, and an absent tab
    // makes it indistinguishable from a framework that does not exist.
    vi.spyOn(teacherApi, "listTeachingFrameworks").mockResolvedValue([
      { id: "esru", label: "ESRU" } as never,
    ]);
    vi.spyOn(teacherApi, "listChatLogTabs").mockResolvedValue({ tabs: [tab()], unassignedKey: UNASSIGNED });
    vi.spyOn(teacherApi, "listChatLogSessions").mockResolvedValue([session()]);

    render(<ResearchLogsPage />);

    const tabs = await screen.findAllByRole("tab");
    const esru = tabs.find((t) => /ESRU/.test(t.textContent ?? ""));
    expect(esru).toBeDefined();
    expect(esru).toHaveTextContent("0");
  });

  it("exports the current filter as a download rather than a bare link", async () => {
    // The export endpoint is authenticated; an <a href> navigation carries no
    // bearer token and would 401.
    vi.spyOn(teacherApi, "listChatLogTabs").mockResolvedValue({ tabs: [tab()], unassignedKey: UNASSIGNED });
    vi.spyOn(teacherApi, "listChatLogSessions").mockResolvedValue([session()]);
    const exporter = vi
      .spyOn(teacherApi, "fetchChatLogExport")
      .mockResolvedValue(new Blob(["ts,session_id\n"], { type: "text/csv" }));
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();

    render(<ResearchLogsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /export csv/i }));

    await waitFor(() =>
      expect(exporter).toHaveBeenCalledWith({ framework: "authentic-dialogue" }, "csv"),
    );
  });
});
