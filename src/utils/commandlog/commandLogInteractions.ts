import { MessageComponentInteraction } from "discord.js";
import { registerComponentHandler } from "../componentRouter";
import CommandLogConfig from "../../models/CommandLog/commandLogConfig";
import { setCachedConfig } from "./commandLogConfigCache";
import { getSession, updateSession, deleteSession } from "./commandLogWizard";
import { setupStep, summaryEmbed } from "./commandLogRenderer";

function sessionIdFrom(customId: string): string {
  return customId.split(":")[2];
}

async function expiredSession(interaction: MessageComponentInteraction) {
  await interaction.update({
    content: "This setup session expired. Run `/command-log-setup` again to restart.",
    embeds: [],
    components: [],
  });
}

registerComponentHandler("commandlog-setup:channel:", async (interaction: MessageComponentInteraction) => {
  if (!interaction.isChannelSelectMenu()) return;
  const sessionId = sessionIdFrom(interaction.customId);
  const session = getSession(sessionId);
  if (!session) return expiredSession(interaction);

  session.channelId = interaction.values[0];
  updateSession(sessionId, session);
  await interaction.update(setupStep(sessionId, session));
});

registerComponentHandler("commandlog-setup:exclude-roles:", async (interaction: MessageComponentInteraction) => {
  if (!interaction.isRoleSelectMenu()) return;
  const sessionId = sessionIdFrom(interaction.customId);
  const session = getSession(sessionId);
  if (!session) return expiredSession(interaction);

  session.excludedRoleIds = interaction.values;
  updateSession(sessionId, session);
  await interaction.update(setupStep(sessionId, session));
});

registerComponentHandler("commandlog-setup:exclude-users:", async (interaction: MessageComponentInteraction) => {
  if (!interaction.isUserSelectMenu()) return;
  const sessionId = sessionIdFrom(interaction.customId);
  const session = getSession(sessionId);
  if (!session) return expiredSession(interaction);

  session.excludedUserIds = interaction.values;
  updateSession(sessionId, session);
  await interaction.update(setupStep(sessionId, session));
});

registerComponentHandler("commandlog-setup:save:", async (interaction: MessageComponentInteraction) => {
  const sessionId = sessionIdFrom(interaction.customId);
  const session = getSession(sessionId);
  if (!session) return expiredSession(interaction);

  if (!session.channelId) {
    await interaction.reply({ content: "Select a log channel before saving.", ephemeral: true });
    return;
  }

  const saved = await CommandLogConfig.findOneAndUpdate(
    { guildId: session.guildId },
    {
      guildId: session.guildId,
      channelId: session.channelId,
      excludedRoleIds: session.excludedRoleIds ?? [],
      excludedUserIds: session.excludedUserIds ?? [],
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  setCachedConfig(session.guildId, saved);
  deleteSession(sessionId);

  await interaction.update({
    embeds: [summaryEmbed(session)],
    components: [],
  });
});

registerComponentHandler("commandlog-setup:cancel:", async (interaction: MessageComponentInteraction) => {
  const sessionId = sessionIdFrom(interaction.customId);
  deleteSession(sessionId);
  await interaction.update({
    content: "Command log setup cancelled — nothing was changed.",
    embeds: [],
    components: [],
  });
});