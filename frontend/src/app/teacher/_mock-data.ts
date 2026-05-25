/**
 * Phase 1 fixture data for /teacher/* screens.
 *
 * Single source of truth for the static mockup. Phase 2 replaces these
 * imports with real API calls; the shapes stay the same so the swap is
 * mechanical.
 *
 * Values mirror the wireframes in
 *   sunholo-data/aipla/strand-a-pedagogical-bot/prototypes/teacher-ui-brief.md
 * — keep them consistent if the brief changes.
 */

export type GroupStatus = "active" | "idle" | "completed";

export type MockGroup = {
  code: string;
  status: GroupStatus;
  lastActiveLabel: string;
};

export type MockActivity = {
  id: string;
  name: string;
  blurb: string;
  configured: boolean;
};

export type MockClass = {
  id: string;
  name: string;
  groupsActive: number;
  groupsTotal: number;
  groups: MockGroup[];
  activities: MockActivity[];
};

export type MockRecentSession = {
  groupCode: string;
  activityName: string;
  whenLabel: string;
  classId: string;
};

export type MockSessionTurn = {
  timestamp: string;
  role: "student" | "tutor";
  content: string;
};

export type MockSessionReport = {
  classId: string;
  groupCode: string;
  activityName: string;
  startedAtLabel: string;
  durationMinutes: number;
  messageCount: number;
  simRunCount: number;
  highlights: string[];
  checklistComplete: string[];
  checklistIncomplete: string[];
  conversation: MockSessionTurn[];
};

export type MockActivityConfig = {
  id: string;
  classId: string;
  name: string;
  defaultTeachingGoal: string;
  pairedWorkbench: "boldkast-simulator-v1" | null;
  language: "da" | "en";
  difficulty: "standard" | "guided";
  helperText: string;
};

export const MOCK_TEACHER = {
  initials: "AR",
  displayName: "A. Rasmussen",
  schoolLabel: "Institut for Naturfagenes Didaktik",
};

export const MOCK_CLASSES: MockClass[] = [
  {
    id: "7b-physics-a-2026",
    name: "7B Physics A",
    groupsActive: 4,
    groupsTotal: 4,
    groups: [
      { code: "bold-kazoo-87", status: "active", lastActiveLabel: "active now" },
      { code: "ruby-petal-72", status: "idle", lastActiveLabel: "idle" },
      { code: "fluffy-goose-56", status: "completed", lastActiveLabel: "completed" },
      { code: "merry-otter-19", status: "idle", lastActiveLabel: "idle" },
    ],
    activities: [
      {
        id: "boldkast",
        name: "Boldkast",
        blurb: "projectile motion",
        configured: true,
      },
      {
        id: "led-planck",
        name: "LED Planck",
        blurb: "Planck's constant",
        configured: true,
      },
      {
        id: "pendul",
        name: "Pendul",
        blurb: "harmonic motion",
        configured: false,
      },
    ],
  },
  {
    id: "8a-physics-a-2026",
    name: "8A Physics A",
    groupsActive: 2,
    groupsTotal: 2,
    groups: [
      { code: "calm-river-34", status: "active", lastActiveLabel: "active now" },
      { code: "swift-fox-08", status: "idle", lastActiveLabel: "idle" },
    ],
    activities: [
      {
        id: "boldkast",
        name: "Boldkast",
        blurb: "projectile motion",
        configured: true,
      },
      {
        id: "led-planck",
        name: "LED Planck",
        blurb: "Planck's constant",
        configured: false,
      },
    ],
  },
];

export const MOCK_RECENT_SESSIONS: MockRecentSession[] = [
  {
    groupCode: "bold-kazoo-87",
    activityName: "Boldkast",
    whenLabel: "14 min ago",
    classId: "7b-physics-a-2026",
  },
  {
    groupCode: "ruby-petal-72",
    activityName: "Boldkast",
    whenLabel: "1 hr ago",
    classId: "7b-physics-a-2026",
  },
  {
    groupCode: "fluffy-goose-56",
    activityName: "LED Planck",
    whenLabel: "yesterday",
    classId: "7b-physics-a-2026",
  },
];

