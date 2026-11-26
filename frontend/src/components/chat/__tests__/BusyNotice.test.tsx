import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clientErrorReporting", () => ({ reportClientError: vi.fn() }));

import { LocaleProvider } from "@/i18n";
import { reportBusy } from "@/lib/busySignal";
import { BUSY_NOTICE_MS, BusyNotice } from "../BusyNotice";

const at = new Date(2026, 10, 25, 10, 4, 0);

describe("BusyNotice (2026-11-26)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at);
  });
  afterEach(() => vi.useRealTimers());

  it("says AIPLA is busy, to wait, and gives the time to tell the teacher (Danish)", () => {
    render(
      <LocaleProvider locale="da">
        <BusyNotice locale="da" />
      </LocaleProvider>,
    );
    expect(screen.queryByTestId("busy-notice")).not.toBeInTheDocument();
    act(() => reportBusy("request"));
    const notice = screen.getByTestId("busy-notice");
    expect(notice).toHaveTextContent("AIPLA har travlt lige nu");
    expect(notice).toHaveTextContent("Vent et øjeblik");
    expect(notice).toHaveTextContent("10.04");
    expect(notice).toHaveAttribute("role", "status");
  });

  it("English, closes on Close, and goes by itself after two minutes", () => {
    render(
      <LocaleProvider locale="en">
        <BusyNotice locale="en" />
      </LocaleProvider>,
    );
    act(() => reportBusy("request"));
    expect(screen.getByTestId("busy-notice")).toHaveTextContent("mention the time: 10:04");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("busy-notice")).not.toBeInTheDocument();
    act(() => reportBusy("request"));
    act(() => {
      vi.advanceTimersByTime(BUSY_NOTICE_MS);
    });
    expect(screen.queryByTestId("busy-notice")).not.toBeInTheDocument();
  });

  it("stays hidden while the chat's own banner already says busy", () => {
    render(
      <LocaleProvider locale="en">
        <BusyNotice locale="en" hidden />
      </LocaleProvider>,
    );
    act(() => reportBusy("chat"));
    expect(screen.queryByTestId("busy-notice")).not.toBeInTheDocument();
  });
});
