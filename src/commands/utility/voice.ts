import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { Command } from "../../types";
import config from "../../utils/config";
import { createEmbed } from "../../utils/builders";
import { respond } from "../../utils/discordHelpers";
import { getSession, joinVoice, leaveVoice } from "../../utils/voice/voiceService";
import { logger } from "../../utils/logger";

/** Absolute base URL of the web server, or null if none is configured. */
function publicBaseUrl(): string | null {
  const candidates = [config.web.publicUrl, process.env.RENDER_EXTERNAL_URL];
  for (const raw of candidates) {
    const value = raw?.trim();
    if (!value) continue;
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return withScheme.replace(/\/+$/, "");
  }
  return null;
}

function sessionUrl(token: string): string | null {
  const base = publicBaseUrl();
  return base ? `${base}/voice/${token}` : null;
}

function linkPayload(url: string | null, channelName: string, title: string) {
  if (!url) {
    return {
      embeds: [
        createEmbed({
          title,
          description:
            `Connected to **${channelName}**, but I don't know this bot's public web address, ` +
            `so I can't build the link. Set the web \`publicUrl\` setting (for example ` +
            `\`https://your-app.onrender.com\`) and run \`/voice link\`.`,
          color: "#FEE75C",
        }),
      ],
      components: [],
    };
  }
  return {
    embeds: [
      createEmbed({
        title,
        description:
          `Connected to **${channelName}**.\n` +
          `Open the [voice page](${url}) to talk through the bot or play audio files.\n\n` +
          `Anyone with this link can speak and play audio through the bot, so keep it private. ` +
          `It stops working when the bot leaves.`,
        color: "#57F287",
      }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel("Open voice page").setStyle(ButtonStyle.Link).setURL(url)
      ),
    ],
  };
}

function errorEmbed(title: string, description: string) {
  return { embeds: [createEmbed({ title, description, color: "#ED4245" })] };
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("voice")
    .setDescription("Speak or play audio in a voice channel through the bot")
    .addSubcommand((sub) =>
      sub
        .setName("join")
        .setDescription("Join a voice channel and get a web page to speak through the bot")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Voice channel to join (defaults to the one you're in)")
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("leave").setDescription("Leave the voice channel and close the web page")
    )
    .addSubcommand((sub) =>
      sub.setName("link").setDescription("Show the web page link again")
    ),
  guildOnly: true,
  permissionKey: "voice-bridge",
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();

    if (sub === "leave") {
      const left = leaveVoice(interaction.guild.id);
      await interaction.reply({
        embeds: [
          createEmbed({
            title: left ? "Left the voice channel" : "Not in a voice channel",
            description: left
              ? "The voice page link is now closed."
              : "Use `/voice join` to bring me into one.",
            color: left ? "#57F287" : "#FEE75C",
          }),
        ],
        ephemeral: true,
      });
      return;
    }

    if (sub === "link") {
      const session = getSession(interaction.guild.id);
      if (!session) {
        await interaction.reply({
          ...errorEmbed("Not in a voice channel", "Use `/voice join` first."),
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        ...linkPayload(sessionUrl(session.token), session.channelName, "Voice page"),
        ephemeral: true,
      });
      return;
    }

    // ---- join ----
    const picked = interaction.options.getChannel("channel");
    const channel = picked
      ? await interaction.guild.channels.fetch(picked.id).catch(() => null)
      : interaction.member.voice.channel;
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      await interaction.reply({
        ...errorEmbed(
          "No voice channel",
          "Pick a voice channel in the `channel` option, or join one first."
        ),
        ephemeral: true,
      });
      return;
    }

    const me = interaction.guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (
      !perms?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ])
    ) {
      await interaction.reply({
        ...errorEmbed(
          "Missing permission",
          `I need View Channel, Connect and Speak in ${channel}.`
        ),
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    let session;
    try {
      session = await joinVoice(interaction.guild, channel, interaction.user.id);
    } catch (err) {
      logger.error(`voice: failed to join ${channel.id} in guild ${interaction.guild.id}:`, err);
      await respond(
        interaction,
        errorEmbed(
          "Couldn't join",
          `I couldn't connect to ${channel} in time. Check my permissions and try again.`
        )
      );
      return;
    }
    await respond(
      interaction,
      linkPayload(sessionUrl(session.token), channel.name, "Voice bridge is live")
    );
  },
};

export default command;