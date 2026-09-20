import { REST, Routes } from "discord.js";
import { getCommandsJSON } from "../src/utils/commandRegistry";

async function main() {
  if (process.env.SKIP_DEPLOY === "true") {
    console.log("SKIP_DEPLOY=true — skipping automatic slash command deploy.");
    return;
  }
  let config: typeof import("../src/utils/config").default;
  try {
    config = require("../src/utils/config").default;
  } catch (err) {
    console.warn(
      "Skipping automatic slash command deploy — credentials aren't configured yet.\n" +
        "Run `npm run deploy-commands` manually once DISCORD_TOKEN / DISCORD_CLIENT_ID / MONGO_URI are set."
    );
    return;
  }
  const commands = getCommandsJSON();
  const rest = new REST().setToken(config.token);
  const guildFlagIndex = process.argv.indexOf("--guild");
  const devGuildId = guildFlagIndex !== -1 ? process.argv[guildFlagIndex + 1] : undefined;
  if (devGuildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, devGuildId), {
      body: commands,
    });
    console.log(
      `Deployed ${commands.length} command(s) to guild ${devGuildId} only (instant, dev mode).`
    );
  } else {
    let body: unknown[] = commands;
    try {
      const existing = (await rest.get(
        Routes.applicationCommands(config.clientId)
      )) as { type?: number }[];
      const entryPointCommand = existing.find((cmd) => cmd.type === 4);
      if (entryPointCommand) {
        body = [...commands, entryPointCommand];
      }
    } catch (err) {
      console.warn(
        "Could not fetch existing global commands to check for an Entry Point command:",
        (err as Error).message ?? err
      );
    }
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    console.log(
      `Deployed ${commands.length} command(s) globally${
        body.length > commands.length ? " (+ existing Entry Point command preserved)" : ""
      }. Already-joined AND future servers get these automatically.`
    );
  }
}
main().catch((err) => {
  console.error("Slash command deploy failed (non-fatal):", err.message ?? err);
});