import { ButtonInteraction, Interaction, StringSelectMenuInteraction } from "discord.js";
import { BotEvent, Command, ContextMenuCommand } from "../types";
import { logger } from "../utils/logger";
import { isAuthorized } from "../utils/permissions";
import { findComponentHandler, findModalHandler } from "../utils/componentRouter";
import { logCommandUsage } from "../utils/commandlog/commandLogService";
import "../utils/registerFeatureHandlers";

function isExpiredInteraction(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === 10062
  );
}

async function replyWithError(interaction: {
  id: string;
  replied: boolean;
  deferred: boolean;
  followUp: Function;
  reply: Function;
}) {
  const payload = { content: "Something went wrong processing that.", ephemeral: true };
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (err) {
    if (isExpiredInteraction(err)) {
      logger.warn(`Interaction ${interaction.id} expired before the error reply could be sent.`);
      return;
    }
    logger.error(`Failed to send error reply for interaction ${interaction.id}:`, err);
  }
}
async function safeReply(interaction: { id: string; reply: Function }, payload: { content: string; ephemeral: boolean }) {
  try {
    await interaction.reply(payload);
  } catch (err) {
    if (isExpiredInteraction(err)) {
      logger.warn(`Interaction ${interaction.id} expired before this reply could be sent.`);
      return;
    }
    logger.error(`Failed to send reply for interaction ${interaction.id}:`, err);
  }
}
const event: BotEvent = {
  name: "interactionCreate",
  async execute(interaction: Interaction) {
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName) as Command | undefined;
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (err) {
          logger.error(`Error in autocomplete for /${interaction.commandName}:`, err);
        }
      }
      return;
    }
    if (interaction.isModalSubmit()) {
      const routedHandler = findModalHandler(interaction.customId);
      if (routedHandler) {
        try {
          await routedHandler(interaction);
        } catch (err) {
          logger.error(`Error in modal handler for "${interaction.customId}":`, err);
          await replyWithError(interaction);
        }
        return;
      }

      const [commandName] = interaction.customId.split(":");
      const command = interaction.client.commands.get(commandName) as Command | undefined;
      if (command?.modalSubmit) {
        try {
          await command.modalSubmit(interaction);
        } catch (err) {
          logger.error(`Error in modalSubmit for "${interaction.customId}":`, err);
          await replyWithError(interaction);
        }
      }
      return;
    }
    if (interaction.isButton() || interaction.isAnySelectMenu()) {
      const routedHandler = findComponentHandler(interaction.customId);
      if (routedHandler) {
        try {
          await routedHandler(interaction as ButtonInteraction | StringSelectMenuInteraction);
        } catch (err) {
          logger.error(`Error in component handler for "${interaction.customId}":`, err);
          await replyWithError(interaction);
        }
        return;
      }

      const [commandName] = interaction.customId.split(":");
      const command = interaction.client.commands.get(commandName) as Command | undefined;
      if (command?.componentInteraction) {
        try {
          await command.componentInteraction(interaction);
        } catch (err) {
          logger.error(`Error in componentInteraction for "${interaction.customId}":`, err);
          await replyWithError(interaction);
        }
      }
      return;
    }
    if (interaction.isMessageContextMenuCommand()) {
      const command = interaction.client.commands.get(interaction.commandName) as ContextMenuCommand | undefined;
      if (!command) {
        logger.warn(`Unknown context menu command received: ${interaction.commandName}`);
        return;
      }

      if (command.guildOnly && !interaction.guild) {
        await safeReply(interaction, {
          content: "This command can only be used inside a server.",
          ephemeral: true,
        });
        return;
      }
      if (command.permissionKey) {
        const authorized = await isAuthorized(interaction, command.permissionKey);
        if (!authorized) {
          await safeReply(interaction, {
            content: "You don't have permission to use this.",
            ephemeral: true,
          });
          return;
        }
      }
      try {
        await command.execute(interaction);
        void logCommandUsage(interaction);
      } catch (err) {
        logger.error(`Error executing context menu "${interaction.commandName}":`, err);
        await replyWithError(interaction);
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName) as Command | undefined;
    if (!command) {
      logger.warn(`Unknown command received: ${interaction.commandName}`);
      return;
    }
    if (command.guildOnly && !interaction.guild) {
      await safeReply(interaction, {
        content: "This command can only be used inside a server.",
        ephemeral: true,
      });
      return;
    }
    if (command.permissionKey) {
      const authorized = await isAuthorized(interaction, command.permissionKey);
      if (!authorized) {
        await safeReply(interaction, {
          content: "You don't have permission to use this command.",
          ephemeral: true,
        });
        return;
      }
    }
    try {
      await command.execute(interaction);
      void logCommandUsage(interaction);
    } catch (err) {
      logger.error(`Error executing /${interaction.commandName}:`, err);
      await replyWithError(interaction);
    }
  },
};
export default event;