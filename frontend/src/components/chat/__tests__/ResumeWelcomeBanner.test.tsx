import { fireEvent, render as rtlRender, screen, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { LocaleProvider } from "@/i18n";
import { describe, expect, it, vi } from "vitest";

import { ResumeWelcomeBanner } from "@/components/chat/ResumeWelcomeBanner";

// 1.1.108: these assertions are about behaviour, written against the English
// labels — render under an English activity. The Danish default is covered by
// the component's own `da` assertions / i18n tests.
const EnglishActivity = ({ children }: { children: ReactNode }) => (
  <LocaleProvider locale="en">{children}</LocaleProvider>
);
const render = (ui: ReactElement, options?: RenderOptions) =>
  rtlRender(ui, { wrapper: EnglishActivity, ...options });


describe("ResumeWelcomeBanner", () => {
  it("renders the resume message", () => {
    render(<ResumeWelcomeBanner onDismiss={() => void 0} />);
    expect(screen.getByText(/continuing from your last session/i)).toBeDefined();
  });

  it("renders Danish text by default (a Danish activity, or no provider)", () => {
    rtlRender(<ResumeWelcomeBanner onDismiss={() => void 0} />);
    expect(screen.getByText(/fortsætter fra din forrige session/i)).toBeDefined();
  });

  it("calls onDismiss when the dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(<ResumeWelcomeBanner onDismiss={onDismiss} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
