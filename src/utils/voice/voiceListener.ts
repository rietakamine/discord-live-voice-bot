import { EventEmitter } from "node:events";
import { AudioReceiveStream, EndBehaviorType, VoiceReceiver } from "@discordjs/voice";
import OpusScript from "opusscript";
import { logger } from "../logger";
import { PcmQueue } from "./audioMixer";

const SAMPLE_RATE = 48_000;
const FRAME_MS = 20;
const FRAME_SAMPLES = (SAMPLE_RATE / 1000) * FRAME_MS;
const STEREO_FRAME_BYTES = FRAME_SAMPLES * 2 * 2;
const JITTER_BYTES = STEREO_FRAME_BYTES * 3;
const MAX_QUEUE_BYTES = STEREO_FRAME_BYTES * 15;
const SILENCE_END_MS = 250;
interface Speaker {
  decoder: OpusScript;
  queue: PcmQueue;
  stream: AudioReceiveStream;
  primed: boolean;
  ended: boolean;
}
export class VoiceListener extends EventEmitter {
  private readonly speakers = new Map<string, Speaker>();
  private readonly activeSpeakers = new Set<string>();
  private enabled = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSpeakerKey = "";
  private readonly onStart = (userId: string) => {
    this.activeSpeakers.add(userId);
    this.subscribeTo(userId);
  };
  private readonly onEnd = (userId: string) => {
    this.activeSpeakers.delete(userId);
  };
  constructor(private readonly receiver: VoiceReceiver) {
    super();
    receiver.speaking.on("start", this.onStart);
    receiver.speaking.on("end", this.onEnd);
  }
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {

      for (const id of this.activeSpeakers) this.subscribeTo(id);
      this.timer = setInterval(() => this.tick(), FRAME_MS);
      return;
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const id of [...this.speakers.keys()]) this.dropSpeaker(id);
    this.setSpeakerList([]);
  }
  destroy(): void {
    this.setEnabled(false);
    this.receiver.speaking.off("start", this.onStart);
    this.receiver.speaking.off("end", this.onEnd);
    this.removeAllListeners();
  }
  private subscribeTo(userId: string): void {
    if (!this.enabled) return;
    const existing = this.speakers.get(userId);
    if (existing) {
      if (!existing.ended) return;
      this.dropSpeaker(userId);
    }
    const stream = this.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_END_MS },
    });
    const speaker: Speaker = {
      decoder: new OpusScript(SAMPLE_RATE, 2, OpusScript.Application.AUDIO),
      queue: new PcmQueue(),
      stream,
      primed: false,
      ended: false,
    };
    stream.on("data", (packet: Buffer) => {
      if (packet.length <= 3) return;
      try {
        speaker.queue.push(Buffer.from(speaker.decoder.decode(packet)));
        if (speaker.queue.length > MAX_QUEUE_BYTES) {
          speaker.queue.discard(speaker.queue.length - MAX_QUEUE_BYTES);
        }
      } catch {
      }
    });
    stream.on("end", () => {
      speaker.ended = true;
    });
    stream.on("error", (err) => {
      logger.warn(`voice: receive stream error for user ${userId}:`, err);
      speaker.ended = true;
    });
    this.speakers.set(userId, speaker);
  }
  private dropSpeaker(userId: string): void {
    const speaker = this.speakers.get(userId);
    if (!speaker) return;
    this.speakers.delete(userId);
    speaker.stream.destroy();
    speaker.decoder.delete();
    speaker.queue.clear();
  }
  private setSpeakerList(ids: string[]): void {
    const key = ids.join(",");
    if (key === this.lastSpeakerKey) return;
    this.lastSpeakerKey = key;
    this.emit("speakers", ids);
  }
  private handleSpeakerEnded(id: string): void {
    this.dropSpeaker(id);
    if (this.activeSpeakers.has(id)) this.subscribeTo(id);
  }
  private tick(): void {
    const acc = new Int32Array(FRAME_SAMPLES);
    const audible: string[] = [];
    for (const [id, speaker] of this.speakers) {
      if (!speaker.primed) {
        if (speaker.queue.length < JITTER_BYTES) {
          if (speaker.ended) this.handleSpeakerEnded(id);
          continue;
        }
        speaker.primed = true;
      }
      const frame = speaker.queue.take(STEREO_FRAME_BYTES);
      if (!frame) {
        if (speaker.ended) this.handleSpeakerEnded(id);
        else speaker.primed = false;
        continue;
      }
      audible.push(id);
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        acc[i] += (frame.readInt16LE(i * 4) + frame.readInt16LE(i * 4 + 2)) >> 1;
      }
    }
    this.setSpeakerList(audible);
    if (audible.length === 0) return;
    const out = Buffer.allocUnsafe(FRAME_SAMPLES * 2);
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      const v = acc[i];
      out.writeInt16LE(v > 32767 ? 32767 : v < -32768 ? -32768 : v, i * 2);
    }
    this.emit("audio", out);
  }
}