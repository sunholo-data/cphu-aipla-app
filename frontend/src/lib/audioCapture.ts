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

export function isAudioCaptureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

interface RecorderDeps {
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
    const stream = await this._getUserMedia({ audio: true });
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
