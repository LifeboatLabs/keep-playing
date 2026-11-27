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

1. Start Keep Playing with this folder. The game only connects over https, so add `--https`:

   ```
   node server.js --title games/otwd --https
   ```

   Keep Playing makes a certificate for this computer and listens at `https://127.0.0.1:8443`.

2. Open `%localappdata%\OTWD\Saved\Config\WindowsNoEditor\Engine.ini`, and add this to the end:

   ```ini
   [/Script/PlayFab.PlayFabRuntimeSettings]
   TitleId=
   ProductionEnvironmentURL=127.0.0.1:8443

   [/Script/Engine.NetworkSettings]
   n.VerifyPeer=False
   ```

   The first part sends the game's PlayFab calls to Keep Playing. This is how HW12Dev's emulator connects too. The second part lets the game accept Keep Playing's certificate. It also stops the game checking certificates anywhere else, which is fine for a game whose servers are gone. To go back, remove those lines.

### Another way: a tunnel

If you'd rather not change the certificate setting, a free [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) gives Keep Playing an https address with a certificate the game already trusts. Your game's calls then go through Cloudflare.

1. Start Keep Playing without `--https`: `node server.js --title games/otwd`
2. Run `cloudflared tunnel --url http://localhost:8080`. It prints an address like `something.trycloudflare.com`.
3. In `Engine.ini`, add only the first part above, with `ProductionEnvironmentURL=something.trycloudflare.com`.

## Settings in title.json

- `createAccountsOnLogin` is on, because the game signs in with your Steam ID and may not ask for a new account.
- `openServerCalls` lets the game make its `WritePlayerEvent` server call without the old secret key. Every other Server and Admin call stays locked.

## The lines we keep

- **This is only for people who own the game.** It doesn't include any game files.
- Keep Playing isn't affiliated with OVERKILL, Starbreeze or Skybound.
