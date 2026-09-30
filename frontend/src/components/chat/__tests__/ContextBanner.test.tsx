import { render as rtlRender, screen, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { LocaleProvider } from "@/i18n";
import { describe, expect, it } from "vitest";
import { ContextBanner } from "../ContextBanner";

// 1.1.108: these assertions are about behaviour, written against the English
// labels — render under an English activity. The Danish default is covered by
// the component's own `da` assertions / i18n tests.
const EnglishActivity = ({ children }: { children: ReactNode }) => (
  <LocaleProvider locale="en">{children}</LocaleProvider>
);
const render = (ui: ReactElement, options?: RenderOptions) =>
  rtlRender(ui, { wrapper: EnglishActivity, ...options });


describe("ContextBanner", () => {
  it("renders folder name and document count", () => {
    render(
      <ContextBanner context={{ folderName: "Q1 Financial Review", docCount: 14 }} />,
    );
    expect(screen.getByText(/analyzing/i)).toBeInTheDocument();
    // The count and folder are bold again (1.1.108 t.rich) — their own nodes.
    expect(screen.getByText("14").tagName).toBe("STRONG");
    expect(screen.getByText("Q1 Financial Review").tagName).toBe("STRONG");
  });

  it("uses singular 'document' for count of 1", () => {
    render(<ContextBanner context={{ folderName: "Budget", docCount: 1 }} />);
    expect(screen.getByText(/1/)).toBeInTheDocument();
    expect(screen.getByText(/document\b/)).toBeInTheDocument();
    expect(screen.queryByText(/documents/)).toBeNull();
  });

  it("renders nothing when context is null", () => {
    const { container } = render(<ContextBanner context={null} />);
    expect(container.firstChild).toBeNull();
  });
});
