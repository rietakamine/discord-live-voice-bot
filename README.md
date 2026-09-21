# discord-voice-bot (TypeScript + discord.js)

A Discord bot that bridges a voice channel to a web page — anyone with the
link can speak into (and play audio files into) the channel through the
bot's browser mic/upload — plus a small admin toolkit: per-command role
permissions and a slash-command usage log.

## Folder structure

```
│   .gitignore
│   package.json
│   README.md
│   tsconfig.json
│
├───config
│       credentials.json        (gitignored — you create this, or use env vars)
│
├───scripts
│       copy-assets.ts          # copies src/web/public into dist/ during build
│       deploy-commands.ts      # registers slash commands with Discord
│
└───src
    │   index.ts                # entry point: client, intents, startup sequence
    │   keepAlive.ts            # optional tiny "I'm alive" HTTP server
    │
    ├───commands
    │   ├───admin
    │   │       set-command-access.ts   # /set-command-access
    │   │       set-command-log.ts      # /set-command-log
    │   │
    │   └───utility
    │           ping.ts                 # /ping
    │           voice.ts                # /voice join|leave|link
    │
    ├───events
    │       clientReady.ts       # syncs permission keys on startup
    │       interactionCreate.ts # routes slash commands, buttons, selects
    │
    ├───models
    │   │   commandPermission.ts
    │   │
    │   └───CommandLog
    │           commandLogConfig.ts
    │
    ├───types
    │       index.ts
    │
    ├───utils
    │   │   builders.ts             # reusable embed/button/select-menu helpers
    │   │   commandRegistry.ts      # walks src/commands for deploy-commands.ts
    │   │   componentRouter.ts      # prefix-based routing for buttons/selects/modals
    │   │   config.ts               # env vars / config/credentials.json loader
    │   │   database.ts             # mongoose connection
    │   │   discordHelpers.ts
    │   │   duration.ts
    │   │   loadCommands.ts         # walks src/commands, registers with the client
    │   │   loadEvents.ts           # walks src/events, binds to the client
    │   │   logger.ts
    │   │   permissions.ts          # CommandPermission-backed access checks
    │   │   registerFeatureHandlers.ts  # wires up button/select handlers
    │   │
    │   ├───commandaccess
    │   │       commandAccessInteractions.ts
    │   │       commandAccessWizard.ts
    │   │
    │   ├───commandlog
    │   │       commandLogConfigCache.ts
    │   │       commandLogInteractions.ts
    │   │       commandLogRenderer.ts
    │   │       commandLogService.ts
    │   │       commandLogWizard.ts
    │   │
    │   └───voice
    │           audioMixer.ts       # mixes mic input + uploaded tracks into one Opus stream
    │           voiceListener.ts    # receives + decodes incoming Discord voice audio
    │           voiceService.ts     # join/leave a channel, track active sessions
    │           voiceWeb.ts         # HTTP + WebSocket bridge for the browser page
    │
    └───web
        │   server.ts              # Express app: mounts the voice bridge routes
        │
        └───public
                voice.html          # the browser page opened via /voice join|link
```

## Features

### Voice bridge (`/voice`)

`/voice join [channel]` connects the bot to a voice channel and replies with
a private link to a web page (`voice.html`). Anyone with that link can, from
their browser, speak through the bot's mic and queue audio files to play —
`voiceWeb.ts` handles the HTTP/WebSocket side, `voiceService.ts` owns the
`@discordjs/voice` connection and session state, `audioMixer.ts` mixes the
live mic input with queued tracks into a single Opus stream, and
`voiceListener.ts` decodes what's coming back from Discord. `/voice link`
re-sends the link, `/voice leave` disconnects and invalidates it.

The link only works while `web.publicUrl` (see Credentials below) is set to
the bot's actual public address, and only while that voice session is
active — leaving the channel closes the page.

### Per-command role permissions

`src/models/commandPermission.ts` + `src/utils/permissions.ts` let the
**server owner** (always authorized, unconditionally) grant specific staff
roles access to specific restricted commands — without touching Discord's
own permission system, which matters if staff roles don't have "Manage
Server".

Any command opts in by setting `permissionKey` on its `Command` object:

```ts
const command: Command = {
  data: new SlashCommandBuilder().setName("voice")...,
  guildOnly: true,
  permissionKey: "voice-bridge", // <- gates this command
  async execute(interaction) { ... },
};
```

`interactionCreate.ts` checks this automatically before running the
command — no other wiring needed. `clientReady.ts` also makes sure every
command's `permissionKey` has a row in the database for each guild on
startup, so `/set-command-access` always has something to list. The owner
manages access with:

```
/set-command-access action:Grant permission_key:voice-bridge role:@Support Staff
/set-command-access action:List permission_key:voice-bridge
/set-command-access action:Revoke permission_key:voice-bridge role:@Support Staff
```

`set-command-access` itself is always owner-only, hardcoded — it's the one
fixed authority the rest of the system bootstraps from.

### Command usage log (`/set-command-log`)

