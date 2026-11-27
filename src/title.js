'use strict';
// The game's own settings: title data, catalogs, stores, currencies, statistics
// and CloudScript. They're read from a title folder (see title-example/) every
// time the server starts, and Admin calls can change them while it runs.

const fs = require('node:fs');
const path = require('node:path');

const SETTINGS = {
  // PlayFab's own default is false. Most games that call it had it switched on.
  allowClientStatistics: true,
  // Same as PlayFab: players can't give themselves currency unless the game allows it.
  allowClientCurrency: false,
  // Reject requests that leave out a required field, like PlayFab does.
  checkRequiredFields: true,
  // Accept any X-SecretKey. Only for game servers whose key is built in and unknown.
  acceptAnySecretKey: false,
};

function emptyTitle() {
  return {
    titleId: null,
    name: null,
    settings: { ...SETTINGS },
    secretKeys: [],
    titleData: {},
    titleInternalData: {},
    publisherData: {},
    catalogs: {},
    primaryCatalog: null,
    stores: {},
    currencies: [],
    statistics: {},
    cloudScript: { revisions: [], live: null },
    news: [],
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Couldn't read ${file}: ${e.message}`);
  }
}

const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

function textMap(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = asText(v);
  return out;
}

// Accepts PlayFab's own export shapes as well as plain lists.
function catalogList(json) {
  if (Array.isArray(json)) return { version: null, items: json };
  if (json && Array.isArray(json.Catalog)) return { version: json.CatalogVersion || null, items: json.Catalog };
  throw new Error('a catalog should be a list of items, or { "CatalogVersion": ..., "Catalog": [...] }');
}

function normaliseItem(item, version) {
  if (!item || typeof item.ItemId !== 'string') throw new Error('every catalog item needs an ItemId');
  return {
    ItemId: item.ItemId,
    ItemClass: item.ItemClass,
    CatalogVersion: version,
    DisplayName: item.DisplayName,
    Description: item.Description,
    VirtualCurrencyPrices: item.VirtualCurrencyPrices,
    RealCurrencyPrices: item.RealCurrencyPrices,
    Tags: item.Tags,
    CustomData: item.CustomData === undefined || item.CustomData === null ? undefined : asText(item.CustomData),
    Consumable: item.Consumable,
    Container: item.Container,
    Bundle: item.Bundle,
    CanBecomeCharacter: !!item.CanBecomeCharacter,
    IsStackable: !!item.IsStackable,
    IsTradable: !!item.IsTradable,
    ItemImageUrl: item.ItemImageUrl,
    IsLimitedEdition: !!item.IsLimitedEdition,
    InitialLimitedEditionCount: item.InitialLimitedEditionCount || 0,
  };
}

function setCatalog(title, version, items) {
  title.catalogs[version] = items.map((i) => normaliseItem(i, version));
  if (!title.primaryCatalog) title.primaryCatalog = version;
}

