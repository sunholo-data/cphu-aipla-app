import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AudioRecorder,
  SegmentedRecorder,
  encodeWav,
  isAudioCaptureSupported,
  CAPTURE_RATE,
} from "../audioCapture";

// ── encodeWav: the core correctness — STT only works if the WAV header is right.
describe("encodeWav", () => {
  function pcm(samples: number[]): ArrayBuffer {
    return new Int16Array(samples).buffer;
  }

  it("writes a valid RIFF/WAVE header with the given mono 16-bit rate", async () => {
    const blob = encodeWav([pcm([0, 1, -1, 32767, -32768])], 16000);
    expect(blob.type).toBe("audio/wav");
    const view = new DataView(await blob.arrayBuffer());
    const str = (off: number, n: number) =>
      String.fromCharCode(...new Uint8Array(view.buffer, off, n));
    expect(str(0, 4)).toBe("RIFF");
    expect(str(8, 4)).toBe("WAVE");
    expect(str(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits/sample
    expect(str(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(10); // 5 samples * 2 bytes
  });

  it("concatenates multiple chunks in order", async () => {
    const blob = encodeWav([pcm([1, 2]), pcm([3, 4])], 16000);
    const buf = await blob.arrayBuffer();
    expect(buf.byteLength).toBe(44 + 8);
    const data = new Int16Array(buf, 44, 4);
    expect(Array.from(data)).toEqual([1, 2, 3, 4]);
  });
});

// ── Fake audio environment so the worklet-based recorders are unit-testable
//    under jsdom (which has no real AudioContext/AudioWorklet).
let lastNode: FakeWorkletNode | null = null;

class FakePort {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage = vi.fn();
}
class FakeWorkletNode {
  port = new FakePort();
  connect = vi.fn();
  disconnect = vi.fn();
  constructor() {
    lastNode = this;
  }
  /** test helper: simulate the worklet emitting a 16-bit PCM chunk */
  emit(samples = 160) {
    this.port.onmessage?.({ data: { type: "pcm-chunk", pcmData: new Int16Array(samples).buffer } });
  }
}
class FakeAnalyser {
  fftSize = 256;
  frequencyBinCount = 128;
  getByteTimeDomainData = (b: Uint8Array) => b.fill(128);
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeAudioContext {
  state = "running";
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
  createMediaStreamSource = () => ({ connect: vi.fn() });
  createAnalyser = () => new FakeAnalyser();
}

function deps() {
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  return {
    stopTrack,
    getUserMedia,
    opts: {
      getUserMedia,
      createAudioContext: () => new FakeAudioContext() as unknown as AudioContext,
      now: (() => {
        let t = 1000;
        return () => (t += 500);
      })(),
    },
  };
}

beforeEach(() => {
  lastNode = null;
  (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeWorkletNode;
});
afterEach(() => vi.clearAllMocks());

describe("isAudioCaptureSupported", () => {
  it("is false without getUserMedia", () => {
    const md = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    expect(isAudioCaptureSupported()).toBe(false);
    Object.defineProperty(navigator, "mediaDevices", { value: md, configurable: true });
  });
});

describe("AudioRecorder", () => {
  it("captures PCM and returns a 16 kHz WAV blob, releasing the mic", async () => {
    const { opts, stopTrack, getUserMedia } = deps();
    const rec = new AudioRecorder(opts);
    await rec.start();
    expect(rec.recording).toBe(true);
    // Asks for a clean speech-tuned stream (not a sample-rate constraint).
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    lastNode!.emit(320); // ~one chunk of PCM

    const result = await rec.stop();
    expect(result.mimeType).toBe("audio/wav");
    const view = new DataView(await result.blob.arrayBuffer());
    expect(view.getUint32(24, true)).toBe(CAPTURE_RATE); // 16 kHz in the header
    expect(result.blob.size).toBeGreaterThan(44); // header + the emitted samples
    expect(result.durationMs).toBeGreaterThan(0);
    expect(rec.recording).toBe(false);
    expect(stopTrack).toHaveBeenCalled();
  });

  it("stop() throws when not recording", async () => {
    const { opts } = deps();
    await expect(new AudioRecorder(opts).stop()).rejects.toThrow(/not recording/);
  });

  it("start() is idempotent (one mic stream)", async () => {
    const { opts, getUserMedia } = deps();
    const rec = new AudioRecorder(opts);
    await rec.start();
    await rec.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe("SegmentedRecorder", () => {
  afterEach(() => vi.useRealTimers());

  it("emits a WAV segment per rotation and flushes the final on stop", async () => {
    vi.useFakeTimers();
    const segs: { seq: number; type: string }[] = [];
    const { opts } = deps();
    const seg = new SegmentedRecorder((r, i) => segs.push({ seq: i, type: r.mimeType }), 1000, opts);
    await seg.start();

    lastNode!.emit(160);
    await vi.advanceTimersByTimeAsync(1000); // rotation -> seg 0
    lastNode!.emit(160);
    await vi.advanceTimersByTimeAsync(1000); // rotation -> seg 1
    lastNode!.emit(160);
    await seg.stop(); // flush final -> seg 2

    expect(segs.map((s) => s.seq)).toEqual([0, 1, 2]);
    expect(segs.every((s) => s.type === "audio/wav")).toBe(true);
  });

  it("cancel() stops without emitting a flush segment", async () => {
    vi.useFakeTimers();
    const segs: number[] = [];
    const { opts } = deps();
    const seg = new SegmentedRecorder((_r, i) => segs.push(i), 60_000, opts);
    await seg.start();
    seg.cancel();
    expect(segs).toEqual([]);
    expect(seg.recording).toBe(false);
  });
});