Run `/set-command-log` to pick a channel (and optionally exclude some
roles/users) where every slash/context-menu command run in the server gets
logged as an embed — who ran what, with what options, and when.
`commandLogService.ts` builds and posts the embed, `commandLogConfigCache.ts`
caches the per-guild config so every command run doesn't hit the database,
and `commandLogWizard.ts` / `commandLogRenderer.ts` / `commandLogInteractions.ts`
run the multi-step setup UI behind the command.

### Keep-alive

`src/keepAlive.ts` runs a second, separate tiny HTTP server (off by default;
see `KEEP_ALIVE_ENABLED` below) that just returns `200 OK`. Point an uptime
pinger (UptimeRobot, cron-job.org) at it if you're hosting on a platform
that spins down idle processes (Replit, Glitch, etc.). Not needed on a
VPS/Docker host that runs the process persistently.

## Adding a new command

1. Add a `.ts` file under `src/commands/<group>/` (an existing group, or a
   new one for a new feature area).
2. Default-export an object matching the `Command` interface in
   `src/types/index.ts` — a `data` (`SlashCommandBuilder`) and an
   `execute(interaction)` function. Use `ping.ts` or `voice.ts` as a
   reference.
3. Nothing else to register — `loadCommands.ts` walks every subfolder of
   `src/commands` automatically.
4. Run `npm run deploy-commands` to push the new slash command to Discord.

## Adding a new event

1. Add a `.ts` file in `src/events/` that default-exports an object
   matching the `BotEvent` interface in `src/types/index.ts` — a `name`
   (any discord.js `Client` event name) and an `execute(...args)` function.
2. `loadEvents.ts` binds it automatically on startup.

## Adding buttons/selects/modals

Register a handler with `registerComponentHandler` / `registerModalHandler`
from `src/utils/componentRouter.ts`, keyed by a `custom_id` prefix (see
`commandAccessInteractions.ts` or `commandLogInteractions.ts` for examples),
then import that file once from `src/utils/registerFeatureHandlers.ts` so
the side-effecting registration actually runs.

## Slash command deploy modes & new-server syncing

`npm run deploy-commands` deploys **globally** by default — every server
the bot is already in, and every server it joins *later*, gets the current
command set automatically. No extra code is needed for new servers; Discord
stores global commands at the application level, not per-server.

For fast iteration while developing, deploy to just one test server instead:

```bash
npm run deploy-commands -- --guild YOUR_TEST_GUILD_ID
```

Guild-scoped commands update instantly (no propagation wait) but only exist
in that one server. **Don't run both modes for the same command names on
the same server** — global and guild commands are separate lists, so you'd
end up with duplicate entries (two `/ping`s, etc).

## Setup

```bash
npm install
# edit config/credentials.json with your real bot token, client id,
# a test guild id, and your MongoDB connection string
# (or set DISCORD_TOKEN / DISCORD_CLIENT_ID / MONGO_URI as env vars instead)

npm run deploy-commands   # registers slash commands globally
npm run dev                # start in dev mode with auto-restart
```

For production:

```bash
npm run build
npm start
```

## Required Discord Developer Portal settings

The bot needs the **Server Members Intent** enabled (Developer Portal →
your app → Bot → Privileged Gateway Intents), since `GuildMembers` is one
of the gateway intents requested in `src/index.ts` (used to resolve display
names for the voice bridge). `Message Content` and `Presence` intents are
**not** requested and don't need to be enabled.

## Credentials — env vars on a host, JSON file on localhost, no dotenv

`src/utils/config.ts` checks environment variables first, then falls back
to `config/credentials.json`. No `dotenv` dependency is used or needed:

- **Localhost**: you won't have these env vars set, so it reads
  `config/credentials.json` (gitignored). Nothing to change for local dev.
- **A host with an env var dashboard (Render, Railway, etc.)**: set the
  variables below directly there. `config/credentials.json` never needs to
  exist in the deployed container, and no secret is ever committed to git.

| Env var | Required | Notes |
|---|---|---|
| `DISCORD_TOKEN` | yes | bot token |
| `DISCORD_CLIENT_ID` | yes | application/client id |
| `DISCORD_GUILD_ID` | no | only used by `deploy-commands --guild` |
| `MONGO_URI` | yes | MongoDB connection string |
| `PUBLIC_URL` | no | public URL for the `/voice` bridge links, e.g. `https://your-app.onrender.com` — required for `/voice join`'s link to work once deployed |
| `PORT` | no | the web server (voice bridge) binds to this; most hosts set it automatically |
| `KEEP_ALIVE_ENABLED` | no | `"true"`/`"false"` — leave off/false on hosts that don't sleep |
| `KEEP_ALIVE_PORT` | no | only relevant if `KEEP_ALIVE_ENABLED` is true |

**If the build fails with `tsc: not found` or `ts-node: not found`:** some
hosts set `NODE_ENV=production` during the build phase, which makes `npm
install` skip `devDependencies` (that's where `typescript` and `ts-node`
live, and the `postinstall` build step needs them). Fix: set
`NPM_CONFIG_PRODUCTION=false` for the build step.
