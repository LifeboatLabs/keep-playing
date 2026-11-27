'use strict';
// The page you see when you open Keep Playing's address in a browser: whether
// it's running, and which calls the game has made, so it's easy to see (and
// report) what a game needs that Keep Playing can't answer yet. Nothing on it
// is sent anywhere; the report button only opens a GitHub page you can check
// before posting.

const crypto = require('node:crypto');

const REPO = 'https://github.com/LifeboatLabs/keep-playing';

const CSS = `
:root { color-scheme: light; --ink: #17212b; --soft: #52606d; --line: #cfd8e0; --paper: #f3f6f8; --card: #ffffff;
  --ok: #1d6b4f; --okbg: #e3f1ea; --todo: #8a4b00; --todobg: #fbeedb; --err: #9b2c24; --errbg: #f8e4e1; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.55 system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
main { max-width: 52rem; margin: 0 auto; padding: 2.5rem 1.25rem 3rem; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
h1 { font-size: 2rem; line-height: 1.15; margin: 0; letter-spacing: -0.01em; }
.version { color: var(--soft); }
.running { display: flex; align-items: center; gap: .6rem; margin: .75rem 0 2rem; font-size: 1.1rem; }
.light { width: .8rem; height: .8rem; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 4px var(--okbg); flex: none; }
.game { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 1.1rem 1.25rem; margin-bottom: 2.25rem; }
.game h2 { font-size: 1.3rem; margin: 0 0 .35rem; }
.game p { margin: 0; color: var(--soft); }
h2.calls { font-size: 1.3rem; margin: 0 0 .75rem; }
table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
th, td { text-align: left; padding: .6rem .9rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: .9rem; color: var(--soft); font-weight: 600; background: #e9eef2; }
tr:last-child td { border-bottom: 0; }
td.n { text-align: right; font-variant-numeric: tabular-nums; width: 5rem; }
td.call { font-family: ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace; font-size: .95rem; overflow-wrap: anywhere; }
.unit { display: none; }
.tag { display: inline-block; padding: .05rem .55rem; border-radius: 99px; font-size: .9rem; font-weight: 600; white-space: nowrap; }
.tag.ok { color: var(--ok); background: var(--okbg); }
.tag.todo { color: var(--todo); background: var(--todobg); }
.tag.err { color: var(--err); background: var(--errbg); }
.note { color: var(--soft); font-size: .92rem; margin: .5rem 0 0; }
.report { margin-top: 2rem; border-left: 4px solid var(--todo); background: var(--card); padding: 1.1rem 1.25rem; border-radius: 0 10px 10px 0; }
.report h2 { font-size: 1.2rem; margin: 0 0 .4rem; }
.report p { margin: 0 0 .9rem; }
.report .button + .note { margin: .9rem 0 0; }
.button { display: inline-block; background: var(--ink); color: #fff; text-decoration: none; font-weight: 600; padding: .6rem 1.1rem; border-radius: 8px; }
.button:hover { background: #2c3a48; }
a:focus-visible, .button:focus-visible { outline: 3px solid #2f7bd8; outline-offset: 3px; }
.empty { background: var(--card); border: 1px dashed var(--line); border-radius: 10px; padding: 1.25rem; }
.empty p { margin: 0; }
footer { margin-top: 3rem; color: var(--soft); font-size: .92rem; }
footer a { color: inherit; }
@media (max-width: 560px) {
  main { padding-top: 1.5rem; }
  thead { display: none; }
  table, tbody, tr, td { display: block; }
  tr { padding: .7rem .9rem; border-bottom: 1px solid var(--line); }
  tr:last-child { border-bottom: 0; }
  td { border: 0; padding: 0; }
  td.call { margin-bottom: .35rem; }
  td.n { display: inline; width: auto; color: var(--soft); margin-right: .6rem; }
  td.n + td { display: inline; }
  .unit { display: inline; }
}
`;

