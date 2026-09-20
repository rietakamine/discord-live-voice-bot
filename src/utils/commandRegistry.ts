import fs from "node:fs";
import path from "node:path";
import { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";

const IGNORED_PREFIXES = ["_", "."];
const DEFAULT_COMMANDS_DIR = path.join(__dirname, "..", "commands");

export function collectCommandFiles(dir: string = DEFAULT_COMMANDS_DIR): string[] {
  let results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_PREFIXES.some((p) => entry.name.startsWith(p))) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(collectCommandFiles(fullPath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

export function getCommandsJSON(
  dir: string = DEFAULT_COMMANDS_DIR
): RESTPostAPIApplicationCommandsJSONBody[] {
  return collectCommandFiles(dir).map((file) => {
    const imported = require(file);
    const command = imported.default ?? imported;
    return command.data.toJSON();
  });
}