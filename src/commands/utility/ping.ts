import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { Command } from "../../types";
import { createEmbed } from "../../utils/builders";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check the bot's latency"),
  permissionKey: "bot-tools",
  async execute(interaction: ChatInputCommandInteraction) {
    const sent = await interaction.reply({
      content: "Pinging...",
      fetchReply: true,
    });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;

    const embed = createEmbed({
      title: "🏓 Pong!",
      description: `Latency: ${latency}ms | API: ${Math.round(
        interaction.client.ws.ping
      )}ms`,
      color: "#57F287",
    });

    await interaction.editReply({ content: null, embeds: [embed] });
  },
};

export default command;
