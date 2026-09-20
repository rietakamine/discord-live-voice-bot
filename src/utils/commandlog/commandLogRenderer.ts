import {
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  MessageActionRowComponentBuilder,
} from "discord.js";
import { createEmbed } from "../builders";
import { CommandLogWizardData } from "./commandLogWizard";

export function setupStep(sessionId: string, data: CommandLogWizardData) {
  const embed = createEmbed({
    title: "Command Log Setup",
    description: [
      "Select a log channel (required), and optionally exclude roles and/or users from being logged. Hit **Save** when you're done.",
      "",
      `**Channel:** ${data.channelId ? `<#${data.channelId}>` : "*Not selected yet*"}`,
      `**Excluded roles:** ${
        data.excludedRoleIds?.length ? data.excludedRoleIds.map((id) => `<@&${id}>`).join(", ") : "None"
      }`,
      `**Excluded users:** ${
        data.excludedUserIds?.length ? data.excludedUserIds.map((id) => `<@${id}>`).join(", ") : "None"
      }`,
    ].join("\n"),
    color: "#5865F2",
  });
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`commandlog-setup:channel:${sessionId}`)
    .setPlaceholder("Select the log channel...")
    .addChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);
  if (data.channelId) channelSelect.setDefaultChannels(data.channelId);
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`commandlog-setup:exclude-roles:${sessionId}`)
    .setPlaceholder("Select role(s) to exclude (optional)...")
    .setMinValues(0)
    .setMaxValues(25);
  if (data.excludedRoleIds?.length) roleSelect.setDefaultRoles(...data.excludedRoleIds);
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId(`commandlog-setup:exclude-users:${sessionId}`)
    .setPlaceholder("Select user(s) to exclude (optional)...")
    .setMinValues(0)
    .setMaxValues(25);
  if (data.excludedUserIds?.length) userSelect.setDefaultUsers(...data.excludedUserIds);

  const saveButton = new ButtonBuilder()
    .setCustomId(`commandlog-setup:save:${sessionId}`)
    .setLabel("Save")
    .setStyle(ButtonStyle.Success);
  const cancelButton = new ButtonBuilder()
    .setCustomId(`commandlog-setup:cancel:${sessionId}`)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelSelect),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect),
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(saveButton, cancelButton),
    ],
  };
}
export function summaryEmbed(data: CommandLogWizardData): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("✅ Command log setup complete")
    .setColor("#57F287")
    .addFields(
      { name: "Log channel", value: data.channelId ? `<#${data.channelId}>` : "None", inline: true },
      {
        name: "Excluded roles",
        value: data.excludedRoleIds?.length ? data.excludedRoleIds.map((id) => `<@&${id}>`).join(", ") : "None",
        inline: true,
      },
      {
        name: "Excluded users",
        value: data.excludedUserIds?.length ? data.excludedUserIds.map((id) => `<@${id}>`).join(", ") : "None",
        inline: true,
      }
    )
    .setFooter({ text: "Run /command-log-setup again any time to change these settings." });
}