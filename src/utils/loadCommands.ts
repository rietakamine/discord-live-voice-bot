import path from "node:path";
import { Client } from "discord.js";
import { AnyCommand } from "../types";
import { collectCommandFiles } from "./commandRegistry";
import { logger } from "./logger";

export function loadCommands(client: Client, baseDir = path.join(__dirname, "..", "commands")) {
  const commandFiles = collectCommandFiles(baseDir);
  for (const filePath of commandFiles) {
    const imported = require(filePath);
    const command: AnyCommand = imported.default ?? imported;
    if (!command?.data || !command?.execute) {
      logger.warn(`Skipping ${filePath}: missing "data" or "execute" export.`);
      continue;
    }

    if (!command.permissionKey) {
      command.permissionKey = command.data.name;
    }
    client.commands.set(command.data.name, command);
    logger.info(`Loaded command: /${command.data.name}  (${path.relative(baseDir, filePath)})`);
  }
  logger.info(`Total commands loaded: ${client.commands.size}`);
}