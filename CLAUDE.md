# Keep Playing: notes for Claude

A free, open-source server that answers PlayFab calls, so games can be tested offline and keep
working after their online services shut down. Part of Lifeboat Labs (https://lifeboatlabs.github.io),
same family as Done With To Do, Done With Windows 10 and Save Your Game. Not affiliated with Microsoft.

## Files
- `server.js`: the command line (`--title`, `--data`, `--port`, `--host`, `--https`, `--cert`/`--key`, `--verbose`).
- `src/tls.js`: makes a self-signed, not-a-CA certificate for localhost/127.0.0.1/::1 (plain DER, Node crypto only)
  and keeps it in `<data>/tls/`, renewed with under 30 days left.
- `src/app.js`: HTTP side, auth (X-Authorization / X-SecretKey / X-EntityToken), envelopes, `app.run()`.
- `src/page.js`: the page a browser gets at `/` (calls seen, a prefilled GitHub report link for unanswered ones).
  Strict CSP with a hash for its one style block, no scripts; `/status` and non-browser `/` stay JSON.
- `src/spec.js`: loads `spec/calls.json` and checks requests and answers against it.
- `src/store.js`: in-memory records plus an append-only journal and snapshot in the data folder.
- `src/players.js`, `src/title.js`, `src/tokens.js`, `src/errors.js`: accounts, the title folder, signed tickets, errors.
- `src/import.js`: brings players back from player files (GetPlayerCombinedInfo answers) at start: `--import FILE` and
  `<data>/import/*.json` (moved to `import/done`). Keeps PlayFab ID, entity ID and sign-ins; a sign-in owned by a player
  made here moves; an existing PlayFab ID is left alone. Item instances keep only ItemInstance fields.
- `src/apis/*.js`: the calls, one area per file. Register with `on(url, (body, ctx) => result)`.
- `src/apis/files.js`: entity files. Games upload and download at signed `/files/` addresses (not PlayFab
  calls, answered like Azure storage); contents go in `<data>/files/`, or memory without a data folder.
- `spec/calls.json`: generated from Microsoft's PlayFab/API_Specs (Apache-2.0) by `tools/gen-spec.js`.
- `title-example/`: a complete example title folder; the tests use it.
- `tools/export-title.js`: saves a real PlayFab title's settings into a title folder (read-only Admin calls).
- `tools/connect.js` (run by `connect-game.cmd` / `disconnect-game.cmd`, CRLF, see .gitattributes): Windows only.
  Finds a game's title ID in `ipconfig /displaydns`, adds `127.0.0.1 <id>.playfabapi.com # Keep Playing` to the hosts
  file (elevated, only PlayFab addresses), trusts the certificate in CurrentUser\Root with certutil, then runs
  `server.js --title-id` (https, port 443, certificate also covers that address). `--undo` removes both. The Windows
  parts (UAC, certutil, PowerShell) can't run in the tests; the hosts editing and title ID finding are tested.
- `games/<game>/`: title folders for particular dead games, each with a README (how to connect, credits,
  the lines) and a test in tests/run.js that replays the calls the game makes. Credit fan work and keep its licence.

## Rules
- No dependencies, no build step. Node 22+, standard library only.
- Handlers are synchronous (CloudScript's `server.*` calls them directly).
- Every handled URL must be in the description (`on()` refuses otherwise), and every error name
  must be in Microsoft's list (a test checks).
- Every answer must match the call's result type exactly: no extra fields, required fields present,
  enum values valid. The tests check each one. When adding a call, add it to a test so it's tried.
- Match PlayFab's real behaviour, including its odd bits; when unsure, say so in a comment.
- After adding calls, run `node tools/coverage.js` and update the counts in README.md.
- Bump `version` in package.json for each release.
- Write for non-technical readers in the README: plain words, say what to do next.

## Lines we keep
Only games whose official servers are gone, or studios planning their own shutdown. Players bring
their own copy; never share game files. No unlocking paid content for people who didn't buy it, no
cheats, no getting around copy protection. Never send anything to a server of ours; there isn't one.

## Known gaps
Steam tickets and other platform tokens (Apple, Nintendo, Battle.net, OpenID...) aren't checked with the platform;
the player ID is read from them (README says so). Google, Facebook, Xbox, PSN and Twitch sign-ins can't be
supported that way. CloudScript runs in its own vm context and talks to the server through text only, but
it isn't a sandbox.
No lobbies, PubSub notifications, backfill tickets, Economy v2, character entities or Azure Functions yet.
Matchmaking (src/apis/matchmaking.js) matches greedily, oldest ticket first, when tickets are made, joined or polled;
weights, team difference/ticket-size-similarity rules and PlayerEntity attributes aren't used. Groups use PlayFab's default
role rules (admins do everything, anyone may look); a title's own group template isn't read. Characters can't buy items
(PurchaseItem with a CharacterId says NotImplemented).

## Tests
`node tests/run.js` (`--untested` lists handled calls no test tried). Run before pushing.

## Commits
Author commits as `LifeboatLabs <361480394+LifeboatLabs@users.noreply.github.com>`.
