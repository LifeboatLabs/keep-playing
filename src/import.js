'use strict';
// Bringing players back from files.
//
// A player file is what PlayFab's GetPlayerCombinedInfo answered for one
// player, with everything asked for: the whole answer
// ({ "data": { "PlayFabId": ..., "InfoResultPayload": ... } }), or just
// { "PlayFabId": ..., "InfoResultPayload": ... }. A studio can save one for each
// player before its game shuts down, and give each player their own.
//
// The player keeps their PlayFab ID, title player account ID and sign-ins, so
// signing in the way they always did finds them again. If one of those sign-ins
// belongs to a player made here (by playing before the import, say), it moves
// to the imported player. A player who's already here is left alone, so
// importing the same file twice changes nothing.

const fs = require('node:fs');
const path = require('node:path');
const { hexId } = require('./tokens');
const { DATA_KINDS } = require('./players');
const stats = require('./apis/stats');

const HEX_ID = /^[0-9A-F]{1,32}$/;
const INT32 = (n) => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;
const usable = (k) => typeof k === 'string' && k !== '' && k !== '__proto__';
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const date = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);

// Sign-ins in UserAccountInfo, and the kind Keep Playing links each one as.
const ACCOUNT_LINKS = [
  ['CustomIdInfo', 'CustomId', 'CustomId'],
  ['ServerCustomIdInfo', 'CustomId', 'ServerCustomId'],
  ['AndroidDeviceInfo', 'AndroidDeviceId', 'AndroidDeviceId'],
  ['IosDeviceInfo', 'IosDeviceId', 'IOSDeviceId'],
  ['SteamInfo', 'SteamId', 'Steam'],
  ['AppleAccountInfo', 'AppleSubjectId', 'Apple'],
  ['GameCenterInfo', 'GameCenterId', 'GameCenter'],
  ['KongregateInfo', 'KongregateId', 'Kongregate'],
  ['NintendoSwitchDeviceIdInfo', 'NintendoSwitchDeviceId', 'NintendoSwitchDeviceId'],
  ['NintendoSwitchAccountInfo', 'NintendoSwitchAccountSubjectId', 'NintendoServiceAccount'],
  ['FacebookInstantGamesIdInfo', 'FacebookInstantGamesId', 'FacebookInstantGames'],
  ['BattleNetAccountInfo', 'BattleNetAccountId', 'BattleNet'],
];
// The same, from a profile's LinkedAccounts, for files without AccountInfo.
const PLATFORM_LINKS = {
  Custom: 'CustomId', CustomServer: 'ServerCustomId', AndroidDevice: 'AndroidDeviceId', IOSDevice: 'IOSDeviceId',
  Steam: 'Steam', Apple: 'Apple', GameCenter: 'GameCenter', Kongregate: 'Kongregate', NintendoSwitch: 'NintendoSwitchDeviceId',
  NintendoSwitchAccount: 'NintendoServiceAccount', FacebookInstantGames: 'FacebookInstantGames', BattleNet: 'BattleNet',
};
const ORIGINATIONS = new Set(['Organic', 'Steam', 'Google', 'Amazon', 'Facebook', 'Kongregate', 'GamersFirst', 'Unknown', 'IOS', 'LoadTest',
  'Android', 'PSN', 'GameCenter', 'CustomId', 'XboxLive', 'Parse', 'Twitch', 'ServerCustomId', 'NintendoSwitchDeviceId',
  'FacebookInstantGamesId', 'OpenIdConnect', 'Apple', 'NintendoSwitchAccount', 'GooglePlayGames', 'XboxMobileStore', 'King', 'BattleNet']);

