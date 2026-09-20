import CommandLogConfig, { ICommandLogConfig } from "../../models/CommandLog/commandLogConfig";
import { logger } from "../logger";

const cache = new Map<string, ICommandLogConfig>();
export function setCachedConfig(guildId: string, config: ICommandLogConfig): void {
  cache.set(guildId, config);
}
export function getCachedConfig(guildId: string): ICommandLogConfig | undefined {
  return cache.get(guildId);
}
export function clearCachedConfig(guildId: string): void {
  cache.delete(guildId);
}

export async function getConfig(guildId: string): Promise<ICommandLogConfig | null> {
  const cached = cache.get(guildId);
  if (cached) return cached;

  try {
    const fromDb = await CommandLogConfig.findOne({ guildId });
    if (fromDb) cache.set(guildId, fromDb);
    return fromDb;
  } catch (err) {
    logger.error(`[commandlog] Failed to load config for guild ${guildId} from Mongo`, err);
    return null;
  }
}
export async function warmConfigCache(guildIds: string[]): Promise<void> {
  if (guildIds.length === 0) return;
  try {
    const configs = await CommandLogConfig.find({ guildId: { $in: guildIds } });
    for (const config of configs) {
      cache.set(config.guildId, config);
    }
    logger.info(`[commandlog] Warmed command-log config cache for ${configs.length} guild(s).`);
  } catch (err) {
    logger.error(
      "[commandlog] Failed to warm command-log config cache from Mongo — will fall back to per-guild lookups.",
      err
    );
  }
}