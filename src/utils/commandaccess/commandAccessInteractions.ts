import { MessageComponentInteraction, PermissionFlagsBits } from "discord.js";
import CommandPermission from "../../models/commandPermission";
import { respond } from "../discordHelpers";
import { registerComponentHandler } from "../componentRouter";
import { getSession, deleteSession } from "./commandAccessWizard";

export interface CommandAccessSession {
  guildId: string;
  sub: "grant" | "revoke";
  validKeys: string[];
  unknownKeys: string[];
  invokerId: string;
}
function sessionIdFromCustomId(customId: string): string {
  return customId.split(":")[1] ?? "";
}
export async function handleCommandAccessRoleSelect(
  interaction: MessageComponentInteraction
): Promise<void> {
  if (!interaction.isRoleSelectMenu()) return;
  if (!interaction.guild) return;

  const sessionId = sessionIdFromCustomId(interaction.customId);
  const session = getSession<CommandAccessSession>(sessionId);
  if (!session || session.guildId !== interaction.guild.id) {
    await interaction.update({
      content: "This selection has expired — run the command again.",
      components: [],
    });
    return;
  }

  const isOwner = interaction.guild.ownerId === interaction.user.id;
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  if (session.invokerId !== interaction.user.id || (!isOwner && !isAdmin)) {
    await interaction.update({
      content: "Only the server owner or an Administrator can complete this.",
      components: [],
    });
    return;
  }
  await interaction.deferUpdate();
  const roleIds = interaction.values;
  const { guildId, sub, validKeys, unknownKeys } = session;
  if (sub === "grant") {
    await CommandPermission.bulkWrite(
      validKeys.flatMap((permissionKey) =>
        roleIds.map((roleId) => ({
          updateOne: {
            filter: { guildId, permissionKey },
            update: {
              $addToSet: { roleIds: roleId },
              $setOnInsert: { guildId, permissionKey },
            },
            upsert: true,
          },
        }))
      )
    );
  } else {
    await CommandPermission.bulkWrite(
      validKeys.flatMap((permissionKey) =>
        roleIds.map((roleId) => ({
          updateOne: {
            filter: { guildId, permissionKey },
            update: { $pull: { roleIds: roleId } },
          },
        }))
      )
    );
  }
  deleteSession(sessionId);
  const verb = sub === "grant" ? "Granted" : "Revoked";
  const roleMentions = roleIds.map((id) => `<@&${id}>`).join(", ");
  let reply = `✅ ${verb} ${roleMentions} access ${
    sub === "grant" ? "to" : "for"
  }: ${validKeys.map((k) => `\`${k}\``).join(", ")}`;
  if (unknownKeys.length > 0) {
    reply += `\n⚠️ Skipped earlier (no matching loaded command): ${unknownKeys.join(", ")}`;
  }
  await respond(interaction, { content: reply, components: [] });
}
// ---------- self-registration with the shared component/modal router ----------
registerComponentHandler("set-command-access-roles:", handleCommandAccessRoleSelect);