import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActivitySheetView } from "@/components/activity-sheet/ActivitySheetView";
import { LocaleProvider } from "@/i18n";

// 1.1.165 — the in-app sheet looks like the Word file: a header band with the
// seal in the SHEET's language, and the group box as a label | value table.
const MD = [
  "# Boldkast",
  "",
  "| **Gruppe** | **brave-thicket-77** |",
  "|:--|:--|",
  "| **Log ind** | https://aipla.ku.dk/group?code=brave-thicket-77 |",
  "| **Navne** |   |",
  "",
  "## Sådan gør I",
  "",
  "☐ Åbn simulationen",
].join("\n");

describe("ActivitySheetView", () => {
  it("names the sheet in its own language even when the viewer reads English", () => {
    render(
      <LocaleProvider locale="en">
        <ActivitySheetView sheets={[{ code: "brave-thicket-77", markdown: MD }]} language="da" />
      </LocaleProvider>,
    );
    const sheet = screen.getByTestId("activity-sheet-brave-thicket-77");
    expect(within(sheet).getByText("Aktivitetsark")).toBeInTheDocument();
    expect(within(sheet).getByText("Københavns Universitet")).toBeInTheDocument();
    expect(within(sheet).getByRole("img", { name: "Københavns Universitets segl" })).toBeInTheDocument();
  });

  it("renders the group box as one table, every row a label and a value", () => {
    render(<ActivitySheetView sheets={[{ code: "brave-thicket-77", markdown: MD }]} language="da" />);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows.map((r) => r.textContent?.trim())).toEqual([
      "Gruppebrave-thicket-77",
      "Log indhttps://aipla.ku.dk/group?code=brave-thicket-77",
      "Navne",
    ]);
    expect(screen.getByText("☐ Åbn simulationen")).toBeInTheDocument();
  });
});
