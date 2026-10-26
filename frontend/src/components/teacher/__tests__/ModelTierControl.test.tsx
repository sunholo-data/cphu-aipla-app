/**
 * ModelTierControl — the researcher-only smart-model opt-in (1.1.142 M3).
 */
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";

const mockIsResearcher = vi.fn<() => boolean>(() => true);
vi.mock("@/hooks/useIsResearcher", () => ({ useIsResearcher: () => mockIsResearcher() }));

const mockSet = vi.fn();
vi.mock("@/lib/teacherApi", () => ({
  setActivityModelTier: (...args: unknown[]) => mockSet(...args),
}));

import { ModelTierControl } from "../ModelTierControl";

function render(ui: ReactElement) {
  return rtlRender(<LocaleProvider locale="en">{ui}</LocaleProvider>);
}

afterEach(() => {
  mockSet.mockReset();
  mockIsResearcher.mockReturnValue(true);
});

describe("ModelTierControl", () => {
  it("renders nothing for a teacher without the researcher claim", () => {
    mockIsResearcher.mockReturnValue(false);
    const { container } = render(<ModelTierControl activityId="act-1" initialTier="default" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("saves the opt-in through its own route", async () => {
    mockSet.mockResolvedValue({ modelTier: "smart" });
    render(<ModelTierControl activityId="act-1" initialTier="default" />);

    const select = screen.getByRole("combobox", { name: /The tutor answers with/ });
    expect(select).toHaveValue("default");
    fireEvent.change(select, { target: { value: "smart" } });

    await waitFor(() => expect(mockSet).toHaveBeenCalledWith("act-1", "smart"));
    await waitFor(() => expect(select).toHaveValue("smart"));
  });

  it("reverts and says so when the save fails", async () => {
    mockSet.mockRejectedValue(new Error("403"));
    render(<ModelTierControl activityId="act-1" initialTier="smart" />);

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "default" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    expect(select).toHaveValue("smart");
  });
});
