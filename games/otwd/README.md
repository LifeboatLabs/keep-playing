# OVERKILL's The Walking Dead

This folder brings back the online features that OVERKILL's The Walking Dead used PlayFab for: **the weekly quest, the wandering NPC and bounties.** The game's own PlayFab title has stopped working.

The game logic comes from [OTWDPlayFabEmulator](https://github.com/HW12Dev/OTWDPlayFabEmulator) by HW12Dev (MIT licence). This version runs it on Keep Playing, so each player's weekly progress is saved and survives restarts.

**It hasn't been tried with the real game yet.** If you own the game and can test it, please [tell us how it went](https://github.com/LifeboatLabs/keep-playing/issues).

## What the game calls

These are the calls HW12Dev's emulator answers. Keep Playing answers all of them:

- `LoginWithCustomID`
- `ExecuteCloudScript` with `GetSeed`, `GetWeeklyQuest`, `ActivateWeeklyQuest`, `GetWeeklyNPC`, `ActivateWeeklyNPC` and `GetBounties`
- `UpdateUserData` (the game saves `WeeklyQuestDone`)
- `GetUserReadOnlyData`, `GetTitleData` and `WritePlayerEvent`

## Running it

1. Start Keep Playing with this folder:

   ```
   node server.js --title games/otwd
   ```

2. The game only connects over HTTPS, so Keep Playing needs an HTTPS address. The simplest way is a free [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/):

   ```
   cloudflared tunnel --url http://localhost:8080
   ```

   It prints an address like `something.trycloudflare.com`.

3. Open `%localappdata%\OTWD\Saved\Config\WindowsNoEditor\Engine.ini`, and add this to the end (with your own address):

   ```ini
   [/Script/PlayFab.PlayFabRuntimeSettings]
   TitleId=
   ProductionEnvironmentURL=something.trycloudflare.com
   ```

   This is how HW12Dev's emulator connects too. To go back, remove those lines.

## Settings in title.json

- `createAccountsOnLogin` is on, because the game signs in with your Steam ID and may not ask for a new account.
- `openServerCalls` lets the game make its `WritePlayerEvent` server call without the old secret key. Every other Server and Admin call stays locked.

## The lines we keep

- **This is only for people who own the game.** It doesn't include any game files.
- Keep Playing isn't affiliated with OVERKILL, Starbreeze or Skybound.
