import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingRow } from "@/components/teacher/ui/SettingRow";

describe("SettingRow", () => {
  it("associates the label with the control via htmlFor", () => {
    render(
      <SettingRow label="Language" htmlFor="lang">
        <select id="lang">
          <option>Dansk</option>
        </select>
      </SettingRow>,
    );
    // getByLabelText only resolves if the <label for> association is correct.
    expect(screen.getByLabelText("Language")).toBe(screen.getByRole("combobox"));
  });

  it("renders help text alongside the label", () => {
    render(
      <SettingRow label="L" help="some help">
        <input aria-label="control" />
      </SettingRow>,
    );
    expect(screen.getByText("some help")).toBeInTheDocument();
  });
});
