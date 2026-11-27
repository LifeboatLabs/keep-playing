#!/usr/bin/env node
// Writes COVERAGE.md and coverage.json: which PlayFab calls Keep Playing answers.
//   node tools/coverage.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const spec = require('../src/spec');
const { createApp } = require('../src/app');

const app = createApp({});
const all = spec.allCalls();
const live = all.filter((c) => !c.retired);

// Group by the first part of the address: Client, Server, Admin, Object, Lobby...
const groups = new Map();
for (const c of live) {
  const g = c.url.split('/')[1];
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(c);
}

const working = live.filter((c) => app.handlers.has(c.url));
const rows = [...groups.entries()]
  .map(([g, calls]) => ({ g, calls, done: calls.filter((c) => app.handlers.has(c.url)) }))
  .sort((a, b) => b.done.length - a.done.length || b.calls.length - a.calls.length || a.g.localeCompare(b.g));

let md = `# What Keep Playing answers\n\n`;
md += `Keep Playing answers **${working.length} of the ${live.length}** PlayFab calls that Microsoft still lists. `;
md += `(Microsoft's description has ${all.length} calls; ${all.length - live.length} of them are retired.)\n\n`;
md += `Every answer is checked against Microsoft's description in the tests. Made by \`node tools/coverage.js\` from `;
md += `[PlayFab/API_Specs](${spec.source.repo}) at commit \`${spec.source.commit.slice(0, 7)}\` (${spec.source.date}).\n\n`;
md += `| Area | Working | Calls |\n|---|---:|---:|\n`;
for (const r of rows) md += `| ${r.g} | ${r.done.length} | ${r.calls.length} |\n`;
md += `| **All** | **${working.length}** | **${live.length}** |\n\n`;
for (const r of rows) {
  md += `## ${r.g}\n\n`;
  if (r.done.length) md += `Working: ${r.done.map((c) => '`' + c.name + '`').join(', ')}\n\n`;
  const missing = r.calls.filter((c) => !app.handlers.has(c.url));
  if (missing.length) md += `Not yet: ${missing.map((c) => c.name).join(', ')}\n\n`;
}

const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'COVERAGE.md'), md);
fs.writeFileSync(path.join(root, 'coverage.json'), JSON.stringify({
  working: working.length,
  total: live.length,
  retired: all.length - live.length,
  source: spec.source,
  groups: Object.fromEntries(rows.map((r) => [r.g, { working: r.done.length, total: r.calls.length }])),
  calls: Object.fromEntries(live.map((c) => [c.url, app.handlers.has(c.url)])),
}, null, 1) + '\n');
console.log(`Keep Playing answers ${working.length} of ${live.length} calls. Wrote COVERAGE.md and coverage.json.`);
