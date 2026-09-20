import http from "node:http";
import config from "./utils/config";
import { logger } from "./utils/logger";

export function keepAlive(): void {
  if (!config.keepAlive?.enabled) return;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK - bot is alive");
  });
  server.listen(config.keepAlive.port, () => {
    logger.info(`Keep-alive server listening on port ${config.keepAlive.port}`);
  });
}