const CSS_HASH = crypto.createHash('sha256').update(CSS).digest('base64');
const CSP = `default-src 'none'; style-src 'sha256-${CSS_HASH}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function result(s) {
  if (s.notAnswered && s.answered) return '<span class="tag todo">Sometimes not answered</span>';
  if (s.notAnswered) return '<span class="tag todo">Not answered yet</span>';
  if (s.answered === s.count) return '<span class="tag ok">Answered</span>';
  return `<span class="tag err">Last time: ${esc(s.lastError)}</span>`;
}

function reportLink(status, gameName, missing) {
  const lines = [
    `Game: ${gameName || '(which game is it?)'}`,
    `Keep Playing version: ${status.version}`,
    '',
    "Calls the game made that Keep Playing couldn't answer:",
    ...missing.map(([url, s]) => `- ${url} (${plural(s.notAnswered, 'time')})`),
    '',
    'What happened in the game:',
    '',
  ];
  const q = new URLSearchParams({ title: `Calls ${gameName || 'a game'} needs`, body: lines.join('\n') });
  return `${REPO}/issues/new?${q}`;
}

/** The page's HTML, and the Content-Security-Policy to send with it. */
function statusPage(status, title, address) {
  const seen = Object.entries(status.seen);
  const missing = seen.filter(([, s]) => s.notAnswered);
  const gameName = title.name || '';
  const rows = seen.map(([url, s]) => `<tr><td class="call">${esc(url)}</td><td class="n">${s.count}<span class="unit"> ${s.count === 1 ? 'time' : 'times'}</span></td><td>${result(s)}</td></tr>`).join('\n');

  const calls = seen.length
    ? `<table>
<thead><tr><th scope="col">Call</th><th scope="col" class="n">Times</th><th scope="col">Result</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>${seen.some(([, s]) => s.lastError && s.lastError !== 'NotImplemented') ? `
<p class="note">An error now and then can be normal: a game might look for an account before it makes one.</p>` : ''}`
    : `<div class="empty"><p>No calls yet. Start your game, and each PlayFab call it makes will show up here.${address ? ` Point the game at <strong>${esc(address)}</strong>.` : ''}</p></div>`;

  const report = missing.length
    ? `<section class="report" aria-labelledby="report-title">
<h2 id="report-title">Keep Playing can't answer ${missing.length === 1 ? 'one' : missing.length} of these yet</h2>
<p>${missing.length === 1 ? "One call your game made isn't" : `${missing.length} calls your game made aren't`} in Keep Playing yet. Tell us which game it is, and we'll look at adding ${missing.length === 1 ? 'it' : 'them'}.</p>
<a class="button" href="${esc(reportLink(status, gameName, missing))}" target="_blank" rel="noopener">Report on GitHub</a>
<p class="note">The button opens a report on GitHub with these calls filled in. You can check and change it before posting, and nothing is sent until you do.</p>
</section>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>Keep Playing${gameName ? `: ${esc(gameName)}` : ''}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header><h1>Keep Playing</h1><span class="version">version ${esc(status.version)}</span></header>
<p class="running"><span class="light" aria-hidden="true"></span>Running, and answering PlayFab calls${address ? ` at ${esc(address)}` : ''}.</p>
<section class="game" aria-labelledby="game-title">
<h2 id="game-title">${gameName ? esc(gameName) : 'Your game'}</h2>
<p>Title ID ${status.titleId ? esc(status.titleId) : 'not set yet (the first sign-in sets it)'}. ${plural(status.players, 'player')} so far.</p>
</section>
<h2 class="calls">Calls your game has made</h2>
${calls}
${report}
<footer>
<p>Keep Playing answers ${status.calls.working} of the ${status.calls.total} PlayFab calls Microsoft lists. It's free and open source, and isn't made by or affiliated with Microsoft. <a href="${REPO}" target="_blank" rel="noopener">Source code</a>.</p>
<p>This page updates every 10 seconds.</p>
</footer>
</main>
</body>
</html>
`;
  return { html, csp: CSP };
}

module.exports = { statusPage };