/** The PlayFab ID and InfoResultPayload in a player file, or an error saying what's wrong. */
function readPlayerFile(json) {
  const body = isObject(json) && isObject(json.data) ? json.data : json;
  if (!isObject(body) || !isObject(body.InfoResultPayload)) {
    throw new Error("it isn't a player file: it needs the InfoResultPayload from GetPlayerCombinedInfo");
  }
  const id = String(body.PlayFabId || (isObject(body.InfoResultPayload.AccountInfo) && body.InfoResultPayload.AccountInfo.PlayFabId) || '').toUpperCase();
  if (!HEX_ID.test(id)) throw new Error("it has no PlayFabId (it's next to InfoResultPayload in GetPlayerCombinedInfo's answer)");
  return { id, payload: body.InfoResultPayload };
}

// UserDataRecords, as Keep Playing keeps them.
function records(map) {
  const out = {};
  for (const [k, r] of Object.entries(isObject(map) ? map : {})) {
    if (!usable(k) || !isObject(r) || r.Value === undefined || r.Value === null) continue;
    out[k] = {
      Value: typeof r.Value === 'string' ? r.Value : JSON.stringify(r.Value),
      LastUpdated: date(r.LastUpdated) || new Date(0).toISOString(),
      Permission: r.Permission === 'Public' || r.Permission === 'Private' ? r.Permission : undefined,
    };
  }
  return out;
}

// Item instances, with only the fields an ItemInstance has, and IDs that stay unique.
function items(list, now, taken) {
  const out = [];
  for (const it of Array.isArray(list) ? list : []) {
    if (!isObject(it) || !usable(it.ItemId)) continue;
    const inst = { ItemId: it.ItemId };
    for (const k of ['Annotation', 'BundleParent', 'CatalogVersion', 'DisplayName', 'ItemClass', 'ItemInstanceId', 'UnitCurrency']) {
      if (typeof it[k] === 'string') inst[k] = it[k];
    }
    if (Array.isArray(it.BundleContents)) inst.BundleContents = it.BundleContents.filter((x) => typeof x === 'string');
    if (isObject(it.CustomData)) {
      inst.CustomData = {};
      for (const [k, v] of Object.entries(it.CustomData)) if (usable(k) && typeof v === 'string') inst.CustomData[k] = v;
    }
    if (INT32(it.RemainingUses)) inst.RemainingUses = it.RemainingUses;
    if (date(it.Expiration)) inst.Expiration = date(it.Expiration);
    inst.PurchaseDate = date(it.PurchaseDate) || now.toISOString();
    inst.UnitPrice = Number.isInteger(it.UnitPrice) && it.UnitPrice >= 0 && it.UnitPrice <= 4294967295 ? it.UnitPrice : 0;
    if (!inst.ItemInstanceId || taken.has(inst.ItemInstanceId)) {
      do inst.ItemInstanceId = hexId(8); while (taken.has(inst.ItemInstanceId));
    }
    taken.add(inst.ItemInstanceId);
    out.push(inst);
  }
  return out;
}

// Each sign-in in the file, as [kind, value].
function signIns(payload) {
  const out = [];
  const info = isObject(payload.AccountInfo) ? payload.AccountInfo : null;
  if (info) {
    for (const [field, key, kind] of ACCOUNT_LINKS) {
      const v = isObject(info[field]) ? info[field][key] : undefined;
      if (typeof v === 'string' && v) out.push([kind, v]);
    }
    for (const o of Array.isArray(info.OpenIdInfo) ? info.OpenIdInfo : []) {
      if (isObject(o) && usable(o.ConnectionId) && typeof o.Issuer === 'string' && typeof o.Subject === 'string') {
        out.push([`OpenId:${o.ConnectionId}`, `${o.Issuer}\n${o.Subject}`]);
      }
    }
  } else if (isObject(payload.PlayerProfile) && Array.isArray(payload.PlayerProfile.LinkedAccounts)) {
    for (const a of payload.PlayerProfile.LinkedAccounts) {
      const kind = isObject(a) && PLATFORM_LINKS[a.Platform];
      if (kind && typeof a.PlatformUserId === 'string' && a.PlatformUserId) out.push([kind, a.PlatformUserId]);
    }
  }
  return out;
}

