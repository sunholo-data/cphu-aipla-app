import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "@/i18n";
import { BuilderHints } from "../BuilderHints";

// 1.1.151 F2c/F9 — the builder's soft hints, in both locales.
describe("BuilderHints", () => {
  it("renders nothing with no hints", () => {
    const { container } = render(<BuilderHints hints={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the table and its duplicate labels, in Danish", () => {
    render(
      <LocaleProvider locale="da">
        <BuilderHints
          hints={[
            { kind: "duplicateColumns", table: "Slip A", labels: ["Forsøg 1"] },
            { kind: "untitledTables", count: 2 },
          ]}
        />
      </LocaleProvider>,
    );
    const box = screen.getByTestId("builder-hints");
    expect(box).toHaveTextContent("Tabellen »Slip A« har flere kolonner med samme navn: Forsøg 1.");
    expect(box).toHaveTextContent("2 tabeller har ingen titel.");
  });

  it("speaks English for an English teacher, and names an untitled table", () => {
    render(
      <LocaleProvider locale="en">
        <BuilderHints hints={[{ kind: "duplicateColumns", table: "", labels: ["Trial 1"] }]} />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("builder-hints")).toHaveTextContent(
      "The table “untitled” has more than one column with the same name: Trial 1.",
    );
  });
});
