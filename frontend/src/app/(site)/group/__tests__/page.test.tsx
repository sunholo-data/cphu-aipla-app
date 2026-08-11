/**
 * /group page tests (sprint 2.11, M3).
 *
 * Covers:
 *   - render in anonymous-group mode (form visible)
 *   - render in other modes (friendly "not available" message)
 *   - happy join → redirect to /
 *   - error states render typed messages
 *   - button disabled while joining
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth-mode helper so each test can switch modes.
const isAnonymousGroupAuthModeMock = vi.fn();
vi.mock("@/lib/anonymousGroupAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anonymousGroupAuth")>();
  return {
    ...actual,
    isAnonymousGroupAuthMode: () => isAnonymousGroupAuthModeMock(),
  };
});

// Mock Next.js router; capture replace() calls.
const routerReplaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { AnonymousGroupAuthProvider } from "@/contexts/AnonymousGroupAuthProvider";
import { resetEnvironmentCache } from "@/lib/environment";

function wrap(node: ReactNode) {
  return <AnonymousGroupAuthProvider>{node}</AnonymousGroupAuthProvider>;
}

beforeEach(() => {
  isAnonymousGroupAuthModeMock.mockReturnValue(true);
  routerReplaceMock.mockReset();
  fetchMock.mockReset();
  sessionStorage.clear();
});

async function importPage() {
  const mod = await import("@/app/group/page");
  return mod.default;
}

describe("/group page — mode gating", () => {
  it("renders the friendly fallback when NOT in anonymous-group mode", async () => {
    isAnonymousGroupAuthModeMock.mockReturnValue(false);
    const Page = await importPage();
    render(wrap(<Page />));
    expect(screen.getByText(/not available/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/group code/i)).not.toBeInTheDocument();
  });

  it("renders the form when in anonymous-group mode", async () => {
    isAnonymousGroupAuthModeMock.mockReturnValue(true);
    const Page = await importPage();
    render(wrap(<Page />));
    expect(screen.getByLabelText(/group code/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join/i })).toBeInTheDocument();
  });

  // AIPLA v0.1 (Jutland demo) — Danish stx audience. Danish copy must
  // render alongside the English fallback. See M2 in
  // docs/design/aipla/v0.1.0-jutland/jutland-demo-sprint.md.
  it("renders Danish copy alongside English on the group form", async () => {
    isAnonymousGroupAuthModeMock.mockReturnValue(true);
    const Page = await importPage();
    render(wrap(<Page />));
    // Danish header
    expect(screen.getByText(/Tilslut din gruppe/)).toBeInTheDocument();
    // Danish helper text — gives an "what does this code look like" hint
    expect(
      screen.getByText(/Din lærer har givet dig en kort kode/),
    ).toBeInTheDocument();
    // Danish on the button (joined with English by ` / `)
    expect(
      screen.getByRole("button", { name: /Tilslut.*Join/ }),
    ).toBeInTheDocument();
    // Danish footer — copy revised 2026-05-21 to clarify that the code
    // stays valid 30 days (don't scare the student into thinking they
    // burn a code by closing the tab).
    expect(
      screen.getByText(/skal du bare skrive[\s\S]*koden igen/),
    ).toBeInTheDocument();
  });
});

describe("/group page — happy join", () => {
  it("calls join + redirects to /lessons on success", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        token: "t",
        uid: "anon-X-y",
        expires_at: Date.now() / 1000 + 3600,
      }),
    } as Response);
    const Page = await importPage();
    render(wrap(<Page />));

    fireEvent.change(screen.getByLabelText(/group code/i), {
      target: { value: "phys-7k2n" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /join/i }));
    });
    await waitFor(() => {
      // 1.B (2026-05-26) — joined user routes to /lessons (the lesson
      // picker), not a hardcoded chat URL. The picker fetches accessible
      // skills via the same evaluator that gates other endpoints.
      expect(routerReplaceMock).toHaveBeenCalledWith("/lessons");
    });
  });

  it("disables the button while joining", async () => {
    // Resolves never — keeps the provider in 'joining' state.
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const Page = await importPage();
    render(wrap(<Page />));

    fireEvent.change(screen.getByLabelText(/group code/i), {
      target: { value: "PHYS-7K2N" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /join/i }));
    });
    expect(screen.getByRole("button", { name: /joining/i })).toBeDisabled();
  });
});

describe("/group page — typed error rendering", () => {
  async function submitWith(status: number, body: unknown) {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status,
      json: async () => body,
    } as Response);
    const Page = await importPage();
    render(wrap(<Page />));
    fireEvent.change(screen.getByLabelText(/group code/i), {
      target: { value: "X-Y" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /join/i }));
    });
  }

  it("renders unknown_or_revoked message on 401", async () => {
    await submitWith(401, { detail: "group not found" });
    expect(
      await screen.findByText(/code not found, expired, or revoked/i),
    ).toBeInTheDocument();
  });

  it("renders rate-limited message with retry seconds on 429", async () => {
    await submitWith(429, { detail: "rate limit exceeded; retry after 7s" });
    expect(
      await screen.findByText(/try again in 7s/i),
    ).toBeInTheDocument();
  });

  it("renders at-capacity message on 503", async () => {
    await submitWith(503, { detail: "cap exceeded" });
    expect(
      await screen.findByText(/group is at capacity/i),
    ).toBeInTheDocument();
  });

  it("re-enables the Join button after an error (so user can retry)", async () => {
    await submitWith(401, { detail: "unknown" });
    // After error → status returns to 'idle', button no longer disabled
    // for non-empty inputs. Match the AIPLA-localised idle button text
    // ("Tilslut / Join") rather than the inherited anchored /^join$/i.
    expect(
      screen.getByRole("button", { name: /^Tilslut \/ Join$/ }),
    ).not.toBeDisabled();
  });
});

// --- Environment mix-up (2026-08-04) -------------------------------------
// Group codes live in each environment's own Firestore, so a dev code typed
// into test 401s with the same "code not found" a revoked code gives. A
// teacher lost two hours to that. Two mitigations are pinned here: the join
// LINK carries the environment, and the not-found error names the site the
// student is actually on.

describe("/group page — environment mix-up mitigations", () => {
  beforeEach(() => {
    resetEnvironmentCache();
    window.history.replaceState({}, "", "/group");
  });

  it("prefills the code from a join link's ?code=", async () => {
    window.history.replaceState({}, "", "/group?code=Striped-Mouse-49");
    const Page = await importPage();
    render(wrap(<Page />));

    await waitFor(() =>
      // Normalised to lowercase — codes are minted lowercase and the input
      // is CSS-lowercased, so a copied link with odd casing still matches.
      expect(screen.getByLabelText(/group code/i)).toHaveValue(
        "striped-mouse-49",
      ),
    );
  });

  it("leaves the field empty when there is no ?code=", async () => {
    const Page = await importPage();
    render(wrap(<Page />));

    expect(screen.getByLabelText(/group code/i)).toHaveValue("");
  });

  it("names the current site when a code is not found", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/api/environment")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            env: "test",
            projectId: "aipla-test-2026",
            version: "v0.1.5",
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        json: async () => ({ detail: "group not found" }),
      } as Response);
    });

    const Page = await importPage();
    render(wrap(<Page />));
    fireEvent.change(screen.getByLabelText(/group code/i), {
      target: { value: "striped-mouse-49" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /join/i }));
    });

    expect(
      await screen.findByText(/codes only work on the site they were created on/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/you are on TEST/i)).toBeInTheDocument();
  });

  it("omits the site hint when the backend cannot say where we are", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/api/environment")) {
        return Promise.reject(new Error("offline"));
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        json: async () => ({ detail: "group not found" }),
      } as Response);
    });

    const Page = await importPage();
    render(wrap(<Page />));
    fireEvent.change(screen.getByLabelText(/group code/i), {
      target: { value: "striped-mouse-49" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /join/i }));
    });

    // The typed error still shows; the unverifiable half stays quiet.
    expect(
      await screen.findByText(/code not found, expired, or revoked/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/codes only work on the site/i),
    ).not.toBeInTheDocument();
  });
});
