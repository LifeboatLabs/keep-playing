# Keep Playing

**A free, open-source server that answers PlayFab calls.** PlayFab is the Microsoft service that many games use for sign-ins, saves, shops, leaderboards and server-side scripts. Keep Playing runs on your own computer and answers those calls itself, so you can:

- **test a game offline** without touching your live PlayFab title;
- **give players a way to keep playing** when a game's online services shut down.

It needs nothing but [Node.js](https://nodejs.org/) 22 or newer. There's nothing to install from npm and no database to set up.

> Keep Playing is not made by, or affiliated with, Microsoft. PlayFab is a trademark of Microsoft.

## Where it's up to

This is an early version (0.1).

- **It answers 315 of the 797 calls** that Microsoft still lists. [COVERAGE.md](COVERAGE.md) lists which ones.
- **Every answer is checked against Microsoft's own description** of that call: the field names, the types, the required fields and the allowed values. The tests check almost 400 answers this way, and they try every call that Keep Playing answers. They also make the same checks as the test page in Microsoft's own JavaScript SDK.
- **It hasn't been tried with a real game yet.** If you make games or mods with PlayFab, please try it and [tell us what broke](https://github.com/LifeboatLabs/keep-playing/issues).

## Why

When the company behind a game's online services goes, the game often goes with it. When Amazon closed GameSparks in 2022, [Killer Queen Black shut down](https://gamedeveloper.com/pc/-i-killer-queen-black-i-will-shut-down-in-november-confirms-liquid-bit) because of it. Fans now rebuild these services one game at a time, like [this replacement for the PlayFab features in Overkill's The Walking Dead](https://modworkshop.net/mod/55794). And a law isn't coming soon: in June 2026 the European Commission [decided not to propose one](https://citizens-initiative.europa.eu/news/european-commission-replies-stop-destroying-videogames-initiative-2026-06-16_en).

One shared, open replacement means a shutdown doesn't have to be the end. Studios can hand it to players when they close a game, and communities don't have to start from nothing.

## Try it

1. Install [Node.js](https://nodejs.org/) 22 or newer.
2. Download this project, open a terminal in its folder, and run:

   ```
   node server.js --title title-example
   ```

3. Sign in a player, the way a game would:

   ```
   curl -X POST http://localhost:8080/Client/LoginWithCustomID -H "Content-Type: application/json" -d "{\"TitleId\":\"1A2B3\",\"CustomId\":\"me\",\"CreateAccount\":true}"
   ```

Open http://localhost:8080 in a browser to see how many players there are and which calls the game has made. Keep Playing also prints a note for each call it can't answer yet, so you can see straight away what your game needs.

Options: `--port 9000`, `--data ./saves` (where players are kept, `./data` by default), `--verbose` (show every call), and `--host 0.0.0.0` (let other computers on your network connect; by default only your own computer can).

## Point your game at it

Every PlayFab SDK lets you change the address it calls. If the address starts with `http`, the SDK uses it as it is:

| SDK | Setting |
|---|---|
| Unity | `PlayFabSettings.staticSettings.ProductionEnvironmentUrl = "http://localhost:8080";` |
| C# | `PlayFabSettings.staticSettings.ProductionEnvironmentUrl = "http://localhost:8080";` |
| JavaScript (browser) | `PlayFab.settings.productionServerUrl = "http://localhost:8080";` |
| Node.js | `PlayFab.settings.productionUrl = "http://localhost:8080";` |

Game servers and tools that use the Server or Admin calls need the secret key. Keep Playing makes one the first time it starts and keeps it in `data/keys.json`.

## Your game's settings

Put the game's settings in a folder and start the server with `--title that-folder`. [title-example](title-example) shows every file. They're all optional:

| File | What's in it |
|---|---|
| `title.json` | The title ID, the game's name, extra secret keys and a few switches (below) |
| `title-data.json` | Title data: the key/value settings the whole game reads |
| `title-internal-data.json` | Title data that only servers can read |
| `catalog.json` or `catalogs/*.json` | Items, in PlayFab's own catalog export format |
| `stores.json` | Stores and their prices |
| `currencies.json` | Virtual currencies, with starting amounts and recharge rates |
| `statistics.json` | Statistics: how values combine (Last, Min, Max, Sum) and when they reset |
| `cloudscript.js` or `cloudscript/*.js` | The game's classic CloudScript |
| `news.json` | Title news |

The folder is read every time the server starts, and what's in it is put in place. Changes made while the server was running are kept: title data set by the game's server, statistic versions, and earlier CloudScript revisions.

Switches in `title.json` → `settings`:

- `allowClientStatistics` (default `true`): let players post their own statistics. PlayFab's own default is `false`.
- `allowClientCurrency` (default `false`): let players add or take away their own currency.
- `checkRequiredFields` (default `true`): refuse calls that leave out a required field, like PlayFab does.
- `acceptAnySecretKey` (default `false`): for old game servers that have a secret key built in that nobody knows any more.
- `openServerCalls` (default none): Server calls the game itself makes without a working key, like `["/Server/WritePlayerEvent"]`. This is safer than `acceptAnySecretKey`, because the Admin calls stay locked.
- `createAccountsOnLogin` (default `false`): make an account when a game signs in with a new ID but leaves out `CreateAccount`. Old games often do this, because their players already had accounts.
- `cloudScriptTimeoutMs` (default `10000`): how long a CloudScript function may run.

## What works

- **Signing in**: custom IDs, Android and iOS device IDs, usernames and email addresses with passwords, Steam, Apple, Game Center, Nintendo (Switch device and Nintendo account), Battle.net, Kongregate, Facebook Instant Games, OpenID Connect and server custom IDs. Also linking, unlinking, looking players up by any of these, session tickets and entity tokens.
- **Player data**: player data of every kind (normal, read-only, internal and publisher), with public and private keys and data versions.
- **Title data**: title data, internal title data and publisher data.
- **Accounts**: account info, profiles, combined info, display names, avatars, contact emails, tags, bans, custom properties and generic IDs.
- **Friends**: friends, friend tags and friend leaderboards.
- **Shared groups**: small groups of players who share data, with public and private keys.
- **Statistics**: player statistics with Last, Min, Max and Sum, and hourly, daily, weekly and monthly resets. Also classic leaderboards, including the leaderboard around a player.
- **Economy**: the classic economy, with catalogs, stores, bundles, containers and keys, consumable and stackable items, and virtual currency that recharges.
- **Characters**: the classic characters a player can have, each with its own data, statistics, leaderboards, items and currency. Buying an item straight into a character's inventory doesn't work yet.
- **CloudScript**: classic CloudScript, with `handlers`, `server.*`, `entity.*`, `log`, revisions and time limits.
- **Entities**: entity objects and entity profiles.
- **Files**: entity files, like save games. Uploads and downloads go to Keep Playing instead of Microsoft's storage, and the files are kept in the `files` folder inside your data folder.
- **Events**: PlayStream and telemetry events. They're accepted and counted, and never sent anywhere.

## What doesn't work yet

These are the big gaps, roughly in the order we'll work on them:

- matchmaking and lobbies;
- the newer economy (Catalog and Inventory), the newer leaderboards and statistics, and groups;
- CloudScript that runs on Azure Functions;
- multiplayer servers and Party;
- drop tables, web requests from CloudScript, and push notifications;
- signing in with Google, Facebook, Xbox, PlayStation or Twitch. Their tokens can only be checked by those companies, so there's no player ID to read from them.

**Sign-ins aren't checked with Valve, Apple, Nintendo and the others.** Keep Playing reads the player's ID from what the game sends, which is fine on your own computer. Don't run a public server with these sign-ins until they're checked.

## Games

Settings folders for particular games live in [games](games):

- **[OVERKILL's The Walking Dead](games/otwd)**: the weekly quest, the wandering NPC and bounties. It's based on [HW12Dev's emulator](https://github.com/HW12Dev/OTWDPlayFabEmulator), and it hasn't been tried with the real game yet.

## When a game's servers shut down

Keep Playing is for games whose official servers are gone, or for studios planning what happens when they close a game. We keep to a few lines:

- **Only games whose official servers are gone.** This isn't a way around a live service.
- **Players bring their own copy.** This project never shares game files.
- **No unlocking things people didn't pay for**, no cheats, and no getting around copy protection.

Pointing a finished game at a new address can be fiddly. It's a job for the game's own studio, or for modders who know that game. [Trying a game with Keep Playing](docs/testing-a-game.md) explains how, step by step.

## For studios: an end-of-life plan

If your game uses PlayFab, closing it can look like this:

1. **Save your title's settings into a folder** before you switch it off:

   ```
   node tools/export-title.js --title-id ABCD --out ./my-game --store your_store_id
   ```

   It asks for the secret key in the `PLAYFAB_SECRET_KEY` environment variable (or `--secret-key`). It only reads, and it only talks to your own title. It saves title data, internal title data, catalogs (`--catalog` for each one beyond the primary), stores (`--store` for each one, because PlayFab has no call that lists them), currencies, statistics, the live CloudScript and news. Player accounts aren't included.
2. **Ship a last update** that lets players change the server address, or points at a community server.
3. **Hand players Keep Playing and the folder.** `node server.js --title ./my-game` brings it all back. The tests check that a saved title comes back exactly as it was.

## Safety

- **CloudScript runs as the server.** It runs in its own JavaScript context, which keeps scripts tidy, but that isn't a security boundary. Only load CloudScript you trust: your own game's, or a version you've read.
- **The secret key is in `data/keys.json`.** Anyone with it can use the Server and Admin calls. Keep it private, like a password.
- **Only your own computer can connect by default.** If you open the server up with `--host 0.0.0.0`, put HTTPS in front of it before anyone connects over the internet.

## Tests

```
node tests/run.js
```

The tests start real servers and make the calls the way the SDKs do. Every successful answer is checked against Microsoft's description of that call.

`spec/calls.json` is made from Microsoft's [PlayFab/API_Specs](https://github.com/PlayFab/API_Specs) with `node tools/gen-spec.js`. Run `node tools/coverage.js` to update the coverage list.

## Who made it

[Lifeboat Labs](https://lifeboatlabs.github.io) makes free, open-source tools for when something you rely on shuts down. Keep Playing was built with Claude, Anthropic's AI. Follow us on [X](https://x.com/Lifeboat_labs) or [Reddit](https://www.reddit.com/user/Natural_Ad5072/).

## Licence

Keep Playing is under the [MIT licence](LICENSE). `spec/calls.json` comes from Microsoft's PlayFab API descriptions, which are under the Apache licence 2.0 (see [spec/NOTICE](spec/NOTICE)).
