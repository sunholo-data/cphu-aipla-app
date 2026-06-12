/**
 * On-device audio capture for voice-in + lesson recording (VOICE-IN-REC M3).
 *
 * A thin wrapper over getUserMedia + MediaRecorder. Both modes (talk-to-type
 * dictation and "record this class") use the SAME recorder — they're mutually
 * exclusive (never two getUserMedia streams at once), enforced by the caller.
 *
 * No always-on mic: recording starts only on an explicit user gesture and the
 * tracks are stopped the moment recording ends. The browser bits are isolated
 * behind injectable deps so the pure logic is unit-testable under jsdom.
 */

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

// Preference order — webm/opus is the broad default; mp4 covers Safari.
const _PREFERRED_MIMES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export function pickAudioMimeType(
  isSupported: (m: string) => boolean = (m) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
): string {
  for (const m of _PREFERRED_MIMES) {
    try {
      if (isSupported(m)) return m;
    } catch {
      /* isTypeSupported can throw on some engines — treat as unsupported */
    }
  }
  return "";
}

/**
 * Capture constraints for the mic stream. We request **48 kHz** because the
 * Opus codec stamps the capture sample rate into its WebM header, and Google
 * Cloud STT's `WEBM_OPUS` decoder only accepts 8/12/16/24/48 kHz. macOS mics
 * default to 44.1 kHz, which STT rejects with a 400 ("Opus sample rate (44100)
 * not in supported rates") — leaving the audio stored but never transcribed.
 *
 * `sampleRate` is given as a plain value (an "ideal", not `{ exact }`), so a
 * browser that can't honour it resamples rather than throwing. `AudioRecorder`
 * additionally falls back to an unconstrained stream if the request rejects.
 */
export const STT_AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: { sampleRate: 48000 },
};

export function isAudioCaptureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

export interface RecorderDeps {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorderCtor?: typeof MediaRecorder;
  now?: () => number;
  pickMime?: () => string;
}

/**
 * One-shot audio recorder: `start()` then `stop()` -> a single Blob. Holds the
 * stream + chunks privately and releases the mic on stop/cancel.
 */
export class AudioRecorder {
  private _recorder: MediaRecorder | null = null;
  private _stream: MediaStream | null = null;
  private _chunks: Blob[] = [];
  private _startedAt = 0;
  private _mimeType = "";
  private readonly _getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly _Ctor: typeof MediaRecorder | undefined;
  private readonly _now: () => number;
  private readonly _pickMime: () => string;

  constructor(deps: RecorderDeps = {}) {
    this._getUserMedia = deps.getUserMedia ?? ((c) => navigator.mediaDevices.getUserMedia(c));
    this._Ctor = deps.MediaRecorderCtor ?? (typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined);
    this._now = deps.now ?? (() => Date.now());
    this._pickMime = deps.pickMime ?? pickAudioMimeType;
  }

  get recording(): boolean {
    return this._recorder !== null;
  }

  async start(): Promise<void> {
    if (this._recorder) return;
    if (!this._Ctor) throw new Error("MediaRecorder unavailable");
    // Prefer the 48 kHz constraint (see STT_AUDIO_CONSTRAINTS); fall back to an
    // unconstrained stream if a browser rejects it (e.g. OverconstrainedError).
    let stream: MediaStream;
    try {
      stream = await this._getUserMedia(STT_AUDIO_CONSTRAINTS);
    } catch {
      stream = await this._getUserMedia({ audio: true });
    }
    this._stream = stream;
    this._mimeType = this._pickMime();
    const rec = this._mimeType
      ? new this._Ctor(stream, { mimeType: this._mimeType })
      : new this._Ctor(stream);
    this._chunks = [];
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) this._chunks.push(e.data);
    };
    this._recorder = rec;
    this._startedAt = this._now();
    rec.start();
  }

  async stop(): Promise<RecordingResult> {
    const rec = this._recorder;
    if (!rec) throw new Error("not recording");
    const durationMs = Math.max(0, this._now() - this._startedAt);
    const mimeType = this._mimeType || rec.mimeType || "audio/webm";
    const chunks = this._chunks;
    const blob: Blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      rec.stop();
    });
    this._cleanup();
    return { blob, mimeType, durationMs };
  }

  cancel(): void {
    try {
      this._recorder?.stop();
    } catch {
      /* already stopped */
    }
    this._cleanup();
  }

  private _cleanup(): void {
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
    this._recorder = null;
    this._chunks = [];
  }
}

/** Default lesson segment length. Must stay under Cloud Speech sync recognize's
 * ~1-min cap so the backend can transcribe each segment without long-running. */
export const SEGMENT_MS = 50_000;

/**
 * Records a long session as a sequence of complete, independently-decodable
 * segments (REC-TRANSCRIPT M2): every ~SEGMENT_MS it stops the current recorder
 * (yielding a finished webm), fires `onSegment(result, seq)`, and starts a fresh
 * one. Recursive setTimeout (not setInterval) so segments never overlap. `stop()`
 * flushes the final partial segment.
 */
export class SegmentedRecorder {
  private _rec: AudioRecorder | null = null;
  private _timeout: ReturnType<typeof setTimeout> | null = null;
  private _seq = 0;
  private _stopped = false;
  private readonly _onSegment: (r: RecordingResult, seq: number) => void;
  private readonly _segmentMs: number;
  private readonly _deps: RecorderDeps;

  constructor(
    onSegment: (r: RecordingResult, seq: number) => void,
    segmentMs: number = SEGMENT_MS,
    deps: RecorderDeps = {},
  ) {
    this._onSegment = onSegment;
    this._segmentMs = segmentMs;
    this._deps = deps;
  }

  get recording(): boolean {
    return !this._stopped && this._rec !== null;
  }

  async start(): Promise<void> {
    this._stopped = false;
    this._seq = 0;
    await this._cycle();
  }

  private async _cycle(): Promise<void> {
    if (this._stopped) return;
    this._rec = new AudioRecorder(this._deps);
    await this._rec.start();
    this._timeout = setTimeout(() => void this._onTick(), this._segmentMs);
  }

  private async _onTick(): Promise<void> {
    if (this._stopped || !this._rec) return;
    const r = await this._rec.stop();
    this._rec = null;
    if (r.blob.size > 0) this._onSegment(r, this._seq++);
    await this._cycle();
  }

  async stop(): Promise<void> {
    this._stopped = true;
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
    if (this._rec) {
      const r = await this._rec.stop();
      this._rec = null;
      if (r.blob.size > 0) this._onSegment(r, this._seq++);
    }
  }

  cancel(): void {
    this._stopped = true;
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
    this._rec?.cancel();
    this._rec = null;
  }
}
