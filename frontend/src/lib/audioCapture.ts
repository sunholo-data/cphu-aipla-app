/**
 * On-device audio capture for voice-in + lesson recording.
 *
 * Captures raw 16-bit PCM at a fixed 16 kHz via an AudioWorklet
 * (`/pcm-capture-worklet.js`) and packages it as a WAV blob, instead of the
 * browser's MediaRecorder (WebM/Opus). MediaRecorder stamps the hardware
 * sample rate (44.1 kHz on macOS) into the Opus header, which Google Cloud
 * STT's WEBM_OPUS decoder rejects ("Opus sample rate (44100) not in supported
 * rates"). The constraint-based fix (`getUserMedia({sampleRate})`) is only an
 * "ideal" hint and Chrome ignores it. The worklet instead downsamples in JS
 * from whatever the hardware gives to a known 16 kHz, so the audio IS
 * LINEAR16 @ 16 kHz — exactly what STT wants, no transcode, no header to
 * misread. (Pattern lifted from the ailang streaming demos.)
 *
 * The same capture exposes a live input level (`getLevel()`) via an
 * AnalyserNode, used to drive a "recording" VFX so the student always sees
 * when the mic is live (Axiom 11 — never an ambiguous always-listening state).
 */

export interface RecordingResult {
  /** WAV (PCM 16-bit, 16 kHz, mono). */
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/** Target capture rate — a Google STT-supported Opus/LINEAR16 rate and the
 *  fallback rate used only if the AudioContext doesn't report one. We capture
 *  at the context's NATIVE rate (no JS resampling — see pcm-capture-worklet.js)
 *  and let Google STT downsample, so this constant is just a safety default. */
export const CAPTURE_RATE = 16000;

const WORKLET_PATH = "/pcm-capture-worklet.js";

export function isAudioCaptureSupported(): boolean {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
  const Ctx =
    typeof window !== "undefined"
      ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  return typeof Ctx !== "undefined";
}

/**
 * Build a WAV (RIFF) blob from accumulated little-endian Int16 PCM chunks.
 * Mono, 16-bit. WAV is self-describing (the header carries the sample rate),
 * so the backend can read the rate without us threading it separately.
 */
export function encodeWav(chunks: ArrayBuffer[], sampleRate: number): Blob {
  let dataLen = 0;
  for (const c of chunks) dataLen += c.byteLength;
  const out = new Uint8Array(44 + dataLen);
  const view = new DataView(out.buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate = rate * channels * bytesPerSample
  view.setUint16(32, 2, true); // block align = channels * bytesPerSample
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataLen, true);
  let off = 44;
  for (const c of chunks) {
    out.set(new Uint8Array(c), off);
    off += c.byteLength;
  }
  return new Blob([out], { type: "audio/wav" });
}

function defaultAudioContext(): AudioContext {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new Ctx();
}

export interface RecorderDeps {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext?: () => AudioContext;
  now?: () => number;
}

/**
 * One mic → PCM worklet session. Holds the AudioContext, mic stream, analyser
 * (for the level VFX) and the running buffer of Int16 PCM chunks. `take()`
 * drains the buffer (used both for one-shot stop and per-segment flush) without
 * tearing down the mic; `close()` releases everything.
 */
class PcmCaptureSession {
  private _ctx: AudioContext | null = null;
  private _stream: MediaStream | null = null;
  private _node: AudioWorkletNode | null = null;
  private _analyser: AnalyserNode | null = null;
  private _levelBuf: Uint8Array<ArrayBuffer> | null = null;
  private _chunks: ArrayBuffer[] = [];
  // The AudioContext's native rate, captured at start() and written into the
  // WAV header so the backend (and STT) know the true rate.
  private _rate = CAPTURE_RATE;
  private readonly _getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly _createCtx: () => AudioContext;

  constructor(deps: RecorderDeps = {}) {
    this._getUserMedia = deps.getUserMedia ?? ((c) => navigator.mediaDevices.getUserMedia(c));
    this._createCtx = deps.createAudioContext ?? defaultAudioContext;
  }

  get active(): boolean {
    return this._node !== null;
  }

  async start(): Promise<void> {
    if (this._node) return;
    const stream = await this._getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this._stream = stream;
    const ctx = this._createCtx();
    this._ctx = ctx;
    this._rate = Math.round(ctx.sampleRate) || CAPTURE_RATE;
    if (ctx.state === "suspended") await ctx.resume();
    await ctx.audioWorklet.addModule(WORKLET_PATH);

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    this._analyser = analyser;
    this._levelBuf = new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser);

