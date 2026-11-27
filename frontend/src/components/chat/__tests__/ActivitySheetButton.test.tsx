import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 1.1.165 — the group's own sheet, from the chat header.
const getMyActivitySheet = vi.fn();
const downloadMyActivitySheetWord = vi.fn();
vi.mock("@/lib/activitySheetApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/activitySheetApi")>()),
  getMyActivitySheet: (...a: unknown[]) => getMyActivitySheet(...a),
  downloadMyActivitySheetWord: (...a: unknown[]) => downloadMyActivitySheetWord(...a),
}));
const triggerDownload = vi.fn();
vi.mock("@/lib/download", async (orig) => ({
  ...(await orig<typeof import("@/lib/download")>()),
  triggerDownload: (...a: unknown[]) => triggerDownload(...a),
}));

import { ActivitySheetButton } from "@/components/chat/ActivitySheetButton";
import { SheetWordUnavailableError } from "@/lib/activitySheetApi";
import { LocaleProvider } from "@/i18n";

const SHEET = {
  title: "Boldkast",
  language: "da" as const,
  sheets: [{ code: "brave-thicket-77", markdown: "# Boldkast\n\n**Gruppe:** brave-thicket-77\n\n## Sådan gør I\n\n- ☐ Åbn simulationen\n" }],
};

const renderDa = () =>
  render(
    <LocaleProvider locale="da">
      <ActivitySheetButton activityId="act-1" />
    </LocaleProvider>,
  );

beforeEach(() => {
  getMyActivitySheet.mockReset();
  downloadMyActivitySheetWord.mockReset();
  triggerDownload.mockReset();
});

describe("ActivitySheetButton", () => {
  it("loads nothing until opened, then shows the group's own sheet", async () => {
    getMyActivitySheet.mockResolvedValue(SHEET);
    renderDa();
    expect(getMyActivitySheet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("activity-sheet-open"));
    await screen.findByTestId("activity-sheet-brave-thicket-77");
    expect(getMyActivitySheet).toHaveBeenCalledWith("act-1");
    expect(screen.getByText("Åbn simulationen", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Boldkast" })).toBeInTheDocument();
  });

  it("downloads the Word file under the activity's name", async () => {
    getMyActivitySheet.mockResolvedValue(SHEET);
    const blob = new Blob(["PK"]);
    downloadMyActivitySheetWord.mockResolvedValue(blob);
    renderDa();
    fireEvent.click(screen.getByTestId("activity-sheet-open"));
    fireEvent.click(await screen.findByRole("button", { name: /Hent \(Word\)/ }));
    await waitFor(() => expect(triggerDownload).toHaveBeenCalledWith(blob, "aktivitetsark-boldkast.docx"));
  });

  it("says Word is unavailable and leaves Print working", async () => {
    getMyActivitySheet.mockResolvedValue(SHEET);
    downloadMyActivitySheetWord.mockRejectedValue(new SheetWordUnavailableError());
    renderDa();
    fireEvent.click(screen.getByTestId("activity-sheet-open"));
    fireEvent.click(await screen.findByRole("button", { name: /Hent \(Word\)/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Udskriv virker stadig");
    expect(screen.getByRole("button", { name: /Udskriv/ })).toBeEnabled();
  });

  it("offers a retry when the sheet cannot be loaded", async () => {
    getMyActivitySheet.mockRejectedValueOnce(new Error("500")).mockResolvedValueOnce(SHEET);
    renderDa();
    fireEvent.click(screen.getByTestId("activity-sheet-open"));
    fireEvent.click(await screen.findByRole("button", { name: "Prøv igen" }));
    await screen.findByTestId("activity-sheet-brave-thicket-77");
  });
});
