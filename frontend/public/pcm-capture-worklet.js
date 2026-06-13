/**
 * PCM capture AudioWorklet for AIPLA voice (dictation + lesson recording).
 *
 * Ported from the ailang streaming demos (dev/sunholo/demos/streaming/shared/
 * audio-worklet.js). Captures the mic as raw 16-bit PCM at a fixed target rate
 * (16 kHz mono) by downsampling from whatever the hardware/AudioContext rate is
 * (commonly 44.1 kHz on macOS, 48 kHz elsewhere).
 *
 * WHY: the browser's MediaRecorder encodes Opus and stamps the hardware sample
 * rate (44100) into the WebM header, which Google Cloud STT's WEBM_OPUS decoder
 * rejects ("Opus sample rate (44100) not in supported rates"). Capturing raw
 * PCM at a known 16 kHz sidesteps the container entirely — the audio IS
 * LINEAR16 @ 16 kHz, exactly what STT wants. No transcode, no header to misread.
 *
 * Usage:
 *   await ctx.audioWorklet.addModule('/pcm-capture-worklet.js');
 *   const node = new AudioWorkletNode(ctx, 'pcm-capture', {
 *     processorOptions: { targetRate: 16000 },
 *   });
 *   node.port.onmessage = (e) => { if (e.data.type === 'pcm-chunk') {...} };
 *   source.connect(node);
 */

class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options?.processorOptions?.targetRate || 16000;
    // Emit a chunk roughly every 100ms so a 50s segment is ~500 messages.
    this.chunkMs = options?.processorOptions?.chunkMs || 100;
    this.buffer = new Float32Array(0);
    this.samplesPerChunk = Math.floor((this.targetRate * this.chunkMs) / 1000);
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

    const inputData = input[0]; // mono channel

    // Downsample from the AudioContext's sampleRate to targetRate. `sampleRate`
    // is the global injected into the worklet scope (the context's rate).
    const ratio = sampleRate / this.targetRate;
    const downsampledLength = Math.floor(inputData.length / ratio);
    const downsampled = new Float32Array(downsampledLength);
    for (let i = 0; i < downsampledLength; i++) {
      downsampled[i] = inputData[Math.floor(i * ratio)];
    }

    const merged = new Float32Array(this.buffer.length + downsampled.length);
    merged.set(this.buffer);
    merged.set(downsampled, this.buffer.length);
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
        { type: "pcm-chunk", pcmData: pcm16.buffer, sampleRate: this.targetRate },
        [pcm16.buffer],
      );
    }
    return true;
  }
}

registerProcessor("pcm-capture", PCMCaptureProcessor);
