#!/usr/bin/env node
// Saves a PlayFab title's settings into a folder that Keep Playing can load.
// For studios planning a game's shutdown: run this against your own title
// before you switch it off, then ship the folder with Keep Playing.
//
//   PLAYFAB_SECRET_KEY=... node tools/export-title.js --title-id ABCD --out ./my-game
//
// Options:
//   --title-id ID      your title ID (as in Game Manager)
//   --out FOLDER       where to write the files (must be empty or new)
//   --catalog NAME     a catalog version to save (repeat for more; default: the primary one)
//   --store ID         a store to save (repeat; PlayFab has no call that lists stores)
//   --server URL       a different address, e.g. a Keep Playing server (default: https://ID.playfabapi.com)
//   --secret-key KEY   the title's secret key (or set PLAYFAB_SECRET_KEY, which keeps it out of your shell history)
//
// It only reads. It sends requests to your title's own address and nowhere else.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

async function call(server, url, body, secretKey) {
  const res = await fetch(server + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SecretKey': secretKey, 'X-PlayFabSDK': 'KeepPlayingExport-1.0' },
    body: JSON.stringify(body),
  });
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error(`${url} didn't answer with JSON (HTTP ${res.status})`);
  }
  if (json.code !== 200) {
    const err = new Error(`${url} failed: ${json.error || 'error'} - ${json.errorMessage || ''}`.trim());
    err.playfab = json;
    throw err;
  }
  return json.data;
}

// Turns a CloudScript file name into a safe one for this folder.
function safeFileName(name, used) {
  let base = path.basename(String(name || 'cloudscript.js')).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  if (!base) base = 'cloudscript.js';
  if (!base.endsWith('.js')) base += '.js';
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = base.replace(/\.js$/, `-${i}.js`);
  used.add(candidate.toLowerCase());
  return candidate;
}

async function exportTitle({ titleId, secretKey, out, server, catalogs = [], stores = [], log = () => {} }) {
  if (!titleId) throw new Error('Say which title with --title-id.');
  if (!secretKey) throw new Error('Give the secret key with --secret-key, or set PLAYFAB_SECRET_KEY.');
  if (!out) throw new Error('Say where to save it with --out.');
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`${out} isn't empty. Pick a new folder, so nothing gets overwritten.`);
  const base = (server || `https://${titleId}.playfabapi.com`).replace(/\/+$/, '');
  const get = (url, body = {}) => call(base, url, body, secretKey);
  const write = (name, value) => {
    const file = path.join(out, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  };
  const summary = { titleId, files: [], skipped: [] };
  const optional = async (what, fn) => {
    try {
      await fn();
    } catch (e) {
      summary.skipped.push(`${what}: ${e.message}`);
      log(`Skipped ${what}: ${e.message}`);
    }
  };
  fs.mkdirSync(out, { recursive: true });

  // Title data first: if the key is wrong, this is where we find out.
  const titleData = await get('/Admin/GetTitleData');
  write('title-data.json', titleData.Data || {});
  summary.files.push(`title-data.json (${Object.keys(titleData.Data || {}).length} keys)`);

  await optional('internal title data', async () => {
    const d = await get('/Admin/GetTitleInternalData');
    write('title-internal-data.json', d.Data || {});
    summary.files.push(`title-internal-data.json (${Object.keys(d.Data || {}).length} keys)`);
  });

  const versions = catalogs.length ? catalogs : [null];
  for (const version of versions) {
    await optional(`catalog ${version || '(primary)'}`, async () => {
      const d = await get('/Admin/GetCatalogItems', version ? { CatalogVersion: version } : {});
      const items = d.Catalog || [];
      const name = version || (items[0] && items[0].CatalogVersion) || 'Main';
      write(path.join('catalogs', `${safeFileName(name, new Set()).replace(/\.js$/, '')}.json`), { CatalogVersion: name, Catalog: items });
      summary.files.push(`catalogs/${name}.json (${items.length} items)`);
    });
  }

  if (stores.length) {
    const saved = [];
    for (const id of stores) {
      await optional(`store ${id}`, async () => {
        const d = await get('/Admin/GetStoreItems', { StoreId: id });
        saved.push({ StoreId: id, CatalogVersion: d.CatalogVersion, Store: d.Store || [], MarketingData: d.MarketingData });
      });
    }
    if (saved.length) {
      write('stores.json', saved);
      summary.files.push(`stores.json (${saved.length} stores)`);
    }
  }

  await optional('currencies', async () => {
    const d = await get('/Admin/ListVirtualCurrencyTypes');
    write('currencies.json', d.VirtualCurrencies || []);
    summary.files.push(`currencies.json (${(d.VirtualCurrencies || []).length} currencies)`);
  });

  await optional('statistics', async () => {
    const d = await get('/Admin/GetPlayerStatisticDefinitions');
    write('statistics.json', d.Statistics || []);
    summary.files.push(`statistics.json (${(d.Statistics || []).length} statistics)`);
  });

  await optional('CloudScript', async () => {
    const d = await get('/Admin/GetCloudScriptRevision');
    const used = new Set();
    for (const f of d.Files || []) write(path.join('cloudscript', safeFileName(f.Filename, used)), f.FileContents || '');
    summary.files.push(`cloudscript/ (${(d.Files || []).length} files, revision ${d.Revision})`);
  });

  await optional('news', async () => {
    const d = await get('/Server/GetTitleNews', { Count: 100 });
    write('news.json', d.News || []);
    summary.files.push(`news.json (${(d.News || []).length} items)`);
  });

  write('title.json', {
    titleId,
    name: null,
    settings: { allowClientStatistics: true, allowClientCurrency: false, checkRequiredFields: true, acceptAnySecretKey: false },
    exportedAt: new Date().toISOString(),
  });
  summary.files.push('title.json');
  return summary;
}

function parseArgs(argv) {
  const opts = { catalogs: [], stores: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value after it`);
      return argv[++i];
    };
    if (a === '--title-id') opts.titleId = next();
    else if (a === '--out') opts.out = next();
    else if (a === '--server') opts.server = next();
    else if (a === '--secret-key') opts.secretKey = next();
    else if (a === '--catalog') opts.catalogs.push(next());
    else if (a === '--store') opts.stores.push(next());
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`I don't know the option ${a}. Try --help.`);
  }
  if (!opts.secretKey) opts.secretKey = process.env.PLAYFAB_SECRET_KEY;
  return opts;
}

if (require.main === module) {
  (async () => {
    let opts;
    try {
      opts = parseArgs(process.argv.slice(2));
    } catch (e) {
      console.error(e.message);
      process.exit(2);
    }
    if (opts.help) {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      return;
    }
    try {
      const s = await exportTitle({ ...opts, log: (m) => console.log(m) });
      console.log(`Saved title ${s.titleId} to ${path.resolve(opts.out)}:`);
      for (const f of s.files) console.log(`  ${f}`);
      if (s.skipped.length) console.log(`Skipped ${s.skipped.length} part(s); see above.`);
      console.log(`Start it with: node server.js --title ${opts.out}`);
    } catch (e) {
      console.error(`Export stopped: ${e.message}`);
      process.exit(1);
    }
  })();
}

module.exports = { exportTitle, safeFileName };
