import {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  MessageActionRowComponentBuilder,
} from "discord.js";

export interface EmbedOptions {
  title?: string;
  description?: string;
  color?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  footer?: string;
}
export function createEmbed(options: EmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder();
  if (options.title) embed.setTitle(options.title);
  if (options.description) embed.setDescription(options.description);
  if (options.color) embed.setColor(options.color as `#${string}`);
  if (options.thumbnailUrl) embed.setThumbnail(options.thumbnailUrl);
  if (options.imageUrl) embed.setImage(options.imageUrl);
  if (options.footer) embed.setFooter({ text: options.footer });
  return embed;
}
export interface ButtonOptions {
  customId: string;
  label?: string;
  style?: "Primary" | "Secondary" | "Success" | "Danger";
  emoji?: string;
  disabled?: boolean;
}
export function createButton(options: ButtonOptions): ButtonBuilder {
  if (!options.label && !options.emoji) {
    throw new Error("createButton: provide a label, an emoji, or both");
  }
  const button = new ButtonBuilder()
    .setCustomId(options.customId)
    .setStyle(ButtonStyle[options.style ?? "Primary"]);
  if (options.label) button.setLabel(options.label);
  if (options.emoji) button.setEmoji(options.emoji);
  if (options.disabled) button.setDisabled(true);
  return button;
}
export interface SelectMenuOption {
  label: string;
  value: string;
  description?: string;
  emoji?: string;
}
export interface SelectMenuOptions {
  customId: string;
  placeholder?: string;
  options: SelectMenuOption[];
}
export function createSelectMenu(options: SelectMenuOptions): StringSelectMenuBuilder {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(options.customId)
    .addOptions(
      options.options.map((opt) => {
        const built = new StringSelectMenuOptionBuilder().setLabel(opt.label).setValue(opt.value);
        if (opt.description) built.setDescription(opt.description);
        if (opt.emoji) built.setEmoji(opt.emoji);
        return built;
      })
    );
  if (options.placeholder) menu.setPlaceholder(options.placeholder);
  return menu;
}
export function chunkButtonsIntoRows(
  buttons: ButtonBuilder[],
  perRow = 5
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  for (let i = 0; i < buttons.length && rows.length < 5; i += perRow) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        buttons.slice(i, i + perRow)
      )
    );
  }
  return rows;
}