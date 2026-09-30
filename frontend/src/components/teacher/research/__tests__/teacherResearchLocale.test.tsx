import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";
import { RegisterPicker } from "@/components/teacher/research/RegisterPicker";
import { TutorVariantDialog } from "@/components/teacher/TutorVariantDialog";
import { TrendSparkline } from "@/components/teacher/insights/TrendSparkline";
import type { TutorPayload } from "@/lib/teacherApi";

// 1.1.108 M2, lane D — the researcher/insights chrome follows the person's
// language. Danish is the default (no provider = the site default); under
// English nothing Danish may leak through — text OR attributes.

vi.mock("@/lib/teacherApi", async (orig) => ({ ...(await orig<object>()), createTutorVariant: vi.fn() }));

const DANISH = /[æøåÆØÅ]/;

const parent = {
  id: "sofie",
  displayName: "Sofie",
  frameworkId: null,
} as unknown as TutorPayload;

function Panels() {
  return (
    <div>
      <RegisterPicker value="concise" askMoveCount={3} onChange={() => {}} />
      <TutorVariantDialog
        parent={parent}
        frameworks={[
          { id: "esru", name: "ESRU", isPlaceholder: false },
          { id: "tbd", name: "TBD", isPlaceholder: true },
        ] as never}
        onCreated={() => {}}
        onCancel={() => {}}
      />
      <TrendSparkline points={[]} />
    </div>
  );
}

function allVisibleText(container: HTMLElement): string {
  const attrs = [...container.querySelectorAll("*")].flatMap((el) =>
    ["aria-label", "title", "placeholder", "alt"].map((a) => el.getAttribute(a) ?? ""),
  );
  return `${container.textContent ?? ""} ${attrs.join(" ")}`;
}

describe("teacher research chrome — locale (1.1.108 M2)", () => {
  it("speaks Danish by default", () => {
    render(<Panels />);
    expect(screen.getByText("Stemme")).toBeInTheDocument();
    expect(screen.getByText("Ny variant af Sofie")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Opret variant" })).toBeInTheDocument();
    expect(screen.getByText("Ingen trenddata i denne periode.")).toBeInTheDocument();
  });

  it("carries no Danish under English — text or attributes", () => {
    const ui: ReactElement = (
      <LocaleProvider locale="en">
        <Panels />
      </LocaleProvider>
    );
    const { container } = render(ui);
    expect(screen.getByText("New variant of Sofie")).toBeInTheDocument();
    expect(allVisibleText(container)).not.toMatch(DANISH);
  });
});
