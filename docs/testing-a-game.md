# Trying a game with Keep Playing

This is for modders and players who want to see whether a game whose PlayFab services have gone can work again. You'll need the game itself (your own copy) and a little patience.

## 1. Point the game at Keep Playing

How you do this depends on the game.

- **Most games have the address built in** (`https://TITLEID.playfabapi.com`). On Windows, start the game and wait until it says it can't connect. Then double-click **connect-game.cmd** in the Keep Playing folder. It finds the game's PlayFab address, sends it to this computer through the hosts file, asks Windows to trust Keep Playing's certificate, and starts Keep Playing. Windows asks before each change, and **disconnect-game.cmd** takes them back. This is new and hasn't been tried on a real Windows PC yet, so please tell us how it goes. The [README](../README.md#games-you-cant-change) says more.
- **Unreal Engine games** that use the PlayFab plugin often keep their own list of trusted certificates, so the way above isn't enough. They read the address from `Engine.ini`, under `[/Script/PlayFab.PlayFabRuntimeSettings]` (look in the game's `Saved\Config\WindowsNoEditor` or `Windows` folder). Start Keep Playing with `node server.js --https --verbose`, and add:

  ```ini
  [/Script/PlayFab.PlayFabRuntimeSettings]
  TitleId=
  ProductionEnvironmentURL=127.0.0.1:8443

  [/Script/Engine.NetworkSettings]
  n.VerifyPeer=False
  ```

  [OVERKILL's The Walking Dead](../games/otwd) connects this way, and its README explains each line.
- **Games with a setting or a config file for the PlayFab address**: start Keep Playing with `node server.js --verbose` and put its address there. If it starts with `http`, the SDKs use it exactly as written (see the [README](../README.md#point-your-game-at-it)).

With `--verbose`, every call the game makes is printed as it happens.

## 2. Play, then look at what the game asked for

Open Keep Playing's page in a browser: the address connect-game.cmd opened, or http://localhost:8080 (https://localhost:8443 with `--https`). It lists every call the game made, how many times, and which ones Keep Playing couldn't answer yet. This shows you straight away what's missing.

## 3. Fill in what's game-specific

Most of what a game needs is its own settings and logic:

- **Title data** the game reads at start-up goes in `title-data.json`.
- **Items, shops and currencies** go in `catalog.json`, `stores.json` and `currencies.json`.
- **CloudScript**: when the game calls `ExecuteCloudScript` with a `FunctionName`, write a function with that name in `cloudscript.js`, like `handlers.GetWeeklyQuest = function (args, context) { ... }`. The game expects whatever the original returned, so look at what it does with the answer.

Start the server with your folder: `node server.js --verbose --title my-game`. [title-example](../title-example) has one of every file, and [games/otwd](../games/otwd) is a real one.

## 4. Tell us how it went

Click **Report on GitHub** on Keep Playing's page: it opens a report with the calls the game made already filled in. Or [open a game report](https://github.com/LifeboatLabs/keep-playing/issues/new?template=game-report.md) yourself. If the game works, we'd love to add its folder to [games](../games), with credit to you.

## The lines we keep

- Only games whose official servers are gone.
- Use your own copy of the game, and never share game files.
- No unlocking things people didn't pay for, no cheats, and no getting around copy protection.
