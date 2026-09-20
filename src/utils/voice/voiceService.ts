import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import type { Readable } from "node:stream";
import { Guild, VoiceBasedChannel } from "discord.js";
import {
  AudioPlayer,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} from "@discordjs/voice";
import { logger } from "../logger";
import { AudioMixer, MixerState } from "./audioMixer";
import { VoiceListener } from "./voiceListener";

/** State of the bot's link to Discord's voice servers (not the browser's websocket). */
export type VoiceLinkState = "connecting" | "ready" | "reconnecting" | "disconnected";

export interface VoiceSessionState extends MixerState {
  channelName: string;
  connection: VoiceLinkState;
}

const MIC_IDLE_RELEASE_MS = 1_500;

export class VoiceSession extends EventEmitter {
  readonly token = randomBytes(24).toString("base64url");
  readonly guildId: string;
  readonly mixer = new AudioMixer();
  readonly player: AudioPlayer;
  readonly connection: VoiceConnection;
  readonly listener: VoiceListener;
  private readonly listening = new Set<object>();
  private micHolder: object | null = null;
  private lastMicFrameAt = 0;
  private readonly micWatchdog: ReturnType<typeof setInterval>;
  private closed = false;
  private link: VoiceLinkState = "connecting";
  private everReady = false;
  constructor(guild: Guild, readonly channel: VoiceBasedChannel, readonly ownerId: string) {
    super();
    this.guildId = guild.id;
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
    });
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        // Default is 5 (100 ms). One event-loop stall while a file is being
        // uploaded / ffmpeg is spawning is enough to trip that, and the player
        // then stops and destroys the mixer's stream. Give it a second.
        maxMissedFrames: 50,
      },
    });
    this.connection.subscribe(this.player);
    this.mixer.on("stream", (stream: Readable) => {
      this.player.play(createAudioResource(stream, { inputType: StreamType.Opus }));
    });
    this.mixer.on("state", () => this.emit("state", this.getState()));
    this.mixer.on("recovered", (reason: string) => {
      logger.warn(`voice: mixer stream restarted in guild ${guild.id}: ${reason}`);
    });
    this.mixer.on("trackError", (name: string, message: string) => {
      this.emit("notice", `Couldn't play "${name}": ${message}`);
    });
    this.player.on("error", (err) => {
      logger.error(`Voice player error in guild ${guild.id}:`, err);
    });
    this.player.on("stateChange", (oldState, newState) => {
      logger.debug(`voice: player ${oldState.status} -> ${newState.status} (guild ${guild.id})`);
    });
    try {
      this.listener = new VoiceListener(this.connection.receiver);
      this.listener.on("audio", (frame: Buffer) => this.emit("audio", frame));
      this.listener.on("speakers", (ids: string[]) => {
        const names = ids.map(
          (id) => this.channel.guild.members.cache.get(id)?.displayName ?? "Someone"
        );
        this.emit("speakers", names);
      });
    } catch (err) {
      logger.error(`voice: failed to set up listener in guild ${guild.id}:`, err);
      this.listener = new EventEmitter() as VoiceListener;
      (this.listener as any).setEnabled = () => {};
      (this.listener as any).destroy = () => {};
    }
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        // Reconnection has *started* — now confirm it actually finishes.
        // Without this, a connection that stalls mid-reconnect (a Discord
        // voice gateway hiccup) can sit half-alive forever: never fully
        // Disconnected, never Ready again, silently dead for both mic and
        // music until someone runs /voice leave + join.
        await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
      } catch {
        this.emit("notice", "Lost the connection to Discord. Run /voice join to start a new session.");
        this.destroy();
      }
    });
    this.connection.on("error", (err) => {
      logger.error(`voice: connection error in guild ${guild.id}:`, err);
    });
    this.connection.on("stateChange", (oldState, newState) => {
      logger.debug(`voice: connection ${oldState.status} -> ${newState.status} (guild ${guild.id})`);
      this.updateLink(newState.status);
    });
    this.micWatchdog = setInterval(() => {
      // Safety net: the mixer believes it is streaming but the player has gone
      // idle, so nobody is reading its output. Hand the player a fresh stream.
      if (this.mixer.isStreaming && this.player.state.status === AudioPlayerStatus.Idle) {
        this.mixer.restartStream("player went idle while the mixer was streaming");
      }
      if (this.micHolder && Date.now() - this.lastMicFrameAt > MIC_IDLE_RELEASE_MS) {
        this.micHolder = null;
        this.mixer.endMic();
      }
    }, 500);
  }
  get channelName(): string {
    return this.channel.name;
  }
  getState(): VoiceSessionState {
    return { ...this.mixer.getState(), channelName: this.channel.name, connection: this.link };
  }
  private updateLink(status: VoiceConnectionStatus): void {
    let next: VoiceLinkState;
    switch (status) {
      case VoiceConnectionStatus.Ready:
        next = "ready";
        this.everReady = true;
        break;
      case VoiceConnectionStatus.Signalling:
      case VoiceConnectionStatus.Connecting:
        next = this.everReady ? "reconnecting" : "connecting";
        break;
      case VoiceConnectionStatus.Disconnected:
        next = "reconnecting";
        break;
      default:
        next = "disconnected";
    }
    if (next === this.link) return;
    this.link = next;
    if (!this.closed) this.emit("state", this.getState());
  }
  setListening(who: object, on: boolean): void {
    if (on) this.listening.add(who);
    else this.listening.delete(who);
    this.listener.setEnabled(this.listening.size > 0);
  }
  receiveMic(who: object, chunk: Buffer): void {
    if (this.micHolder && this.micHolder !== who) return;
    this.micHolder = who;
    this.lastMicFrameAt = Date.now();
    this.mixer.pushMic(chunk);
  }
  releaseMic(who: object): void {
    if (this.micHolder === who) {
      this.micHolder = null;
      this.mixer.endMic();
    }
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.micWatchdog);
    this.listener.destroy();
    this.mixer.destroy();
    this.player.stop(true);
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
    this.emit("closed");
    this.removeAllListeners();
  }
}
const sessionsByGuild = new Map<string, VoiceSession>();
const sessionsByToken = new Map<string, VoiceSession>();
export async function joinVoice(
  guild: Guild,
  channel: VoiceBasedChannel,
  ownerId: string
): Promise<VoiceSession> {
  sessionsByGuild.get(guild.id)?.destroy();
  const session = new VoiceSession(guild, channel, ownerId);
  sessionsByGuild.set(guild.id, session);
  sessionsByToken.set(session.token, session);
  session.once("closed", () => {
    if (sessionsByGuild.get(guild.id) === session) sessionsByGuild.delete(guild.id);
    sessionsByToken.delete(session.token);
  });
  try {
    await entersState(session.connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (err) {
    session.destroy();
    throw err;
  }
  return session;
}
export function leaveVoice(guildId: string): boolean {
  const session = sessionsByGuild.get(guildId);
  if (session) {
    session.destroy();
    return true;
  }
  const stray = getVoiceConnection(guildId);
  if (stray) {
    stray.destroy();
    return true;
  }
  return false;
}
export function getSession(guildId: string): VoiceSession | undefined {
  return sessionsByGuild.get(guildId);
}
export function getSessionByToken(token: string): VoiceSession | undefined {
  return sessionsByToken.get(token);
}