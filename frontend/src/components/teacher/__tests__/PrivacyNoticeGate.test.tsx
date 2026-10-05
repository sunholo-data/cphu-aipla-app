import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

const getPrivacyNotice = vi.fn();
const acknowledgePrivacyNotice = vi.fn();
vi.mock("@/lib/privacyNoticeApi", () => ({
  getPrivacyNotice: () => getPrivacyNotice(),
  acknowledgePrivacyNotice: (v: string) => acknowledgePrivacyNotice(v),
}));

import { PrivacyNoticeGate } from "../PrivacyNoticeGate";

describe("PrivacyNoticeGate", () => {
  beforeEach(() => {
    getPrivacyNotice.mockReset();
    acknowledgePrivacyNotice.mockReset();
  });

  it("shows the notice until acknowledged, then records the version it showed", async () => {
    getPrivacyNotice.mockResolvedValue({ version: "v1", acknowledged: false, acknowledgedAt: null });
    acknowledgePrivacyNotice.mockResolvedValue({ version: "v1", acknowledged: true, acknowledgedAt: "t" });
    render(<PrivacyNoticeGate />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/jbruun@ind\.ku\.dk/);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(acknowledgePrivacyNotice).toHaveBeenCalledWith("v1");
  });

  it("renders nothing for a teacher who already acknowledged", async () => {
    getPrivacyNotice.mockResolvedValue({ version: "v1", acknowledged: true, acknowledgedAt: "t" });
    const { container } = render(<PrivacyNoticeGate />);
    await waitFor(() => expect(getPrivacyNotice).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("fails open when the status cannot be read", async () => {
    getPrivacyNotice.mockRejectedValue(new Error("503"));
    const { container } = render(<PrivacyNoticeGate />);
    await waitFor(() => expect(getPrivacyNotice).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("keeps the notice up and says so when saving fails", async () => {
    getPrivacyNotice.mockResolvedValue({ version: "v1", acknowledged: false, acknowledgedAt: null });
    acknowledgePrivacyNotice.mockRejectedValue(new Error("500"));
    render(<PrivacyNoticeGate />);
    fireEvent.click(await screen.findByRole("button"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
