import express from "express";
import path from "node:path";
import config from "../utils/config";
import { logger } from "../utils/logger";
import { createVoiceRouter, attachVoiceSocket } from "../utils/voice/voiceWeb";

export function startWebServer(): void {
  const app = express();
  const publicDir = path.join(__dirname, "public");
  app.get("/", (_req, res) => res.redirect("/tos"));
  app.get("/tos", (_req, res) => res.sendFile(path.join(publicDir, "tos.html")));
  app.get("/privacy", (_req, res) => res.sendFile(path.join(publicDir, "privacy.html")));
  app.use(createVoiceRouter(publicDir));

  const server = app.listen(config.web.port, () => {
    logger.info(`Web server listening on port ${config.web.port} (${config.web.publicUrl})`);
  });
  attachVoiceSocket(server);
}