# Trying a game with Keep Playing

This is for modders and players who want to see whether a game whose PlayFab services have gone can work again. You'll need the game itself (your own copy) and a little patience.

## 1. Start Keep Playing so it shows every call

```
node server.js --verbose
```

Every call the game makes is printed as it happens. Calls Keep Playing can't answer yet are printed as a note.

## 2. Point the game at it

How you do this depends on the game.

- **Unreal Engine games** that use the PlayFab plugin read the address from `Engine.ini`, under `[/Script/PlayFab.PlayFabRuntimeSettings]`. Look in the game's `Saved\Config\WindowsNoEditor` (or `Windows`) folder. The plugin only connects over HTTPS, so run a free [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) (`cloudflared tunnel --url http://localhost:8080`) and use the address it prints:

  ```ini
  [/Script/PlayFab.PlayFabRuntimeSettings]
  TitleId=
  ProductionEnvironmentURL=something.trycloudflare.com
  ```

  [OVERKILL's The Walking Dead](../games/otwd) connects this way.
- **Games with a setting or a config file for the PlayFab address**: put Keep Playing's address there. If it starts with `http`, the SDKs use it exactly as written (see the [README](../README.md#point-your-game-at-it)).
- **Games with the address built in** (`https://TITLEID.playfabapi.com`) are harder, because the game expects PlayFab's own certificate. [Open an issue](https://github.com/LifeboatLabs/keep-playing/issues/new?template=game-report.md) and tell us about the game, and we'll work it out together.

## 3. Play, then look at what the game asked for

Open http://localhost:8080/status in a browser. Under `seen` it lists every call the game made, how many times it made it, and which ones failed. This shows you straight away what's missing.

## 4. Fill in what's game-specific

Most of what a game needs is its own settings and logic:

- **Title data** the game reads at start-up goes in `title-data.json`.
- **Items, shops and currencies** go in `catalog.json`, `stores.json` and `currencies.json`.
- **CloudScript**: when the game calls `ExecuteCloudScript` with a `FunctionName`, write a function with that name in `cloudscript.js`, like `handlers.GetWeeklyQuest = function (args, context) { ... }`. The game expects whatever the original returned, so look at what it does with the answer.

Start the server with your folder: `node server.js --verbose --title my-game`. [title-example](../title-example) has one of every file, and [games/otwd](../games/otwd) is a real one.

## 5. Tell us how it went

[Open a game report](https://github.com/LifeboatLabs/keep-playing/issues/new?template=game-report.md), and paste the `seen` list from the status page. If the game works, we'd love to add its folder to [games](../games), with credit to you.

## The lines we keep

- Only games whose official servers are gone.
- Use your own copy of the game, and never share game files.
- No unlocking things people didn't pay for, no cheats, and no getting around copy protection.
