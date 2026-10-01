import { describe, expect, it } from "vitest";

import { formatDecimal } from "@/lib/numbers";

describe("formatDecimal", () => {
  it("uses a decimal comma on a Danish surface and a dot otherwise", () => {
    expect(formatDecimal(1.71, "da")).toBe("1,71");
    expect(formatDecimal(1.71, "en")).toBe("1.71");
    expect(formatDecimal(1.71, "bilingual")).toBe("1.71");
  });

  it("trims float noise without forcing decimals", () => {
    expect(formatDecimal(0.1 + 0.2, "en")).toBe("0.3");
    expect(formatDecimal(10, "da")).toBe("10");
    expect(formatDecimal(-0.5, "da")).toBe("-0,5");
  });
});
