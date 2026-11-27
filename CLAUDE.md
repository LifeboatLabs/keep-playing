# Keep Playing: notes for Claude

A free, open-source server that answers PlayFab calls, so games can be tested offline and keep
working after their online services shut down. Part of Lifeboat Labs (https://lifeboatlabs.github.io),
same family as Done With To Do, Done With Windows 10 and Save Your Game. Not affiliated with Microsoft.

## Files
- `server.js`: the command line (`--title`, `--data`, `--port`, `--host`, `--verbose`).
- `src/app.js`: HTTP side, auth (X-Authorization / X-SecretKey / X-EntityToken), envelopes, `app.run()`.
- `src/spec.js`: loads `spec/calls.json` and checks requests and answers against it.
- `src/store.js`: in-memory records plus an append-only journal and snapshot in the data folder.
- `src/players.js`, `src/title.js`, `src/tokens.js`, `src/errors.js`: accounts, the title folder, signed tickets, errors.
- `src/apis/*.js`: the calls, one area per file. Register with `on(url, (body, ctx) => result)`.
- `spec/calls.json`: generated from Microsoft's PlayFab/API_Specs (Apache-2.0) by `tools/gen-spec.js`.
- `title-example/`: a complete example title folder; the tests use it.

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
Steam ticket signatures aren't checked (README says so). CloudScript's vm context isn't a sandbox.
No shared groups, characters, matchmaking, lobbies, Economy v2, groups, files or Azure Functions yet.

## Tests
`node tests/run.js` (`--untested` lists handled calls no test tried). Run before pushing.

## Commits
Author commits as `LifeboatLabs <361480394+LifeboatLabs@users.noreply.github.com>`.
