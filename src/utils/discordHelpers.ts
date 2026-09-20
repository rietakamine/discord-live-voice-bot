import {
  RepliableInteraction,
  InteractionReplyOptions,
  InteractionEditReplyOptions,
} from "discord.js";

export async function respond(
  interaction: RepliableInteraction,
  options: (InteractionReplyOptions | InteractionEditReplyOptions) & {
    content?: string;
  }
) {
  if (interaction.deferred || interaction.replied) {
    const { ephemeral: _ignored, ...editOptions } = options as any;
    return interaction.editReply(editOptions as InteractionEditReplyOptions);
  }
  return interaction.reply(options as InteractionReplyOptions);
}