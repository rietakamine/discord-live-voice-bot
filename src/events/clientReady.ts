import { Client } from "discord.js";
import { BotEvent } from "../types";
import { logger } from "../utils/logger";
import {
  getAllPermissionKeys,
  syncPermissionKeysForGuild,
} from "../utils/permissions";


const event: BotEvent = {
  name: "clientReady",
  once: true,
  async execute(client: Client) {
    logger.info(`Logged in as ${client.user?.tag}`);

    const permissionKeys = getAllPermissionKeys(client);
    for (const guild of client.guilds.cache.values()) {
      try {
        await syncPermissionKeysForGuild(guild.id, permissionKeys);
      } catch (err) {
        logger.error(
          `Failed to sync command permissions for guild ${guild.id}:`,
          err
        );
      }
    }
    logger.info(
      `Synced ${permissionKeys.length} command permission key(s) across ${client.guilds.cache.size} guild(s).`
    );
  },
};

export default event;