import { describe, expect, it } from "vitest";

import { suggestActivityTitle } from "../suggestActivityTitle";

describe("suggestActivityTitle", () => {
  it("takes the first clause, capitalised", () => {
    expect(suggestActivityTitle("energibevarelse på en rutsjebane. Eleverne måler.")).toBe(
      "Energibevarelse på en rutsjebane",
    );
  });

  it("drops a leading 'students should <verb> that'", () => {
    expect(suggestActivityTitle("Eleverne skal forstå, at energien er bevaret i et lukket system")).toBe(
      "Energien er bevaret i et lukket",
    );
    expect(suggestActivityTitle("Students should understand why the period does not depend on mass")).toBe(
      "The period does not depend on",
    );
  });

  it("keeps at most six words", () => {
    expect(suggestActivityTitle("one two three four five six seven eight").split(" ")).toHaveLength(6);
  });

  it("is empty for an empty goal", () => {
    expect(suggestActivityTitle("   ")).toBe("");
  });

  it("falls back to the whole first clause when the lead-in is all there is", () => {
    expect(suggestActivityTitle("Eleverne skal undersøge")).toBe("Eleverne skal undersøge");
  });
});
