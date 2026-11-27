import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 1.1.165 — the teacher's sheet page: one page per group, Word and Print.
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "c1", activityId: "act-1" }) }));
const getClassActivitySheets = vi.fn();
const downloadClassActivitySheetWord = vi.fn();
vi.mock("@/lib/activitySheetApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/activitySheetApi")>()),
  getClassActivitySheets: (...a: unknown[]) => getClassActivitySheets(...a),
  downloadClassActivitySheetWord: (...a: unknown[]) => downloadClassActivitySheetWord(...a),
}));
const triggerDownload = vi.fn();
vi.mock("@/lib/download", async (orig) => ({
  ...(await orig<typeof import("@/lib/download")>()),
  triggerDownload: (...a: unknown[]) => triggerDownload(...a),
}));
const printSheets = vi.fn();
vi.mock("@/lib/printSheets", () => ({ printSheets: (...a: unknown[]) => printSheets(...a) }));

import ActivitySheetPage from "@/app/teacher/classes/[id]/sheet/[activityId]/page";
import { SheetWordUnavailableError } from "@/lib/activitySheetApi";
import { LocaleProvider } from "@/i18n";

const SHEETS = {
  title: "Boldkast",
  language: "da" as const,
  sheets: [
    { code: "a-1", markdown: "# Boldkast\n\n**Gruppe:** a-1\n" },
    { code: "b-2", markdown: "# Boldkast\n\n**Gruppe:** b-2\n" },
  ],
};

const renderEn = () =>
  render(
    <LocaleProvider locale="en">
      <ActivitySheetPage />
    </LocaleProvider>,
  );

beforeEach(() => {
  getClassActivitySheets.mockReset();
  downloadClassActivitySheetWord.mockReset();
  triggerDownload.mockReset();
  printSheets.mockReset();
});

describe("ActivitySheetPage", () => {
  it("shows one sheet per group and counts them", async () => {
    getClassActivitySheets.mockResolvedValue(SHEETS);
    renderEn();
    await screen.findByTestId("activity-sheet-a-1");
    expect(screen.getByTestId("activity-sheet-b-2")).toBeInTheDocument();
    expect(getClassActivitySheets).toHaveBeenCalledWith("c1", "act-1");
    expect(screen.getByText(/One sheet per group, 2 in all/)).toBeInTheDocument();
  });

  it("downloads Word and prints the rendered sheets", async () => {
    getClassActivitySheets.mockResolvedValue(SHEETS);
    downloadClassActivitySheetWord.mockResolvedValue(new Blob(["PK"]));
    renderEn();
    fireEvent.click(await screen.findByTestId("sheet-download-word"));
    await waitFor(() =>
      expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), "aktivitetsark-boldkast.docx"),
    );
    fireEvent.click(screen.getByTestId("sheet-print"));
    expect(printSheets).toHaveBeenCalledWith(expect.any(HTMLElement), "Boldkast", "da");
  });

  it("tells the teacher to print when Word is unavailable", async () => {
    getClassActivitySheets.mockResolvedValue(SHEETS);
    downloadClassActivitySheetWord.mockRejectedValue(new SheetWordUnavailableError());
    renderEn();
    fireEvent.click(await screen.findByTestId("sheet-download-word"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Print still works");
  });

  it("offers a retry when the sheets cannot be read", async () => {
    getClassActivitySheets.mockRejectedValueOnce(new Error("500")).mockResolvedValueOnce(SHEETS);
    renderEn();
    fireEvent.click(await screen.findByRole("button", { name: /try again|retry/i }));
    await screen.findByTestId("activity-sheet-a-1");
  });
});
