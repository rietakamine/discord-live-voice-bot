import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  ActionRowBuilder,
} from "discord.js";
import { Command } from "../../types";
import CommandPermission from "../../models/commandPermission";
import { respond } from "../../utils/discordHelpers";
import { createSession } from "../../utils/commandaccess/commandAccessWizard";
import { CommandAccessSession } from "../../utils/commandaccess/commandAccessInteractions";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("set-command-access")
    .setDescription("Owner/Admin only: manage which roles can use restricted bot commands")
    .addSubcommand((sub) =>
      sub
        .setName("grant")
        .setDescription("Grant a role access to one or more commands")
        .addStringOption((opt) =>
          opt
            .setName("permission_keys")
            .setDescription("Command name(s), comma-separated")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("revoke")
        .setDescription("Revoke a role's access to one or more commands")
        .addStringOption((opt) =>
          opt
            .setName("permission_keys")
            .setDescription("Command name(s), comma-separated")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List access for one command, or every synced command")
        .addStringOption((opt) =>
          opt
            .setName("permission_key")
            .setDescription("Specific command name (omit to list all)")
            .setRequired(false)
            .setAutocomplete(true)
        )
    ),
  guildOnly: true,
  permissionKey: "set-command-access",
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return;
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    if (!isOwner && !isAdmin) {
      await interaction.reply({
        content: "Only the server owner or an Administrator can use this command.",
        ephemeral: true,
      });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    if (sub === "list") {
      const key = interaction.options.getString("permission_key");
      if (key) {
        const config = await CommandPermission.findOne({ guildId, permissionKey: key });
        const roles =
          config && config.roleIds.length > 0
            ? config.roleIds.map((id) => `<@&${id}>`).join(", ")
            : "*(open to everyone)*";
        await respond(interaction, {
          content: `Access for \`${key}\`: ${roles}`,
        });
        return;
      }

      const all = await CommandPermission.find({ guildId }).sort({ permissionKey: 1 });
      if (all.length === 0) {
        await respond(interaction, {
          content: "No commands have synced yet — try again once the bot has fully started.",
        });
        return;
      }

      const lines = all.map((c) => {
        const roles =
          c.roleIds.length > 0 ? c.roleIds.map((id) => `<@&${id}>`).join(", ") : "open";
        return `\`${c.permissionKey}\`: ${roles}`;
      });
      await respond(interaction, { content: lines.join("\n") });
      return;
    }
    const rawKeys = interaction.options.getString("permission_keys", true);
    const keys = [...new Set(rawKeys.split(",").map((k) => k.trim()).filter(Boolean))];
    const knownKeys = new Set([...interaction.client.commands.values()].map((c) => c.permissionKey));
    const unknownKeys = keys.filter((k) => !knownKeys.has(k));
    const validKeys = keys.filter((k) => knownKeys.has(k));
    if (validKeys.length === 0) {
      await respond(interaction, {
        content: `None of those match a currently loaded command: ${keys.join(", ")}`,
      });
      return;
    }
    const session: CommandAccessSession = {
      guildId,
      sub: sub as "grant" | "revoke",
      validKeys,
      unknownKeys,
      invokerId: interaction.user.id,
    };
    const sessionId = createSession(session);
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(`set-command-access-roles:${sessionId}`)
      .setPlaceholder("Select role(s)...")
      .setMinValues(1)
      .setMaxValues(25);
    await respond(interaction, {
      content: `Select the role(s) to ${sub === "grant" ? "grant access to" : "revoke access from"}: ${validKeys
        .map((k) => `\`${k}\``)
        .join(", ")}${
        unknownKeys.length > 0
          ? `\n⚠️ Skipped (no matching loaded command): ${unknownKeys.join(", ")}`
          : ""
      }`,
      components: [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect)],
    });
  },
  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "permission_keys" && focused.name !== "permission_key") return;
    const raw = String(focused.value);
    const parts = raw.split(",");
    const currentFragment = parts[parts.length - 1].trim().toLowerCase();
    const prefix = parts.slice(0, -1).join(",");
    const allKeys = [...new Set([...interaction.client.commands.values()].map((c) => c.permissionKey))].filter(
      (k): k is string => Boolean(k)
    );
    const matches = allKeys
      .filter((k) => k.toLowerCase().includes(currentFragment))
      .slice(0, 25);
    await interaction.respond(
      matches.map((k) => ({
        name: k,
        value: prefix ? `${prefix},${k}` : k,
      }))
    );
  },
};
export default command;