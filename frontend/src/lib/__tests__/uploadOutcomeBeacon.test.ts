import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localMode", () => ({ isLocalMode: () => false }));
vi.mock("@/lib/staleDeployReload", () => ({ clientBuildId: () => "b-test" }));

import {
  base64Kb,
  buildUploadOutcome,
  mimeFamily,
  reportUploadOutcome,
  resetUploadBeaconForTests,
} from "@/lib/uploadOutcomeBeacon";

const fetchMock = vi.fn();

beforeEach(() => {
  resetUploadBeaconForTests();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("upload-outcome beacon", () => {
  it("maps a MIME type to its family only", () => {
    expect(mimeFamily("image/jpeg")).toBe("jpeg");
    expect(mimeFamily("image/HEIC")).toBe("heic");
    expect(mimeFamily("")).toBe("empty");
    expect(mimeFamily("application/pdf")).toBe("other");
  });

  it("estimates decoded size from base64 length", () => {
    expect(base64Kb("A".repeat(4 * 1024 * 100 / 3))).toBe(100);
  });

  it("carries no file name or identity, only closed fields", () => {
    const body = buildUploadOutcome({
      outcome: "blocked_person",
      where: "solution",
      file: { type: "image/jpeg", size: 3 * 1024 * 1024 },
      screen: "blocked",
    });
    expect(Object.keys(body).sort()).toEqual(
      ["buildId", "encodedKb", "encoding", "kind", "mime", "outcome", "pointer", "screen", "sizeKb", "where"].sort(),
    );
    expect(body).toMatchObject({ kind: "upload", mime: "jpeg", sizeKb: 3072, buildId: "b-test" });
  });

  it("posts to the client-errors endpoint and stops after a non-2xx", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    reportUploadOutcome({ outcome: "staged", where: "chat", file: { type: "image/png", size: 1 } });
    await Promise.resolve();
    await Promise.resolve();
    reportUploadOutcome({ outcome: "staged", where: "chat", file: { type: "image/png", size: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/proxy/api/client-errors");
  });

  it("never throws, even if fetch does", () => {
    fetchMock.mockImplementation(() => {
      throw new Error("no network");
    });
    expect(() =>
      reportUploadOutcome({ outcome: "not_image", where: "chat", file: { type: "", size: 0 } }),
    ).not.toThrow();
  });
});