/**
 * Adds the player in a player file (already parsed) to the app. Returns what
 * happened: { id, name, imported, links, moved, items, statistics, characters, notes }.
 */
function importPlayer(app, json, now = new Date()) {
  const { id, payload } = readPlayerFile(json);
  const info = isObject(payload.AccountInfo) ? payload.AccountInfo : {};
  const titleInfo = isObject(info.TitleInfo) ? info.TitleInfo : {};
  const profile = isObject(payload.PlayerProfile) ? payload.PlayerProfile : {};
  const name = titleInfo.DisplayName || profile.DisplayName || null;
  const result = { id, name, imported: false, links: [], moved: [], items: 0, statistics: 0, characters: 0, notes: [] };
  if (app.players.byId(id)) {
    result.notes.push('this player is already here, so nothing was changed');
    return result;
  }
  const titleId = app.title().titleId;
  if (titleId && profile.TitleId && String(profile.TitleId).toUpperCase() !== String(titleId).toUpperCase()) {
    result.notes.push(`the file is from title ${profile.TitleId}, and this is ${titleId}`);
  }

  const account = isObject(titleInfo.TitlePlayerAccount) ? String(titleInfo.TitlePlayerAccount.Id || '').toUpperCase() : '';
  let entityId = account;
  if (!HEX_ID.test(entityId) || app.players.byEntity(entityId)) {
    do entityId = hexId(8); while (app.players.byEntity(entityId));
  }
  const created = date(info.Created) || date(titleInfo.Created) || now.toISOString();
  const vc = {};
  for (const c of app.title().currencies) vc[c.CurrencyCode] = c.InitialDeposit || 0;
  for (const [code, amount] of Object.entries(isObject(payload.UserVirtualCurrency) ? payload.UserVirtualCurrency : {})) {
    if (/^[A-Z0-9]{2}$/.test(code) && INT32(amount)) vc[code] = amount;
  }
  const taken = new Set();
  const p = {
    id,
    entityId,
    created,
    firstLogin: date(titleInfo.FirstLogin) || created,
    lastLogin: date(titleInfo.LastLogin) || null,
    origination: ORIGINATIONS.has(titleInfo.Origination) ? titleInfo.Origination : 'Organic',
    displayName: typeof name === 'string' ? name : null,
    username: null,
    email: null,
    password: null,
    contactEmail: null,
    avatarUrl: typeof (titleInfo.AvatarUrl || profile.AvatarUrl) === 'string' ? (titleInfo.AvatarUrl || profile.AvatarUrl) : null,
    links: {},
    data: Object.fromEntries(DATA_KINDS.map((k) => [k, {}])),
    dataVersion: INT32(payload.UserDataVersion) ? payload.UserDataVersion : 0,
    readOnlyDataVersion: INT32(payload.UserReadOnlyDataVersion) ? payload.UserReadOnlyDataVersion : 0,
    stats: {},
    vc,
    inventory: items(payload.UserInventory, now, taken),
    friends: [],
    objects: {},
    profileVersion: 0,
    tags: (Array.isArray(profile.Tags) ? profile.Tags : []).map((t) => isObject(t) && t.TagValue).filter((t) => typeof t === 'string'),
    bans: [],
  };
  p.data.UserData = records(payload.UserData);
  p.data.UserReadOnlyData = records(payload.UserReadOnlyData);

  const inventories = new Map();
  for (const ci of Array.isArray(payload.CharacterInventories) ? payload.CharacterInventories : []) {
    if (isObject(ci) && usable(ci.CharacterId)) inventories.set(ci.CharacterId, ci.Inventory);
  }
  for (const c of Array.isArray(payload.CharacterList) ? payload.CharacterList : []) {
    if (!isObject(c) || !usable(c.CharacterId) || (p.characters && p.characters[c.CharacterId])) continue;
    p.characters = p.characters || {};
    p.characters[c.CharacterId] = {
      id: c.CharacterId,
      name: String(c.CharacterName || ''),
      type: String(c.CharacterType || ''),
      created,
      data: { CharacterData: {}, CharacterReadOnlyData: {}, CharacterInternalData: {} },
      dataVersion: 0,
      stats: {},
      inventory: items(inventories.get(c.CharacterId), now, taken),
      vc: {},
    };
  }
  app.players.save(p);

  // Sign-ins. One that belongs to a player made here moves to this one.
  for (const [kind, value] of signIns(payload)) {
    const owner = app.players.byLink(kind, value);
    if (owner && owner.id !== id) result.moved.push({ kind, from: owner.id });
    app.players.link(p, kind, value, true);
    result.links.push(kind);
  }
  if (typeof info.Username === 'string' && info.Username) {
    if (app.players.byUsername(info.Username)) result.notes.push(`the username ${info.Username} is taken here, so it wasn't added`);
    else app.players.setUsername(p, info.Username);
  }
  const email = isObject(info.PrivateInfo) ? info.PrivateInfo.Email : undefined;
  if (typeof email === 'string' && email && !app.players.byEmail(email)) app.players.setEmail(p, email);
  if (p.username || p.email) result.notes.push("it signed in with a username or email and password; the password isn't in the file, so that way of signing in won't work");
  app.players.save(p);

  const values = (Array.isArray(payload.PlayerStatistics) ? payload.PlayerStatistics : [])
    .filter((s) => isObject(s) && usable(s.StatisticName) && INT32(s.Value))
    .filter((s, i, all) => all.findIndex((t) => t.StatisticName === s.StatisticName) === i)
    .map((s) => ({ StatisticName: s.StatisticName, Value: s.Value }));
  if (values.length) stats.update(app, p, values, now);

  Object.assign(result, {
    imported: true,
    items: p.inventory.length + Object.values(p.characters || {}).reduce((n, c) => n + c.inventory.length, 0),
    statistics: values.length,
    characters: Object.keys(p.characters || {}).length,
  });
  return result;
}

