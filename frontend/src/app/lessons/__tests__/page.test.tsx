import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LessonsPage from "@/app/lessons/page";
import type { Skill } from "@/types/skill";

// Mock anon-group auth — default to "joined" so the page fires the
// fetch. Individual tests can override via vi.mocked(...).mockReturnValue.
vi.mock("@/contexts/AnonymousGroupAuthProvider", () => ({
  useAnonymousGroupAuth: () => ({
    status: "joined",
    user: { uid: "anon-u", email: "", displayName: null, photoURL: null },
    token: "fake-token",
    expiresAt: Date.now() + 3600_000,
    skillIds: [],
    error: null,
    join: vi.fn(),
    markExpired: vi.fn(),
    clearStoredToken: vi.fn(),
  }),
}));

// Tests assume non-anon-mode by default so the auth-gate redirect doesn't
// fire; override per-test via isAnonymousGroupAuthMode mock.
vi.mock("@/lib/anonymousGroupAuth", () => ({
  isAnonymousGroupAuthMode: vi.fn(() => false),
  readStoredGroupSession: vi.fn(() => null),
}));

const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(),
}));
import { fetchWithAuth } from "@/lib/apiClient";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "demo",
    description: "A demo skill.",
    instructions: "",
    skillMetadata: {
      author: "aipla",
      version: "1.0",
      model: "gemini-2.5-flash",
      thinkingModel: null,
      tools: [],
      toolConfigs: {},
      subSkills: [],
    },
    references: {},
    assets: {},
    skillId: "skill-1",
    slug: "demo",
    displayName: "Demo skill",
    avatar: "",
    ownerEmail: "platform@aipla.dev",
    ownerId: "aipla-platform",
    accessControl: { type: "public" },
    protocols: {
      mcp: { enabled: false },
      a2a: { enabled: false },
      agui: { enabled: false },
      a2ui: { enabled: false },
      mcpApps: { enabled: false },
    },
    initialMessage: "",
    tags: [],
    featured: false,
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.mocked(fetchWithAuth).mockReset();
  routerReplace.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/lessons — student lesson picker", () => {
  it("renders cards for each accessible skill, alphabetised", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      jsonResponse([
        makeSkill({ skillId: "b", slug: "beta", displayName: "Beta Lesson" }),
        makeSkill({ skillId: "a", slug: "alpha", displayName: "Alpha Lesson" }),
      ]),
    );
    render(<LessonsPage />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Alpha Lesson" })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Beta Lesson" })).toBeInTheDocument();

    // Each card links to /chat/@<owner>/<slug>
    const links = screen.getAllByRole("link");
    expect(links.some((a) => a.getAttribute("href") === "/chat/@aipla-platform/alpha")).toBe(true);
    expect(links.some((a) => a.getAttribute("href") === "/chat/@aipla-platform/beta")).toBe(true);
  });

  it("falls back to skill.name when displayName is empty", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      jsonResponse([
        makeSkill({ skillId: "x", slug: "no-display", displayName: "", name: "rawname" }),
      ]),
    );
    render(<LessonsPage />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "rawname" })).toBeInTheDocument();
    });
  });

  it("renders the empty state when zero skills are accessible", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(jsonResponse([]));
    render(<LessonsPage />);
    await waitFor(() => {
      expect(screen.getByText(/ingen lektioner tilgængelige/i)).toBeInTheDocument();
    });
    // Bilingual — English fallback also visible.
    expect(screen.getByText(/no lessons available yet/i)).toBeInTheDocument();
  });

  it("renders the error banner when fetch rejects, with retry", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchWithAuth)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(
        jsonResponse([makeSkill({ displayName: "After retry" })]),
      );
    render(<LessonsPage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/boom/);
    });

    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "After retry" })).toBeInTheDocument();
    });
  });

  it("renders an error banner on non-2xx response", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(jsonResponse({}, 500));
    render(<LessonsPage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/HTTP 500/);
    });
  });

  it("redirects to /group when anon-mode and not joined yet", async () => {
    const anonAuth = await import("@/lib/anonymousGroupAuth");
    vi.mocked(anonAuth.isAnonymousGroupAuthMode).mockReturnValue(true);

    const groupAuthProvider = await import("@/contexts/AnonymousGroupAuthProvider");
    (groupAuthProvider as { useAnonymousGroupAuth: () => unknown }).useAnonymousGroupAuth = () => ({
      status: "idle",
      user: null,
      token: null,
      expiresAt: null,
      skillIds: [],
      error: null,
      join: vi.fn(),
      markExpired: vi.fn(),
      clearStoredToken: vi.fn(),
    });

    render(<LessonsPage />);
    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith("/group");
    });
  });
});
