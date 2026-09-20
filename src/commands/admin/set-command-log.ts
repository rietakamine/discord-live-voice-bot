import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { Command } from "../../types";
import { createSession } from "../../utils/commandlog/commandLogWizard";
import { setupStep } from "../../utils/commandlog/commandLogRenderer";
import { getConfig } from "../../utils/commandlog/commandLogConfigCache";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("set-command-log")
    .setDescription("Set up (or reconfigure) slash command / app command usage logging for this server"),

  guildOnly: true,
  permissionKey: "set-command-access",

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return;

    const existing = await getConfig(interaction.guild.id);
    const sessionData = {
      guildId: interaction.guild.id,
      channelId: existing?.channelId,
      excludedRoleIds: existing?.excludedRoleIds,
      excludedUserIds: existing?.excludedUserIds,
    };
    const sessionId = createSession(sessionData);

    await interaction.reply({
      ...setupStep(sessionId, sessionData),
      ephemeral: true,
    });
  },
};

export default command;