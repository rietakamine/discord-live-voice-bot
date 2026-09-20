import { EventEmitter } from "node:events";
import { spawn, ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import OpusScript from "opusscript";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const FRAME_MS = 20;
const FRAME_SAMPLES = (SAMPLE_RATE / 1000) * FRAME_MS;
const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2;
const SILENCE_PACKET = Buffer.from([0xf8, 0xff, 0xfe]);
const MIC_JITTER_BYTES = FRAME_BYTES * 3;
const MIC_MAX_BYTES = FRAME_BYTES * 20;
const TRACK_HIGH_WATER = FRAME_BYTES * 150;
const TRACK_LOW_WATER = FRAME_BYTES * 50;
const IDLE_GRACE_MS = 1000;
const DUCK_GAIN = 0.35;
const FFMPEG = ffmpegPath ?? "ffmpeg";
export interface MixerState {
  nowPlaying: string | null;
  queue: string[];
  musicVolume: number;
}
export class PcmQueue {
  private chunks: Buffer[] = [];
  private total = 0;
  get length(): number {
    return this.total;
  }
  push(chunk: Buffer): void {
    if (!chunk.length) return;
    this.chunks.push(chunk);
    this.total += chunk.length;
  }
  take(bytes: number): Buffer | null {
    if (bytes <= 0 || this.total < bytes) return null;
    const out = Buffer.allocUnsafe(bytes);
    let written = 0;
    while (written < bytes) {
      const head = this.chunks[0];
      const need = bytes - written;
      if (head.length <= need) {
        head.copy(out, written);
        written += head.length;
        this.chunks.shift();
      } else {
        head.copy(out, written, 0, need);
        this.chunks[0] = head.subarray(need);
        written += need;
      }
    }
    this.total -= bytes;
    return out;
  }
  discard(bytes: number): void {
    this.take(Math.min(bytes, this.total));
  }
  clear(): void {
    this.chunks = [];
    this.total = 0;
  }
}
function monoToStereo(mono: Buffer): Buffer {
  const samples = mono.length >> 1;
  const out = Buffer.allocUnsafe(samples * 4);
  for (let i = 0; i < samples; i++) {
    const s = mono.readInt16LE(i * 2);
    out.writeInt16LE(s, i * 4);
    out.writeInt16LE(s, i * 4 + 2);
  }
  return out;
}
class Track {
  private readonly pcm = new PcmQueue();
  private readonly proc: ChildProcess;
  private ended = false;
  private destroyed = false;
  private produced = 0;
  private stderr = "";
  constructor(
    readonly name: string,
    private readonly filePath: string,
    onError: (track: Track, message: string) => void
  ) {
    this.proc = spawn(
      FFMPEG,
      [
        "-hide_banner",
        "-loglevel", "error",
        "-i", filePath,
        "-vn",
        "-f", "s16le",
        "-ar", String(SAMPLE_RATE),
        "-ac", String(CHANNELS),
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.produced += chunk.length;
      this.pcm.push(chunk);
      if (this.pcm.length > TRACK_HIGH_WATER) this.proc.stdout!.pause();
    });
    this.proc.stderr!.on("data", (chunk: Buffer) => {
      if (this.stderr.length < 2000) this.stderr += chunk.toString();
    });
    this.proc.on("error", (err) => {
      if (this.ended) return;
      this.ended = true;
      onError(this, `Couldn't start ffmpeg: ${err.message}`);
    });
    this.proc.on("close", () => {
      const alreadyEnded = this.ended;
      this.ended = true;
      if (!alreadyEnded && !this.destroyed && this.produced === 0) {
        const lastLine = this.stderr.trim().split("\n").pop();
        onError(this, lastLine || "That file couldn't be decoded as audio.");
      }
    });
  }
  take(): Buffer | null {
    let frame = this.pcm.take(FRAME_BYTES);
    if (!frame && this.ended && this.pcm.length > 0) {
      const rest = this.pcm.take(this.pcm.length)!;
      frame = Buffer.concat([rest, Buffer.alloc(FRAME_BYTES - rest.length)]);
    }
    if (this.pcm.length < TRACK_LOW_WATER) this.proc.stdout?.resume();
    return frame;
  }
  get finished(): boolean {
    return this.ended && this.pcm.length === 0;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.proc.kill("SIGKILL");
    this.pcm.clear();
    void fs.unlink(this.filePath).catch(() => undefined);
  }
}
export class AudioMixer extends EventEmitter {
  private readonly encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);
  private readonly mic = new PcmQueue();
  private micActive = false;
  private tracks: Track[] = [];
  private current: Track | null = null;
  private musicVolume = 0.7;
  private stream: Readable | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private clockStart = 0;
  private framesSent = 0;
  private idleMs = 0;
  private destroyed = false;

  pushMic(pcmMono: Buffer): void {
    if (this.destroyed) return;
    const usable = pcmMono.subarray(0, pcmMono.length - (pcmMono.length % 2));
    if (!usable.length) return;
    this.mic.push(monoToStereo(usable));
    if (this.mic.length > MIC_MAX_BYTES) this.mic.discard(this.mic.length - MIC_MAX_BYTES);
    this.ensureRunning();
  }
  endMic(): void {
    const rest = this.mic.length % FRAME_BYTES;
    if (rest) this.mic.push(Buffer.alloc(FRAME_BYTES - rest));
    this.micActive = this.mic.length > 0;
  }
  enqueueFile(filePath: string, name: string): void {
    if (this.destroyed) return;
    const track = new Track(name, filePath, (t, message) => {
      this.emit("trackError", t.name, message);
    });
    this.tracks.push(track);
    this.emitState();
    this.ensureRunning();
  }
  get queueSize(): number {
    return this.tracks.length + (this.current ? 1 : 0);
  }
  /** True while a stream is handed to the player and frames are being produced. */
  get isStreaming(): boolean {
    return this.stream !== null && !this.destroyed;
  }
  /**
   * Throw away the current output stream and, if there is still something to
   * play or say, start a fresh one (which the session hands to the player via
   * the "stream" event). Used when the player stops reading from us.
   */
  restartStream(reason: string): void {
    if (this.destroyed || !this.stream) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const old = this.stream;
    this.stream = null;
    if (!old.destroyed) old.destroy();
    this.emit("recovered", reason);
    if (this.hasWork()) this.ensureRunning();
  }
  skip(): void {
    const target = this.current ?? this.tracks.shift() ?? null;
    if (!target) return;
    target.destroy();
    this.current = null;
    this.emitState();
  }
  stopMusic(): void {
    this.current?.destroy();
    this.current = null;
    for (const t of this.tracks) t.destroy();
    this.tracks = [];
    this.emitState();
  }

  setMusicVolume(value: number): void {
    if (!Number.isFinite(value)) return;
    this.musicVolume = Math.min(1, Math.max(0, value));
    this.emitState();
  }
  getState(): MixerState {
    return {
      nowPlaying: this.current?.name ?? null,
      queue: this.tracks.map((t) => t.name),
      musicVolume: this.musicVolume,
    };
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stream?.push(null);
    this.stream = null;
    this.current?.destroy();
    for (const t of this.tracks) t.destroy();
    this.current = null;
    this.tracks = [];
    this.mic.clear();
    this.encoder.delete();
    this.removeAllListeners();
  }

  private emitState(): void {
    this.emit("state", this.getState());
  }
  private hasWork(): boolean {
    return this.micActive || this.mic.length > 0 || this.current !== null || this.tracks.length > 0;
  }
  private ensureRunning(): void {
    if (this.stream || this.destroyed) return;
    this.stream = new Readable({ objectMode: true, read() {} });
    this.idleMs = 0;
    this.framesSent = 0;
    this.clockStart = performance.now();
    this.emit("stream", this.stream);
    this.step();
  }

  private step = (): void => {
    this.timer = null;
    if (!this.stream) return;
    // The audio player destroys the stream it is reading from when it gives up
    // (e.g. after a few missed frames). Writing to a destroyed stream is
    // silently ignored, so without this check the mixer keeps "playing" into
    // the void and never hands the player a new stream.
    if (this.stream.destroyed) {
      this.restartStream("player destroyed the audio stream");
      return;
    }
    const now = performance.now();
    const target = Math.floor((now - this.clockStart) / FRAME_MS) + 2;
    let produced = 0;
    while (this.framesSent < target && produced < 10 && this.stream) {
      this.produceFrame();
      this.framesSent++;
      produced++;
    }
    if (!this.stream) return;
    if (this.framesSent < target) {
      this.clockStart = performance.now();
      this.framesSent = 0;
    }
    const nextAt = this.clockStart + (this.framesSent - 1) * FRAME_MS;
    this.timer = setTimeout(this.step, Math.max(1, nextAt - performance.now()));
  };
  private takeMicFrame(): Buffer | null {
    if (!this.micActive) {
      if (this.mic.length < MIC_JITTER_BYTES) return null;
      this.micActive = true;
    }
    const frame = this.mic.take(FRAME_BYTES);
    if (!frame) this.micActive = false;
    return frame;
  }
  private takeTrackFrame(): Buffer | null {
    for (;;) {
      if (!this.current) {
        const next = this.tracks.shift();
        if (!next) return null;
        this.current = next;
        this.emitState();
      }
      const frame = this.current.take();
      if (frame) return frame;
      if (this.current.finished) {
        this.current.destroy();
        this.current = null;
        this.emitState();
        continue;
      }
      return null;
    }
  }
  private produceFrame(): void {
    const stream = this.stream!;
    const micFrame = this.takeMicFrame();
    const trackFrame = this.takeTrackFrame();
    if (!micFrame && !trackFrame) {
      const musicPending = this.current !== null || this.tracks.length > 0;
      this.idleMs = musicPending ? 0 : this.idleMs + FRAME_MS;
      if (this.idleMs > IDLE_GRACE_MS) {
        stream.push(null);
        this.stream = null;
        return;
      }
      stream.push(SILENCE_PACKET);
      return;
    }
    this.idleMs = 0;
    const musicGain = micFrame ? this.musicVolume * DUCK_GAIN : this.musicVolume;
    const mixed = new Int16Array(FRAME_SAMPLES * CHANNELS);
    for (let i = 0; i < mixed.length; i++) {
      let v = 0;
      if (micFrame) v += micFrame.readInt16LE(i * 2);
      if (trackFrame) v += trackFrame.readInt16LE(i * 2) * musicGain;
      mixed[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
    const pcm = Buffer.from(mixed.buffer, mixed.byteOffset, mixed.byteLength);
    try {
      stream.push(Buffer.from(this.encoder.encode(pcm, FRAME_SAMPLES)));
    } catch (err) {
      this.emit("trackError", "mixer", `Opus encode failed: ${(err as Error).message}`);
    }
  }
}