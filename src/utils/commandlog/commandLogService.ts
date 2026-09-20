import {
  ApplicationCommandType,
  ChatInputCommandInteraction,
  CommandInteractionOption,
  ContextMenuCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { getConfig } from "./commandLogConfigCache";
import { logger } from "../logger";

const LOG_EMBED_COLOR = 0x5865f2;

const MAX_OPTION_VALUE_LENGTH = 100;
const MAX_USAGE_TEXT_LENGTH = 1000;

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function collectLeafOptions(
  options: readonly CommandInteractionOption[]
): CommandInteractionOption[] {
  return options.flatMap((opt) => (opt.options ? collectLeafOptions(opt.options) : [opt]));
}
function formatChatInputUsage(interaction: ChatInputCommandInteraction): string {
  const parts = [interaction.commandName];
  const group = interaction.options.getSubcommandGroup(false);
  if (group) parts.push(group);
  const sub = interaction.options.getSubcommand(false);
  if (sub) parts.push(sub);
  const optionText = collectLeafOptions(interaction.options.data)
    .filter((opt) => opt.value !== undefined)
    .map((opt) => `${opt.name}:${truncate(String(opt.value), MAX_OPTION_VALUE_LENGTH)}`)
    .join(" ");
  const commandText = `/${parts.join(" ")}`;
  const fullText = optionText ? `${commandText} ${optionText}` : commandText;
  return truncate(fullText, MAX_USAGE_TEXT_LENGTH);
}

function formatContextMenuUsage(interaction: ContextMenuCommandInteraction): string {
  const kind = interaction.commandType === ApplicationCommandType.User ? "User" : "Message";
  return `${interaction.commandName} (${kind} command, target: ${interaction.targetId})`;
}

export async function logCommandUsage(
  interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction
): Promise<void> {
  if (!interaction.inGuild()) return;
  const config = await getConfig(interaction.guildId);
  if (!config) return;
  const usageText = interaction.isChatInputCommand()
    ? formatChatInputUsage(interaction)
    : formatContextMenuUsage(interaction);
  const embed = new EmbedBuilder()
    .setColor(LOG_EMBED_COLOR)
    .addFields(
      { name: "User", value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
      { name: "Command", value: `\`${usageText}\``, inline: true },
      { name: "Channel", value: interaction.channelId ? `<#${interaction.channelId}>` : "Unknown", inline: true }
    )
    .setTimestamp();

  try {
    const destChannel = await interaction.guild?.channels.fetch(config.channelId).catch(() => null);
    if (!destChannel || !destChannel.isTextBased()) return;
    await destChannel.send({ embeds: [embed] });
  } catch (err) {
    logger.error(`[commandlog] Failed to send command-usage log for guild ${interaction.guildId}`, err);
  }
}