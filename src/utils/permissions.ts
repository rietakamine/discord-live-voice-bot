import { Client, Guild, GuildMember, APIInteractionGuildMember, User } from "discord.js";
import CommandPermission from "../models/commandPermission";

export interface PermissionCheckable {
  guild: Guild | null;
  member: GuildMember | APIInteractionGuildMember | null;
  user: User;
}
export async function isAuthorized(
  interaction: PermissionCheckable,
  permissionKey: string
): Promise<boolean> {
  if (!interaction.guild || !interaction.member) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  const config = await CommandPermission.findOne({
    guildId: interaction.guild.id,
    permissionKey,
  });
  if (!config || config.roleIds.length === 0) return true;
  const member = interaction.member as GuildMember;
  return config.roleIds.some((roleId) => member.roles.cache.has(roleId));
}
export async function getGrantedRoleIds(
  guildId: string,
  permissionKey: string
): Promise<string[]> {
  const config = await CommandPermission.findOne({ guildId, permissionKey });
  return config?.roleIds ?? [];
}

export function getAllPermissionKeys(client: Client): string[] {
  return [...client.commands.values()]
    .map((c) => c.permissionKey)
    .filter((key): key is string => Boolean(key));
}

export async function syncPermissionKeysForGuild(
  guildId: string,
  permissionKeys: string[]
): Promise<void> {
  if (permissionKeys.length === 0) return;
  await CommandPermission.bulkWrite(
    permissionKeys.map((permissionKey) => ({
      updateOne: {
        filter: { guildId, permissionKey },
        update: { $setOnInsert: { guildId, permissionKey, roleIds: [] } },
        upsert: true,
      },
    }))
  );
}