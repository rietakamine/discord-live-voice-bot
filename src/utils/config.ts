import fs from "node:fs";
import path from "node:path";

interface Credentials {
  token: string;
  clientId: string;
  guildId?: string;
  mongoUri: string;
  web: { port: number; publicUrl: string };
  keepAlive: { enabled: boolean; port: number };
}
interface CredentialsFile {
  token?: string;
  clientId?: string;
  guildId?: string;
  mongoUri?: string;
  web?: { port?: number; publicUrl?: string };
  keepAlive?: { enabled?: boolean; port?: number };
}
function readCredentialsFile(): CredentialsFile {
  const credentialsPath = path.join(__dirname, "..", "..", "config", "credentials.json");
  if (!fs.existsSync(credentialsPath)) return {};
  return JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
}
const file = readCredentialsFile();

const resolvedWebPort =
  Number(process.env.PORT) || file.web?.port || 3000;
const config: Credentials = {
  token: process.env.DISCORD_TOKEN ?? file.token ?? "",
  clientId: process.env.DISCORD_CLIENT_ID ?? file.clientId ?? "",
  guildId: process.env.DISCORD_GUILD_ID ?? file.guildId,
  mongoUri: process.env.MONGO_URI ?? file.mongoUri ?? "",
  web: {
    port: resolvedWebPort,
    publicUrl: process.env.PUBLIC_URL ?? file.web?.publicUrl ?? `http://localhost:${resolvedWebPort}`,
  },
  keepAlive: {
    enabled: process.env.KEEP_ALIVE_ENABLED
      ? process.env.KEEP_ALIVE_ENABLED === "true"
      : file.keepAlive?.enabled ?? false,
    port: Number(process.env.KEEP_ALIVE_PORT) || file.keepAlive?.port || 8080,
  },
};
const required: (keyof Pick<Credentials, "token" | "clientId" | "mongoUri">)[] = [
  "token",
  "clientId",
  "mongoUri",
];
const missing = required.filter((key) => !config[key]);
if (missing.length > 0) {
  throw new Error(
    `Missing required config: ${missing.join(", ")}. Set these as environment variables ` +
      `(DISCORD_TOKEN, DISCORD_CLIENT_ID, MONGO_URI) or fill them in config/credentials.json.`
  );
}
export default config;