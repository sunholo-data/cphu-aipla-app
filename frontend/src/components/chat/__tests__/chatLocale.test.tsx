import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider, type LocaleMode } from "@/i18n";

import { AutoReadToggle } from "../AutoReadToggle";
import { CallTeacherButton } from "../CallTeacherButton";
import { CheckpointCard } from "../CheckpointCard";
import { ChecklistMarkCard } from "../ChecklistMarkCard";
import { GroupCodeBadge } from "../GroupCodeBadge";
import { PinnedWelcome } from "../PinnedWelcome";
import { ResumeWelcomeBanner } from "../ResumeWelcomeBanner";

vi.mock("@/lib/signalApi", () => ({
  getGroupSignal: vi.fn(async () => ({ raised: false })),
  raiseHand: vi.fn(async () => undefined),
  lowerHand: vi.fn(async () => undefined),
}));

// 1.1.108 M0 success metric, for the chat chrome: an English activity renders
// ZERO Danish on the student surface. Text AND the accessible names (aria-label,
// title) — a screen reader in an English activity must not read Danish either.

function StudentChatChrome() {
  return (
    <>
      <PinnedWelcome content="Welcome" skillId="s1" />
      <ResumeWelcomeBanner onDismiss={() => {}} />
      <GroupCodeBadge code="lazy-flute-39" />
      <AutoReadToggle />
      <CallTeacherButton activityTitle="Energy" />
      <ChecklistMarkCard result={{ itemLabel: "Step one", done: true, evidence: "" }} />
      <CheckpointCard result={{ nodeLabel: "Energy", status: "partial", evidence: "" }} />
    </>
  );
}

function renderIn(locale: LocaleMode, ui: ReactNode) {
  return render(<LocaleProvider locale={locale}>{ui}</LocaleProvider>);
}

function visibleAndAccessibleText(container: HTMLElement): string {
  const attrs = [...container.querySelectorAll("[aria-label],[title],[alt]")].flatMap((el) =>
    ["aria-label", "title", "alt"].map((a) => el.getAttribute(a) ?? ""),
  );
  return [container.textContent ?? "", ...attrs].join(" ");
}

describe("student chat chrome follows the activity language", () => {
  it("renders no Danish in an English activity", () => {
    const { container } = renderIn("en", <StudentChatChrome />);
    expect(visibleAndAccessibleText(container)).not.toMatch(/[æøåÆØÅ]/);
    expect(container.textContent).toContain("How to get started");
    expect(container.textContent).toContain("Call the teacher");
  });

  it("renders Danish in a Danish activity — the pre-1.1.108 strings, unchanged", () => {
    const { container } = renderIn("da", <StudentChatChrome />);
    const text = container.textContent ?? "";
    expect(text).toContain("Sådan kommer du i gang");
    expect(text).toContain("Tilkald lærer");
    expect(text).toContain("Markeret som klar: Step one");
    expect(text).toContain("Energy — på vej");
  });
});
