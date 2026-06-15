/**
 * PCM capture AudioWorklet for AIPLA voice (dictation + lesson recording).
 *
 * Captures the mic as raw 16-bit PCM at the AudioContext's NATIVE sample rate
 * (commonly 44.1 kHz on macOS, 48 kHz elsewhere) — no JS resampling.
 *
 * WHY no resampling: the browser's MediaRecorder encodes Opus and stamps the
 * hardware rate (44100) into the WebM header, which Google Cloud STT's
 * WEBM_OPUS decoder rejects. Earlier we downsampled to 16 kHz here with naive
 * nearest-neighbour decimation (no anti-alias filter), which folded high
 * frequencies back as noise and GARBLED even clear speech. LINEAR16 accepts any
 * rate 8–48 kHz, so we hand Cloud STT the native-rate PCM and let ITS
 * production resampler do the downsampling cleanly. The WAV header (written on
 * the main thread from ctx.sampleRate) carries the rate, so STT knows it.
 *
 * Usage:
 *   await ctx.audioWorklet.addModule('/pcm-capture-worklet.js');
 *   const node = new AudioWorkletNode(ctx, 'pcm-capture');
 *   node.port.onmessage = (e) => { if (e.data.type === 'pcm-chunk') {...} };
 *   source.connect(node);
 */

class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // Emit a chunk roughly every 100ms so message traffic stays modest.
    this.chunkMs = options?.processorOptions?.chunkMs || 100;
    this.buffer = new Float32Array(0);
    // `sampleRate` is the global injected into the worklet scope (the
    // AudioContext's native rate).
    this.samplesPerChunk = Math.floor((sampleRate * this.chunkMs) / 1000);
    this.isRecording = true;

    this.port.onmessage = (e) => {
      if (e.data.command === "stop") this.isRecording = false;
      if (e.data.command === "start") this.isRecording = true;
    };
  }

  process(inputs) {
    if (!this.isRecording) return true;
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputData = input[0]; // mono channel, native rate — NOT resampled

    const merged = new Float32Array(this.buffer.length + inputData.length);
    merged.set(this.buffer);
    merged.set(inputData, this.buffer.length);
    this.buffer = merged;

    while (this.buffer.length >= this.samplesPerChunk) {
      const chunk = this.buffer.slice(0, this.samplesPerChunk);
      this.buffer = this.buffer.slice(this.samplesPerChunk);

      // float32 [-1,1] -> int16 LE PCM
      const pcm16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      this.port.postMessage(
        { type: "pcm-chunk", pcmData: pcm16.buffer, sampleRate },
        [pcm16.buffer],
      );
    }
    return true;
  }
}

registerProcessor("pcm-capture", PCMCaptureProcessor);
