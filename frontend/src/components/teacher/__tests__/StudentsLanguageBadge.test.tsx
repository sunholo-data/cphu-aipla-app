import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "@/i18n";
import { StudentsLanguageBadge } from "../StudentsLanguageBadge";

// 1.1.151 F2b — the activity's students' language, in the teacher's own words.
describe("StudentsLanguageBadge", () => {
  it.each([
    ["da", "da", "Elever: dansk"],
    ["da", "en", "Elever: engelsk"],
    ["en", "da", "Students: Danish"],
    ["en", "en", "Students: English"],
  ] as const)("[%s UI] %s activity reads %s", (ui, language, text) => {
    render(
      <LocaleProvider locale={ui}>
        <StudentsLanguageBadge language={language} />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("students-language-badge")).toHaveTextContent(text);
  });
});
