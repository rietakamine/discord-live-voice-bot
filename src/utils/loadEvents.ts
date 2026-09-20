import fs from "node:fs";
import path from "node:path";
import { Client } from "discord.js";
import { BotEvent } from "../types";
import { logger } from "./logger";

const IGNORED_PREFIXES = ["_", "."];

export function loadEvents(client: Client, dir = path.join(__dirname, "..", "events")) {
  const eventFiles = fs
    .readdirSync(dir)
    .filter(
      (f) =>
        (f.endsWith(".ts") || f.endsWith(".js")) &&
        !f.endsWith(".d.ts") &&
        !IGNORED_PREFIXES.some((p) => f.startsWith(p))
    );

  for (const file of eventFiles) {
    const filePath = path.join(dir, file);
    const imported = require(filePath);
    const event: BotEvent = imported.default ?? imported;

    if (!event?.name || !event?.execute) {
      logger.warn(`Skipping event file ${file}: missing "name" or "execute" export.`);
      continue;
    }

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }

    logger.info(`Loaded event: ${event.name} (${file})`);
  }
}