/** Reads and imports a player file. Returns importPlayer's result, with the file name. */
function importFile(app, file, now = new Date()) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`${path.basename(file)} isn't a JSON file Keep Playing can read (${e.message})`);
  }
  try {
    return { file, ...importPlayer(app, json, now) };
  } catch (e) {
    throw new Error(`${path.basename(file)}: ${e.message}`);
  }
}

/**
 * Imports every .json file in <dir>, and moves each one it read into <dir>/done.
 * Files it can't read stay where they are. Returns { results, errors }.
 */
function importFolder(app, dir, now = new Date()) {
  const results = [];
  const errors = [];
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.json')).sort();
  } catch (e) {
    return { results, errors };
  }
  for (const n of names) {
    const file = path.join(dir, n);
    try {
      results.push(importFile(app, file, now));
      fs.mkdirSync(path.join(dir, 'done'), { recursive: true });
      fs.renameSync(file, path.join(dir, 'done', n));
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { results, errors };
}

/** One line about an import, for people. */
function describe(r) {
  const who = `${r.name ? `${r.name} (${r.id})` : r.id}${r.file ? ` from ${path.basename(r.file)}` : ''}`;
  if (!r.imported) return `Player ${who}: ${r.notes.join('; ')}.`;
  const what = [`${r.items} item${r.items === 1 ? '' : 's'}`, `${r.statistics} statistic${r.statistics === 1 ? '' : 's'}`];
  if (r.characters) what.push(`${r.characters} character${r.characters === 1 ? '' : 's'}`);
  const signIn = r.links.length ? `signs in with ${r.links.join(', ')}` : 'has no sign-in in the file, so the game can only find them by PlayFab ID';
  const notes = [...r.moved.map((m) => `${m.kind} moved from player ${m.from}`), ...r.notes];
  return `Brought back ${who}: ${what.join(', ')}; ${signIn}.${notes.length ? ` Note: ${notes.join('; ')}.` : ''}`;
}

module.exports = { importPlayer, importFile, importFolder, readPlayerFile, describe };
