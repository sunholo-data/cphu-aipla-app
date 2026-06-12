import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioRecorder, SegmentedRecorder, STT_AUDIO_CONSTRAINTS, pickAudioMimeType } from "../audioCapture";

describe("pickAudioMimeType", () => {
  it("returns the first supported preferred mime", () => {
    const supported = (m: string) => m === "audio/webm";
    expect(pickAudioMimeType(supported)).toBe("audio/webm");
  });

  it("prefers webm/opus when supported", () => {
    expect(pickAudioMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });

  it("returns empty string when nothing is supported", () => {
    expect(pickAudioMimeType(() => false)).toBe("");
  });

  it("treats a throwing isTypeSupported as unsupported", () => {
    expect(
      pickAudioMimeType(() => {
        throw new Error("boom");
      }),
    ).toBe("");
  });
});

// Minimal fake MediaRecorder driving the start/stop lifecycle.
class FakeMediaRecorder {
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType: string;
  started = false;
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "audio/webm";
  }
  start() {
    this.started = true;
  }
  stop() {
    // emit one chunk then fire onstop (sync, like a flushed recorder)
    this.ondataavailable?.({ data: new Blob(["audio-bytes"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function makeRecorder() {
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  let t = 1000;
  const rec = new AudioRecorder({
    getUserMedia,
    MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
    now: () => (t += 500), // each call advances 500ms
    pickMime: () => "audio/webm",
  });
  return { rec, getUserMedia, stopTrack };
}

describe("AudioRecorder", () => {
  it("records then returns a blob + mime + duration, and releases the mic", async () => {
    const { rec, getUserMedia, stopTrack } = makeRecorder();
    await rec.start();
    expect(rec.recording).toBe(true);
    // Requests 48 kHz so the Opus/WebM header lands on a rate Google STT accepts.
    expect(getUserMedia).toHaveBeenCalledWith(STT_AUDIO_CONSTRAINTS);

    const result = await rec.stop();
    expect(result.mimeType).toBe("audio/webm");
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(rec.recording).toBe(false);
    expect(stopTrack).toHaveBeenCalled(); // mic track stopped
  });

  it("stop() throws when not recording", async () => {
    const { rec } = makeRecorder();
    await expect(rec.stop()).rejects.toThrow(/not recording/);
  });

  it("cancel() releases the mic without resolving a blob", async () => {
    const { rec, stopTrack } = makeRecorder();
    await rec.start();
    rec.cancel();
    expect(rec.recording).toBe(false);
    expect(stopTrack).toHaveBeenCalled();
  });

  it("start() is idempotent (no double stream)", async () => {
    const { rec, getUserMedia } = makeRecorder();
    await rec.start();
    await rec.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("falls back to an unconstrained stream when the 48 kHz constraint is rejected", async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new Error("OverconstrainedError"))
      .mockResolvedValueOnce(stream);
    const rec = new AudioRecorder({
      getUserMedia,
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      now: () => 1000,
      pickMime: () => "audio/webm",
    });

    await rec.start();
    expect(rec.recording).toBe(true);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, STT_AUDIO_CONSTRAINTS);
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: true });
  });
});

describe("SegmentedRecorder", () => {
  afterEach(() => vi.useRealTimers());

  function deps() {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    return {
      getUserMedia: vi.fn().mockResolvedValue(stream),
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      now: () => 0,
      pickMime: () => "audio/webm",
    };
  }

  it("emits a segment per rotation and flushes the final on stop", async () => {
    vi.useFakeTimers();
    const seqs: number[] = [];
    const seg = new SegmentedRecorder((_r, i) => seqs.push(i), 1000, deps());
    await seg.start();
    await vi.advanceTimersByTimeAsync(1000); // rotation -> seg 0
    await vi.advanceTimersByTimeAsync(1000); // rotation -> seg 1
    await seg.stop(); // flush final -> seg 2
    expect(seqs).toEqual([0, 1, 2]);
  });

  it("stop() after no rotation still flushes one segment", async () => {
    vi.useFakeTimers();
    const seqs: number[] = [];
    const seg = new SegmentedRecorder((_r, i) => seqs.push(i), 60_000, deps());
    await seg.start();
    await seg.stop();
    expect(seqs).toEqual([0]);
  });

  it("cancel() stops without emitting a flush segment", async () => {
    vi.useFakeTimers();
    const seqs: number[] = [];
    const seg = new SegmentedRecorder((_r, i) => seqs.push(i), 60_000, deps());
    await seg.start();
    seg.cancel();
    expect(seqs).toEqual([]);
    expect(seg.recording).toBe(false);
  });
});
