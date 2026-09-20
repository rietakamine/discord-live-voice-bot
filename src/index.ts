import { Client, Collection, GatewayIntentBits } from "discord.js";
import config from "./utils/config";
import { logger } from "./utils/logger";
import { connectDatabase } from "./utils/database";
import { loadCommands } from "./utils/loadCommands";
import { loadEvents } from "./utils/loadEvents";
import { keepAlive } from "./keepAlive";
import { startWebServer } from "./web/server";


async function main() {
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  });

  client.commands = new Collection();

  await connectDatabase();
  loadCommands(client);
  loadEvents(client);

  startWebServer();
  keepAlive();

  await client.login(config.token);
}

main().catch((err) => {
  logger.error("Fatal error during startup:", err);
  process.exit(1);
});