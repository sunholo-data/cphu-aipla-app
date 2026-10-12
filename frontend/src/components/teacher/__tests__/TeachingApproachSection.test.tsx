import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listFidelityRuns, listRubricReviews, postRubricReview, type FidelityPayload } from "@/lib/teacherApi";
import { citationsByTurn } from "../FidelityConstructDetail";

vi.mock("@/lib/teacherApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/teacherApi")>()),
  listFidelityRuns: vi.fn(),
  listRubricReviews: vi.fn(),
  postRubricReview: vi.fn(),
}));

import { TeachingApproachSection } from "../TeachingApproachSection";
import { LocaleProvider } from "@/i18n";

// 1.1.108 M2 — these tests assert the English copy; the teacher UI defaults to
// Danish (the teacher's own DA | EN choice), so render inside an English locale.
function EnglishLocale({ children }: { children: React.ReactNode }) {
  return <LocaleProvider locale="en">{children}</LocaleProvider>;
}
const render = ((ui: React.ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: EnglishLocale, ...options })) as typeof rtlRender;


const teacherPayload: FidelityPayload = {
  frameworkId: "esru",
  frameworkLabel: "Question-and-use cycle (ESRU)",
  abstained: false,
  abstainReason: "",
  summary: "The tutor asked open questions and revoiced the group's claim, then used the simulation once.",
  drift: ["The use phase came only after the sim run."],
  spokenIncluded: true,
  promptVersion: "fidelity-r1",
};

