import express, { Router } from "express";
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { logger } from "../logger";
import { VoiceSession, VoiceSessionState, getSessionByToken } from "./voiceService";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // keep in sync with MAX_MB in voice.html
const MAX_QUEUED_TRACKS = 10;
const WS_PATH = /^\/voice\/([\w-]+)\/ws$/;
const HEARTBEAT_MS = 20_000; // ping interval; a socket with no pong in this window is dead

/** WebSocket extended with the liveness flag used by the heartbeat below. */
type HeartbeatSocket = WebSocket & { isAlive?: boolean };

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function readFileName(header: string | undefined): string {
  let raw = header ?? "";
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  return path.basename(raw).slice(0, 80) || "upload";
}

/** GET /voice/:token (page) and POST /voice/:token/upload (audio files). */
export function createVoiceRouter(publicDir: string): Router {
  const router = Router();

  router.get("/voice/:token", (req, res) => {
    if (!getSessionByToken(req.params.token)) {
      res
        .status(404)
        .type("text/plain")
        .send("This voice session has ended. Run /voice join in Discord to start a new one.");
      return;
    }
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    });
    res.sendFile(path.join(publicDir, "voice.html"));
  });

  router.post(
    "/voice/:token/upload",
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const session = getSessionByToken(req.params.token);
      if (!session) {
        res.status(404).json({ ok: false, error: "This voice session has ended." });
        return;
      }
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ ok: false, error: "The file was empty." });
        return;
      }
      if (session.mixer.queueSize >= MAX_QUEUED_TRACKS) {
        res.status(429).json({ ok: false, error: "The queue is full. Wait for a track to finish." });
        return;
      }

      const displayName = readFileName(req.header("x-file-name"));
      const tempPath = path.join(os.tmpdir(), `voice-${randomUUID()}`);
      try {
        await fs.writeFile(tempPath, body);
        session.mixer.enqueueFile(tempPath, displayName);
        res.json({ ok: true });
      } catch (err) {
        logger.error("voice: failed to store upload", err);
        await fs.unlink(tempPath).catch(() => undefined);
        res.status(500).json({ ok: false, error: "Couldn't process that upload." });
      }
    }
  );

  return router;
}

/** WS /voice/:token/ws — binary frames = mic PCM, text frames = JSON controls. */
export function attachVoiceSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  // A dead connection (phone lock, wifi drop, laptop sleep) never sends a
  // close frame, so without this the server can hold session.micHolder (or
  // a stale "listening" registration) for as long as the OS/NAT takes to
  // notice the socket is gone — commonly a couple of minutes. Proactively
  // ping every socket and terminate any that missed the last pong.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients as Set<HeartbeatSocket>) {
      if (client.isAlive === false) {
        client.terminate(); // fires "close" below, which releases mic/listening
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_MS);
  wss.on("close", () => clearInterval(heartbeat));

  server.on("upgrade", (req, socket: Duplex, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const match = WS_PATH.exec(pathname);
    const session = match ? getSessionByToken(match[1]) : undefined;
    if (!session) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, session));
  });
}

function handleConnection(ws: WebSocket, session: VoiceSession): void {
  const hb = ws as HeartbeatSocket;
  hb.isAlive = true;
  ws.on("pong", () => {
    hb.isAlive = true;
  });

  const send = (payload: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };
  const onState = (state: VoiceSessionState) => send({ type: "state", ...state });
  const onNotice = (message: string) => send({ type: "notice", message });
  const onClosed = () => ws.close(4000, "Session ended");

  session.on("state", onState);
  session.on("notice", onNotice);
  session.on("closed", onClosed);
  send({ type: "state", ...session.getState() });

  // Live audio from the voice channel, only for sockets that asked for it.
  let listening = false;
  const onAudio = (frame: Buffer) => {
    if (listening && ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024) {
      ws.send(frame, { binary: true });
    }
  };
  const onSpeakers = (names: string[]) => {
    if (listening) send({ type: "speakers", names });
  };
  session.on("audio", onAudio);
  session.on("speakers", onSpeakers);

  const releaseMic = () => session.releaseMic(ws);

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      session.receiveMic(ws, toBuffer(data));
      return;
    }
    let msg: { type?: string; value?: unknown };
    try {
      msg = JSON.parse(toBuffer(data).toString());
    } catch {
      return;
    }
    switch (msg.type) {
      case "mic-end":
        releaseMic();
        break;
      case "skip":
        session.mixer.skip();
        break;
      case "stop":
        session.mixer.stopMusic();
        break;
      case "listen":
        listening = msg.value === true;
        session.setListening(ws, listening);
        if (!listening) send({ type: "speakers", names: [] });
        break;
      case "volume":
        if (typeof msg.value === "number") session.mixer.setMusicVolume(msg.value);
        break;
      case "ping":
        // Echoed straight back with the client's own timestamp so it can
        // measure round-trip latency; we never look at the value.
        if (typeof msg.value === "number") send({ type: "pong", value: msg.value });
        break;
    }
  });

  ws.on("error", (err) => logger.warn("voice: websocket error", err));
  ws.on("close", () => {
    session.off("state", onState);
    session.off("notice", onNotice);
    session.off("closed", onClosed);
    session.off("audio", onAudio);
    session.off("speakers", onSpeakers);
    session.setListening(ws, false);
    releaseMic();
  });
}