    // No processorOptions — the worklet captures at the context's native rate.
    const node = new AudioWorkletNode(ctx, "pcm-capture");
    node.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === "pcm-chunk") this._chunks.push(e.data.pcmData as ArrayBuffer);
    };
    source.connect(node);
    this._node = node;
  }

  /** Drain the buffered PCM as a WAV blob (leaves the mic running). */
  take(): Blob {
    const chunks = this._chunks;
    this._chunks = [];
    return encodeWav(chunks, this._rate);
  }

  /** Live RMS input level 0..1 for a recording VFX. 0 when idle. */
  level(): number {
    if (!this._analyser || !this._levelBuf) return 0;
    this._analyser.getByteTimeDomainData(this._levelBuf);
    let sum = 0;
    for (let i = 0; i < this._levelBuf.length; i++) {
      const v = (this._levelBuf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this._levelBuf.length) * 2.5);
  }

  close(): void {
    try {
      this._node?.port.postMessage({ command: "stop" });
    } catch {
      /* port already closed */
    }
    try {
      this._node?.disconnect();
      this._analyser?.disconnect();
    } catch {
      /* nodes already detached */
    }
    this._stream?.getTracks().forEach((t) => t.stop());
    void this._ctx?.close().catch(() => {});
    this._node = null;
    this._analyser = null;
    this._levelBuf = null;
    this._stream = null;
    this._ctx = null;
    this._chunks = [];
  }
}

/**
 * One-shot recorder (dictation): `start()` then `stop()` -> a single WAV blob.
 * Releases the mic on stop/cancel.
 */
export class AudioRecorder {
  private _session: PcmCaptureSession | null = null;
  private _startedAt = 0;
  private readonly _deps: RecorderDeps;
  private readonly _now: () => number;

  constructor(deps: RecorderDeps = {}) {
    this._deps = deps;
    this._now = deps.now ?? (() => Date.now());
  }

  get recording(): boolean {
    return this._session !== null;
  }

  /** Live input level 0..1 for the VFX (0 when not recording). */
  getLevel(): number {
    return this._session?.level() ?? 0;
  }

  async start(): Promise<void> {
    if (this._session) return;
    const session = new PcmCaptureSession(this._deps);
    await session.start();
    this._session = session;
    this._startedAt = this._now();
  }

  async stop(): Promise<RecordingResult> {
    const session = this._session;
    if (!session) throw new Error("not recording");
    const durationMs = Math.max(0, this._now() - this._startedAt);
    const blob = session.take();
    session.close();
    this._session = null;
    return { blob, mimeType: "audio/wav", durationMs };
  }

  cancel(): void {
    this._session?.close();
    this._session = null;
  }
}

/** Default lesson segment length. Kept under Cloud Speech sync recognize's
 *  ~1-min cap so the backend transcribes each segment without long-running. */
export const SEGMENT_MS = 50_000;

/**
 * Records a long session as a sequence of WAV segments (lesson recording):
 * every ~`segmentMs` it drains the running PCM buffer into a finished WAV,
 * fires `onSegment(result, seq)`, and keeps capturing — no mic restart between
 * segments. `stop()` flushes the final partial segment.
 */
export class SegmentedRecorder {
  private _session: PcmCaptureSession | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _seq = 0;
  private _segStartedAt = 0;
  private readonly _onSegment: (r: RecordingResult, seq: number) => void;
  private readonly _segmentMs: number;
  private readonly _deps: RecorderDeps;
  private readonly _now: () => number;

  constructor(
    onSegment: (r: RecordingResult, seq: number) => void,
    segmentMs: number = SEGMENT_MS,
    deps: RecorderDeps = {},
  ) {
    this._onSegment = onSegment;
    this._segmentMs = segmentMs;
    this._deps = deps;
    this._now = deps.now ?? (() => Date.now());
  }

  get recording(): boolean {
    return this._session !== null;
  }

  /** Live input level 0..1 for the VFX (0 when not recording). */
  getLevel(): number {
    return this._session?.level() ?? 0;
  }

  async start(): Promise<void> {
    if (this._session) return;
    const session = new PcmCaptureSession(this._deps);
    await session.start();
    this._session = session;
    this._seq = 0;
    this._segStartedAt = this._now();
    this._timer = setInterval(() => this._flush(false), this._segmentMs);
  }

  private _flush(final: boolean): void {
    const session = this._session;
    if (!session) return;
    const now = this._now();
    const durationMs = Math.max(0, now - this._segStartedAt);
    this._segStartedAt = now;
    const blob = session.take();
    if (blob.size > 44) this._onSegment({ blob, mimeType: "audio/wav", durationMs }, this._seq++);
    if (final) {
      session.close();
      this._session = null;
    }
  }

  async stop(): Promise<void> {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._flush(true);
  }

  cancel(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._session?.close();
    this._session = null;
  }
}