describe("TeachingApproachSection (1.1.107 M5)", () => {
  it("renders nothing when there is no read", () => {
    const { container } = render(<TeachingApproachSection fidelity={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a teacher the prose, the drift and the approach link — no bands", () => {
    render(<TeachingApproachSection fidelity={teacherPayload} />);
    expect(screen.getByRole("heading", { name: /Teaching approach/ })).toBeInTheDocument();
    expect(screen.getByText(/asked open questions/)).toBeInTheDocument();
    expect(screen.getByText("The use phase came only after the sim run.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Read about this approach/ })).toHaveAttribute("href", "/project/tutors/esru");
    expect(screen.getByText(/recorded discussion/)).toBeInTheDocument();
    expect(screen.queryByText(/Construct detail/)).not.toBeInTheDocument();
  });

  it("says not assessed, with the reason, when the judge abstained", () => {
    render(
      <TeachingApproachSection
        fidelity={{ ...teacherPayload, abstained: true, abstainReason: "too little dialogue to assess (2 tutor turns; need 3)" }}
      />,
    );
    expect(screen.getByText(/Not assessed — too little dialogue/)).toBeInTheDocument();
    expect(screen.queryByText(/asked open questions/)).not.toBeInTheDocument();
  });

  it("renders the construct table only when the payload carries it (researcher)", () => {
    render(<TeachingApproachSection fidelity={researcherPayload} />);
    expect(screen.getByText(/Construct detail/)).toBeInTheDocument();
    expect(screen.getByText("data")).toBeInTheDocument();
    expect(screen.getAllByText("partial").length).toBeGreaterThan(0);
    expect(screen.getByText(/4 tutor \/ 3 student turns/)).toBeInTheDocument();
  });
});

// ── 1.1.148: show the working ────────────────────────────────────────────────

const researcherPayload: FidelityPayload = {
  ...teacherPayload,
  frameworkId: "toulmin",
  frameworkLabel: "Toulmin",
  promptVersion: "fidelity-r3",
  overallBand: "partial",
  model: "gemini-x",
  runId: "s-1__fidelity:toulmin__fidelity-r3_fwyaml",
  rubricVersion: "fidelity-r3+fwyaml",
  criteriaVersion: "yaml",
  currentCriteriaVersion: "yaml",
  idScheme: "turn_index",
  basedOnMessageCount: 40,
  sessionMessageCount: 44,
  evidenceSummary: { units: 7, tutor: 4, student: 3, idScheme: "turn_index" },
  criteria: {
    data: {
      name: "data",
      summary: "The tutor asks for the grounds a claim rests on.",
      moves: [
        { id: "data.1", text: "Asks what the claim is based on." },
        { id: "data.2", text: "Points at a measurement." },
      ],
      avoid: ["Supplies the data itself."],
      evaluationHint: "Did the tutor make the group produce grounds?",
    },
  },
  constructs: {
    data: {
      band: "partial",
      score: 1,
      rationale: "Asked once for measurements.",
      moves: ["data.2"],
      evidence: [
        {
          turn: 98,
          transcriptTurn: 98,
          role: "tutor",
          quote: "Det er en skarp observation",
          verified: true,
          snippet: "Det er en skarp observation — ud fra dette forsøg…",
        },
        { turn: 106, transcriptTurn: 106, role: "tutor", quote: "noget der ikke blev sagt", verified: false },
      ],
      rejectedEvidence: [{ turn: 43, reason: "not a turn of the scored dialogue" }],
    },
    warrant: { band: "strong", score: 2, rationale: "Bridged data to claim.", moves: [], evidence: [] },
  },
};

function openDetail() {
  fireEvent.click(screen.getByText(/Construct detail/));
  const details = screen.getByText(/Construct detail/).closest("details") as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

describe("construct detail — what is judged, and on what (1.1.148)", () => {
  beforeEach(() => {
    vi.mocked(listRubricReviews).mockResolvedValue({ runId: researcherPayload.runId!, reviews: [], effective: {} });
  });

  it("says the run judges the TUTOR, and how to read band vs evidence", () => {
    render(<TeachingApproachSection fidelity={researcherPayload} />);
    expect(
      screen.getByText("Judges the tutor's moves against Toulmin. Student turns are context, not scored."),
    ).toBeInTheDocument();
    expect(screen.getByText(/one judgement per construct/)).toBeInTheDocument();
    expect(screen.getByText(/numbered as in the transcript/)).toBeInTheDocument();
    expect(screen.getByText(/Judged on 40 of 44 messages/)).toBeInTheDocument();
  });

  it("shows each cited turn as the transcript's #N with its quote, clickable to the turn", () => {
    const onCite = vi.fn();
    render(<TeachingApproachSection fidelity={researcherPayload} onCiteTurn={onCite} />);
    expect(screen.getByText("Det er en skarp observation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "#98" }));
    expect(onCite).toHaveBeenCalledWith(98);
    expect(screen.getByRole("button", { name: "#106" })).toHaveAttribute("title", "Show turn #106 in the transcript");
  });

  it("marks a quote the server could not find in its turn", () => {
    render(<TeachingApproachSection fidelity={researcherPayload} />);
    expect(screen.getAllByText("quote not found in this turn")).toHaveLength(1);
  });

  it("lists an id outside the judged dialogue apart, never as a link", () => {
    render(<TeachingApproachSection fidelity={researcherPayload} onCiteTurn={vi.fn()} />);
    expect(screen.getByText(/not a turn of the judged dialogue \(not linked\): 43/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "#43" })).not.toBeInTheDocument();
  });

  it("shows the criterion the judge was given, with the cited move marked", () => {
    render(<TeachingApproachSection fidelity={researcherPayload} />);
    expect(screen.getByText("What the judge was asked")).toBeInTheDocument();
    expect(screen.getByText("Points at a measurement.")).toBeInTheDocument();
    expect(screen.getByText("Supplies the data itself.")).toBeInTheDocument();
    expect(screen.getByText("cited")).toBeInTheDocument();
  });

  it("says when an older run's turn numbers were translated", () => {
    render(<TeachingApproachSection fidelity={{ ...researcherPayload, idScheme: "position-translated" }} />);
    expect(screen.getByText(/translated to the transcript's numbers/)).toBeInTheDocument();
  });

  it("posts a correction with the complete payload and shows it beside the AI's read", async () => {
    vi.mocked(postRubricReview).mockResolvedValue({
      runId: researcherPayload.runId!,
      review: {} as never,
      reviews: [
        {
          review_id: "rv1",
          run_id: researcherPayload.runId!,
          construct_key: "data",
          band: "strong",
          evidence: [98],
          reason: "Asked for both bounce heights.",
          reviewer_uid: "r-1",
          reviewer_email: "r@ku.dk",
          supersedes: null,
          created_at: "2026-10-05T12:00:00+00:00",
          judged: { band: "partial" },
        },
      ],
      effective: { data: { band: "strong", source: "review", judgedBand: "partial", reviewId: "rv1" } },
    });
    render(<TeachingApproachSection fidelity={researcherPayload} />);
    openDetail();
    fireEvent.click(screen.getAllByRole("button", { name: /Correct this/ })[0]);
    fireEvent.change(screen.getByLabelText("Band"), { target: { value: "strong" } });
    fireEvent.change(screen.getByLabelText(/Turns it rests on/), { target: { value: "#98" } });
    fireEvent.change(screen.getByLabelText(/Why/), { target: { value: "Asked for both bounce heights." } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() =>
      expect(postRubricReview).toHaveBeenCalledWith(researcherPayload.runId, {
        constructKey: "data",
        band: "strong",
        evidence: [98],
        reason: "Asked for both bounce heights.",
        supersedes: null,
      }),
    );
    expect(await screen.findByText(/Corrected to strong: Asked for both bounce heights/)).toBeInTheDocument();
    expect(screen.getByText("Your correction")).toBeInTheDocument();
    expect(screen.getAllByText("AI's read").length).toBeGreaterThan(0);
  });

  it("refuses a correction without a reason", () => {
    render(<TeachingApproachSection fidelity={researcherPayload} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Correct this/ })[0]);
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
  });

  it("makes several runs of one session visible and comparable", async () => {
    const run = (at: string, band: string, turn: number) => ({
      runId: "x",
      rubricVersion: "fidelity-r2",
      scoredAt: at,
      source: "log" as const,
      overallBand: "partial",
      constructs: {
        data: { band, score: 1, rationale: "", evidence: [{ turn, transcriptTurn: turn }] },
      },
    });
    vi.mocked(listFidelityRuns).mockResolvedValue({
      sessionId: "s-1",
      stored: [],
      emissionsStatus: "ok",
      emissions: [run("2026-10-05T09:47:00Z", "partial", 98), run("2026-10-05T09:46:30Z", "absent", 50), run("2026-10-05T09:46:00Z", "strong", 106)],
    });
    render(<TeachingApproachSection fidelity={researcherPayload} sessionId="s-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Compare every run/ }));
    expect(await screen.findByText("Judged 3 times")).toBeInTheDocument();
    expect(listFidelityRuns).toHaveBeenCalledWith("s-1");
    expect(screen.getByText(/judge disagreeing with itself/)).toBeInTheDocument();
  });

  it("never says 'judged once' when the history could not be read", async () => {
    vi.mocked(listFidelityRuns).mockResolvedValue({
      sessionId: "s-1",
      stored: [],
      emissions: [],
      emissionsStatus: "unreadable",
    });
    render(<TeachingApproachSection fidelity={researcherPayload} sessionId="s-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Compare every run/ }));
    expect(await screen.findByText(/does NOT mean the session was judged only that often/)).toBeInTheDocument();
  });

  it("builds the transcript's cited-by badges from a researcher payload only", () => {
    expect(citationsByTurn(researcherPayload)).toEqual({ 98: ["data"], 106: ["data"] });
    expect(citationsByTurn(teacherPayload)).toEqual({});
  });
});
