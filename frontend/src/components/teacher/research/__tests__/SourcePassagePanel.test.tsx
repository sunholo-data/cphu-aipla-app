// Checking a construct against the paper it came from (2026-09-29).
//
// The endpoint existed from 1.1.110 with no caller, so "vouched by M" stayed a
// claim a reader had to take on trust — on the one screen whose whole argument
// is that a prompt can be held against its source.
//
// The assertion that matters most is the third: "no passages" and "no corpus"
// must never look alike. The first reads as the paper not supporting the
// construct, which is a far stronger statement than "this environment has no
// literature loaded".

import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/i18n";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as teacherApi from "@/lib/teacherApi";
import { SourcePassagePanel } from "@/components/teacher/research/SourcePassagePanel";

// 1.1.108 — teacher screens follow the person's language, Danish by default.
// These tests assert the English copy, so they render inside an English
// context; the Danish default has its own assertion in teacherResearchLocale.test.tsx.
function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  const wrap = (node: ReactElement) => <LocaleProvider locale="en">{node}</LocaleProvider>;
  const result = rtlRender(wrap(ui), options);
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
}

afterEach(() => vi.restoreAllMocks());

describe("SourcePassagePanel", () => {
  it("shows the passage verbatim, with the paper it came from", async () => {
    vi.spyOn(teacherApi, "searchFrameworkSources").mockResolvedValue({
      configured: true,
      passages: [{ text: "The teacher revoices the student's contribution.", frameworkId: "esru", score: 0.9 }],
      citations: [{ citation: "Ruiz-Primo & Furtak (2007)", vouchedBy: "M" }],
    });
    render(<SourcePassagePanel frameworkId="esru" />);

    await userEvent.type(screen.getByLabelText(/Check this against the paper/), "revoicing");
    await userEvent.click(screen.getByRole("button", { name: /Search the sources/ }));

    // Verbatim on purpose: you cannot check a claim against a summary.
    expect(await screen.findByText("The teacher revoices the student's contribution.")).toBeInTheDocument();
    expect(screen.getByText(/Ruiz-Primo & Furtak \(2007\) — vouched by M/)).toBeInTheDocument();
  });

  it("says when no passage matched, without implying the paper disagrees", async () => {
    vi.spyOn(teacherApi, "searchFrameworkSources").mockResolvedValue({
      configured: true,
      passages: [],
      citations: [],
    });
    render(<SourcePassagePanel frameworkId="esru" />);
    await userEvent.type(screen.getByLabelText(/Check this against the paper/), "nothing");
    await userEvent.click(screen.getByRole("button", { name: /Search the sources/ }));

    const none = await screen.findByTestId("sources-none");
    expect(none).toHaveTextContent(/result about the search, not about whether the paper supports/i);
  });

  it("distinguishes 'no corpus here' from 'no passages'", async () => {
    // ⚠️ The one the backend docstring calls out explicitly: reported rather
    // than silently empty, because the two would otherwise look identical.
    vi.spyOn(teacherApi, "searchFrameworkSources").mockResolvedValue({
      configured: false,
      passages: [],
      citations: [],
    });
    render(<SourcePassagePanel frameworkId="esru" />);
    await userEvent.type(screen.getByLabelText(/Check this against the paper/), "anything");
    await userEvent.click(screen.getByRole("button", { name: /Search the sources/ }));

    expect(await screen.findByTestId("sources-not-configured")).toBeInTheDocument();
    expect(screen.queryByTestId("sources-none")).not.toBeInTheDocument();
  });

  it("does not search on an empty box", async () => {
    const search = vi.spyOn(teacherApi, "searchFrameworkSources");
    render(<SourcePassagePanel frameworkId="esru" />);
    expect(screen.getByRole("button", { name: /Search the sources/ })).toBeDisabled();
    expect(search).not.toHaveBeenCalled();
  });

  it("degrades to a message when the search cannot run", async () => {
    vi.spyOn(teacherApi, "searchFrameworkSources").mockRejectedValue(new Error("500"));
    render(<SourcePassagePanel frameworkId="esru" />);
    await userEvent.type(screen.getByLabelText(/Check this against the paper/), "x");
    await userEvent.click(screen.getByRole("button", { name: /Search the sources/ }));
    await waitFor(() => expect(screen.getByText(/could not run just now/i)).toBeInTheDocument());
  });
});