function readFolder(dir) {
  const t = emptyTitle();
  const file = (name) => path.join(dir, name);
  const has = (name) => fs.existsSync(file(name));

  if (has('title.json')) {
    const j = readJson(file('title.json'));
    t.titleId = j.titleId || null;
    t.name = j.name || null;
    Object.assign(t.settings, j.settings || {});
    t.secretKeys = Array.isArray(j.secretKeys) ? j.secretKeys.map(String) : [];
    if (j.primaryCatalog) t.primaryCatalog = j.primaryCatalog;
  }
  if (has('title-data.json')) t.titleData = textMap(readJson(file('title-data.json')));
  if (has('title-internal-data.json')) t.titleInternalData = textMap(readJson(file('title-internal-data.json')));
  if (has('publisher-data.json')) t.publisherData = textMap(readJson(file('publisher-data.json')));

  if (has('catalogs')) {
    for (const f of fs.readdirSync(file('catalogs')).filter((n) => n.endsWith('.json')).sort()) {
      const { version, items } = catalogList(readJson(path.join(file('catalogs'), f)));
      setCatalog(t, version || f.replace(/\.json$/, ''), items);
    }
  } else if (has('catalog.json')) {
    const { version, items } = catalogList(readJson(file('catalog.json')));
    setCatalog(t, version || 'Main', items);
  }

  if (has('stores.json')) {
    const stores = readJson(file('stores.json'));
    for (const s of Array.isArray(stores) ? stores : Object.entries(stores).map(([StoreId, v]) => ({ StoreId, ...v }))) {
      if (!s.StoreId) throw new Error('every store needs a StoreId');
      t.stores[s.StoreId] = {
        catalogVersion: s.CatalogVersion || null,
        items: s.Store || s.Items || [],
        marketing: s.MarketingData || null,
      };
    }
  }

  if (has('currencies.json')) {
    const c = readJson(file('currencies.json'));
    t.currencies = (Array.isArray(c) ? c : c.VirtualCurrencies || []).map((v) => ({
      CurrencyCode: String(v.CurrencyCode),
      DisplayName: v.DisplayName,
      InitialDeposit: v.InitialDeposit || 0,
      RechargeRate: v.RechargeRate || 0,
      RechargeMax: v.RechargeMax || 0,
    }));
  }

  if (has('statistics.json')) {
    for (const s of readJson(file('statistics.json'))) {
      t.statistics[s.StatisticName] = {
        aggregation: s.AggregationMethod || 'Last',
        resetInterval: s.VersionChangeInterval || 'Never',
        version: s.CurrentVersion || 0,
      };
    }
  }

  const scripts = [];
  if (has('cloudscript.js')) scripts.push({ Filename: 'cloudscript.js', FileContents: fs.readFileSync(file('cloudscript.js'), 'utf8') });
  if (has('cloudscript')) {
    for (const f of fs.readdirSync(file('cloudscript')).filter((n) => n.endsWith('.js')).sort()) {
      scripts.push({ Filename: f, FileContents: fs.readFileSync(path.join(file('cloudscript'), f), 'utf8') });
    }
  }
  if (scripts.length) {
    t.cloudScript = { revisions: [{ Revision: 1, Files: scripts, CreatedAt: new Date().toISOString(), Published: true }], live: 1 };
  }

  if (has('news.json')) t.news = readJson(file('news.json'));
  return t;
}

function get(store) {
  let t = store.get('title', 'config');
  if (!t) t = store.put('title', 'config', emptyTitle());
  return t;
}

function save(store, t) {
  store.put('title', 'config', t);
}

// Loads a title folder over what's stored. What the folder has is put in
// place, and what changed while the server ran (title data set by Admin or
// Server calls, statistic versions, earlier CloudScript revisions) is kept.
function load(store, dir) {
  const current = get(store);
  const folder = readFolder(dir);
  const next = {
    ...emptyTitle(),
    ...current,
    settings: { ...SETTINGS, ...current.settings, ...folder.settings },
  };
  if (folder.titleId) next.titleId = folder.titleId;
  if (folder.name) next.name = folder.name;
  if (folder.secretKeys.length) next.secretKeys = folder.secretKeys;
  for (const k of ['titleData', 'titleInternalData', 'publisherData']) next[k] = { ...current[k], ...folder[k] };

  next.catalogs = { ...current.catalogs, ...folder.catalogs };
  if (folder.primaryCatalog) next.primaryCatalog = folder.primaryCatalog;
  next.stores = { ...current.stores, ...folder.stores };

  const currencies = new Map((current.currencies || []).map((c) => [c.CurrencyCode, c]));
  for (const c of folder.currencies) currencies.set(c.CurrencyCode, c);
  next.currencies = [...currencies.values()];

  // A statistic keeps its version and history; the folder sets how it works.
  next.statistics = { ...current.statistics };
  for (const [name, def] of Object.entries(folder.statistics)) {
    const old = current.statistics[name];
    next.statistics[name] = old
      ? { ...old, aggregation: def.aggregation, resetInterval: def.resetInterval }
      : def;
  }

  // The folder's CloudScript becomes the live revision. If it's new, it's
  // added as the next revision, so earlier ones stay.
  if (folder.cloudScript.revisions.length) {
    const files = folder.cloudScript.revisions[0].Files;
    const cs = { revisions: [...(current.cloudScript.revisions || [])], live: current.cloudScript.live };
    const live = cs.revisions.find((r) => r.Revision === cs.live);
    if (!live || JSON.stringify(live.Files) !== JSON.stringify(files)) {
      const revision = (cs.revisions.length ? cs.revisions[cs.revisions.length - 1].Revision : 0) + 1;
      cs.revisions.push({ Revision: revision, Files: files, CreatedAt: new Date().toISOString(), Published: true });
      cs.live = revision;
    }
    next.cloudScript = cs;
  }

  const news = new Map((current.news || []).map((n) => [n.NewsId, n]));
  for (const n of folder.news) news.set(n.NewsId, n);
  next.news = [...news.values()];

  save(store, next);
  return next;
}

module.exports = { get, save, load, emptyTitle, normaliseItem, SETTINGS };