export const MOCK_ACTIVITY_CONFIGS: Record<string, MockActivityConfig> = {
  boldkast: {
    id: "boldkast",
    classId: "7b-physics-a-2026",
    name: "Boldkast",
    defaultTeachingGoal:
      "I want students to find that horizontal and vertical motion are independent, and that 45° gives the longest range.",
    pairedWorkbench: "boldkast-simulator-v1",
    language: "da",
    difficulty: "standard",
    helperText:
      "The tutor will use this to prioritise its questions without revealing the concepts.",
  },
  "led-planck": {
    id: "led-planck",
    classId: "7b-physics-a-2026",
    name: "LED Planck",
    defaultTeachingGoal:
      "I want students to estimate Planck's constant by varying LED colours and noticing the threshold voltage trend.",
    pairedWorkbench: null,
    language: "da",
    difficulty: "guided",
    helperText:
      "The tutor will guide step-by-step through the procedure without giving away the relationship.",
  },
};

export const MOCK_SESSION_REPORTS: Record<string, MockSessionReport> = {
  "bold-kazoo-87": {
    classId: "7b-physics-a-2026",
    groupCode: "bold-kazoo-87",
    activityName: "Boldkast",
    startedAtLabel: "2026-05-25 14:12",
    durationMinutes: 22,
    messageCount: 34,
    simRunCount: 8,
    highlights: [
      "Launched sim 8 times (angles 20°–75°)",
      "Discovered max range at ~45° (turn 14)",
      "Asked 3 off-topic questions (redirected)",
    ],
    checklistComplete: [
      "Identify launch angle for max range",
      "Recognise the symmetric range curve",
      "Predict the effect of doubling launch speed",
    ],
    checklistIncomplete: ["Explain why vx is independent of vy"],
    conversation: [
      {
        timestamp: "14:12",
        role: "student",
        content: "hvad sker der hvis vi øger vinklen til 80°?",
      },
      {
        timestamp: "14:13",
        role: "tutor",
        content:
          "Godt spørgsmål — hvad tror du sker med rækkevidden hvis du gør det? Prøv at gætte først, og kør så simuleringen.",
      },
      {
        timestamp: "14:14",
        role: "student",
        content: "jeg tror den bliver længere",
      },
      {
        timestamp: "14:15",
        role: "tutor",
        content:
          "Prøv det og se hvad der faktisk sker. Hvilken vinkel mellem 0° og 90° tror du giver længst rækkevidde?",
      },
    ],
  },
};

export const MOCK_ANALYTICS_QUESTION =
  "What did students struggle with most this week?";

export const MOCK_ANALYTICS_ANSWER = [
  "Across 6 sessions (Boldkast), the most common sticking point was the independence of vx and vy (4 of 6 groups did not complete checklist step 3).",
  "Two groups asked multiple off-topic questions in the first 5 minutes, suggesting the activity introduction may need more scaffolding.",
].join(" ");

export const MOCK_ANALYTICS_SUGGESTIONS = [
  "Which group made the most progress?",
  "What concepts came up most often?",
  "How long did groups spend on the simulator?",
];

/** Class chosen by the dashboard class-switcher when no other choice is made. */
export const MOCK_DEFAULT_CLASS_ID = MOCK_CLASSES[0]!.id;

/** Look up a class by id (used by [id] routes). */
export function getMockClass(id: string): MockClass | undefined {
  return MOCK_CLASSES.find((c) => c.id === id);
}

/** Look up an activity config by id (used by /teacher/activities/[id]). */
export function getMockActivityConfig(id: string): MockActivityConfig | undefined {
  return MOCK_ACTIVITY_CONFIGS[id];
}

/** Look up a session report by group code (used by /teacher/reports/groups/[groupId]). */
export function getMockSessionReport(groupCode: string): MockSessionReport | undefined {
  return MOCK_SESSION_REPORTS[groupCode];
}
