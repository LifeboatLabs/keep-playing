'use strict';
// Characters: a player can have several, each with its own data, statistics,
// inventory and virtual currency. Character IDs only need to be unique within
// one player, like on PlayFab.

const { fail } = require('../errors');
const { hexId } = require('../tokens');
const { targetPlayer, own } = require('./common');
const data = require('./data');
const economy = require('./economy');

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

function findCharacter(p, id) {
  const c = own(p.characters, id);
  if (!c) throw fail('CharacterNotFound', `This player has no character ${id}.`);
  return c;
}

module.exports = function register(on, app) {
  const serverPlayer = (body) => {
    const p = app.players.byId(body.PlayFabId);
    if (!p) throw fail('AccountNotFound', 'User not found');
    return p;
  };

  function create(p, name, type, now) {
    p.characters = p.characters || {};
    let id;
    do id = hexId(8); while (p.characters[id]);
    p.characters[id] = {
      id,
      name: String(name),
      type: String(type),
      created: now.toISOString(),
      data: { CharacterData: {}, CharacterReadOnlyData: {}, CharacterInternalData: {} },
      dataVersion: 0,
      stats: {},
      inventory: [],
      vc: {},
    };
    app.players.save(p);
    return p.characters[id];
  }

  const list = (p) => Object.values(p.characters || {}).map((c) => ({ CharacterId: c.id, CharacterName: c.name, CharacterType: c.type }));
  on('/Client/GetAllUsersCharacters', (body, ctx) => ({ Characters: list(targetPlayer(app, body, ctx)) }));
  on('/Server/GetAllUsersCharacters', (body) => ({ Characters: list(serverPlayer(body)) }));

  // Players turn an item that "can become a character" into one, and the item
  // is used up (one use, if it has several). PlayFab's documentation doesn't
  // say either of these outright, or what the character type is; we use the
  // item's ID. The error names are our best guess too.
  on('/Client/GrantCharacterToUser', (body, ctx) => {
    const p = ctx.player;
    const inst = p.inventory.find((i) => i.ItemId === body.ItemId && (!body.CatalogVersion || i.CatalogVersion === body.CatalogVersion));
    if (!inst) throw fail('ItemNotFound', `The player doesn't have a ${body.ItemId}.`);
    const item = economy.findItem(app.title(), inst.CatalogVersion, inst.ItemId);
    if (!item || !item.CanBecomeCharacter) throw fail('InvalidItemProperties', `${body.ItemId} can't become a character.`);
    if (typeof inst.RemainingUses === 'number' && inst.RemainingUses > 1) inst.RemainingUses -= 1;
    else p.inventory = p.inventory.filter((i) => i !== inst);
    const c = create(p, body.CharacterName, item.ItemId, ctx.now);
    return { CharacterId: c.id, CharacterType: c.type, Result: true };
  });
  on('/Server/GrantCharacterToUser', (body, ctx) => ({ CharacterId: create(serverPlayer(body), body.CharacterName, body.CharacterType, ctx.now).id }));

  on('/Server/DeleteCharacterFromUser', (body) => {
    const p = serverPlayer(body);
    const c = findCharacter(p, body.CharacterId);
    if (body.SaveCharacterInventory) p.inventory.push(...c.inventory);
    delete p.characters[c.id];
    app.players.save(p);
    return {};
  });

  // Character data, like player data.
  const getData = (kind, serverSide) => (body, ctx) => {
    const p = serverSide ? serverPlayer(body) : targetPlayer(app, body, ctx);
    const c = findCharacter(p, body.CharacterId);
    const isSelf = ctx.server || (ctx.player && ctx.player.id === p.id);
    const unchanged = typeof body.IfChangedFromDataVersion === 'number' && c.dataVersion <= body.IfChangedFromDataVersion;
    const out = { CharacterId: c.id, Data: unchanged ? {} : data.read(c, kind, body.Keys, isSelf), DataVersion: c.dataVersion };
    if (serverSide) out.PlayFabId = p.id;
    return out;
  };
  const setData = (kind, serverSide) => (body, ctx) => {
    const p = serverSide ? serverPlayer(body) : ctx.player;
    const c = findCharacter(p, body.CharacterId);
    const version = data.write(c, kind, body, ctx.now, kind !== 'CharacterInternalData');
    app.players.save(p);
    return { DataVersion: version };
  };
  on('/Client/GetCharacterData', getData('CharacterData', false));
  on('/Client/GetCharacterReadOnlyData', getData('CharacterReadOnlyData', false));
  on('/Client/UpdateCharacterData', setData('CharacterData', false));
  on('/Server/GetCharacterData', getData('CharacterData', true));
  on('/Server/GetCharacterReadOnlyData', getData('CharacterReadOnlyData', true));
  on('/Server/GetCharacterInternalData', getData('CharacterInternalData', true));
  on('/Server/UpdateCharacterData', setData('CharacterData', true));
  on('/Server/UpdateCharacterReadOnlyData', setData('CharacterReadOnlyData', true));
  on('/Server/UpdateCharacterInternalData', setData('CharacterInternalData', true));

  // Character statistics are plain named numbers; a new value replaces the old one.
  const getStats = (serverSide) => (body, ctx) => {
    const p = serverSide ? serverPlayer(body) : ctx.player;
    const c = findCharacter(p, body.CharacterId);
    const out = { CharacterStatistics: { ...c.stats } };
    if (serverSide) Object.assign(out, { CharacterId: c.id, PlayFabId: p.id });
    return out;
  };
  const setStats = (serverSide) => (body, ctx) => {
    if (!serverSide && !ctx.title.settings.allowClientStatistics) {
      throw fail('APINotEnabledForGameClientAccess', 'This game does not let players post their own statistics. Turn on allowClientStatistics in title.json.');
    }
    const p = serverSide ? serverPlayer(body) : ctx.player;
    const c = findCharacter(p, body.CharacterId);
    for (const [name, value] of Object.entries(body.CharacterStatistics || {})) {
      // Like player statistics: a value has to be a whole number that fits in 32 bits.
      if (!Number.isInteger(value) || value > INT32_MAX || value < INT32_MIN) {
        throw fail('InvalidParams', 'Invalid input parameters', 400, { CharacterStatistics: [`The value for ${name} should be a whole number.`] });
      }
    }
    Object.assign(c.stats, body.CharacterStatistics || {});
    app.players.save(p);
    return {};
  };
  on('/Client/GetCharacterStatistics', getStats(false));
  on('/Client/UpdateCharacterStatistics', setStats(false));
  on('/Server/GetCharacterStatistics', getStats(true));
  on('/Server/UpdateCharacterStatistics', setStats(true));
  on('/Admin/ResetCharacterStatistics', (body) => {
    const p = serverPlayer(body);
    findCharacter(p, body.CharacterId).stats = {};
    app.players.save(p);
    return {};
  });

  // Character leaderboards: every character with a value, highest first.
  function board(name, type) {
    const rows = [];
    for (const p of app.players.all()) {
      for (const c of Object.values(p.characters || {})) {
        if (type && c.type !== type) continue;
        if (typeof c.stats[name] === 'number') rows.push({ p, c, value: c.stats[name] });
      }
    }
    rows.sort((a, b) => b.value - a.value || (a.c.created < b.c.created ? -1 : 1));
    return rows;
  }
  const entry = (r, position) => ({
    CharacterId: r.c.id,
    CharacterName: r.c.name,
    CharacterType: r.c.type,
    DisplayName: r.p.displayName || undefined,
    PlayFabId: r.p.id,
    Position: position,
    StatValue: r.value,
  });
  const count = (n) => Math.max(0, Math.min(100, Number.isInteger(n) ? n : 10));

  const leaderboard = (body) => {
    const rows = board(body.StatisticName, body.CharacterType);
    const start = Math.max(0, body.StartPosition || 0);
    return { Leaderboard: rows.slice(start, start + count(body.MaxResultsCount)).map((r, i) => entry(r, start + i)) };
  };
  const around = (serverSide) => (body, ctx) => {
    const p = serverSide ? serverPlayer(body) : ctx.player;
    const c = findCharacter(p, body.CharacterId);
    const rows = board(body.StatisticName, body.CharacterType);
    const n = count(body.MaxResultsCount);
    let index = rows.findIndex((r) => r.c === c);
    if (index === -1) {
      rows.push({ p, c, value: 0 });
      index = rows.length - 1;
    }
    const start = Math.max(0, Math.min(index - Math.floor((n - 1) / 2), rows.length - n));
    return { Leaderboard: rows.slice(start, start + n).map((r, i) => entry(r, start + i)) };
  };
  const forUser = (serverSide) => (body, ctx) => {
    const p = serverSide ? serverPlayer(body) : ctx.player;
    const all = board(body.StatisticName);
    const mine = [];
    all.forEach((r, i) => {
      if (r.p.id === p.id) mine.push(entry(r, i));
    });
    return { Leaderboard: mine.slice(0, count(body.MaxResultsCount)) };
  };
  on('/Client/GetCharacterLeaderboard', leaderboard);
  on('/Server/GetCharacterLeaderboard', leaderboard);
  on('/Client/GetLeaderboardAroundCharacter', around(false));
  on('/Server/GetLeaderboardAroundCharacter', around(true));
  on('/Client/GetLeaderboardForUserCharacters', forUser(false));
  on('/Server/GetLeaderboardForUserCharacters', forUser(true));

  // Character inventory and currency.
  const balances = (c) => {
    const out = {};
    for (const cur of app.title().currencies) out[cur.CurrencyCode] = c.vc[cur.CurrencyCode] || 0;
    return { ...out, ...c.vc };
  };
  const getInventory = (serverSide) => (body, ctx) => {
    const p = serverSide ? serverPlayer(body) : ctx.player;
    const c = findCharacter(p, body.CharacterId);
    const out = { CharacterId: c.id, Inventory: economy.inventory(c), VirtualCurrency: balances(c), VirtualCurrencyRechargeTimes: {} };
    if (serverSide) out.PlayFabId = p.id;
    return out;
  };
  on('/Client/GetCharacterInventory', getInventory(false));
  on('/Server/GetCharacterInventory', getInventory(true));

  on('/Server/GrantItemsToCharacter', (body, ctx) => {
    const t = app.title();
    const p = serverPlayer(body);
    const c = findCharacter(p, body.CharacterId);
    const results = [];
    for (const id of body.ItemIds || []) {
      const item = economy.findItem(t, body.CatalogVersion, id);
      if (!item) {
        results.push({ ItemId: id, PlayFabId: p.id, CharacterId: c.id, Result: false, UnitPrice: 0 });
        continue;
      }
      for (const inst of economy.grant(t, c, item, ctx.now, { annotation: body.Annotation })) {
        results.push({ ...inst, PlayFabId: p.id, CharacterId: c.id, Result: true });
      }
    }
    app.players.save(p);
    return { ItemGrantResults: results };
  });

  const move = (from, to, instanceId) => {
    const inst = from.inventory.find((i) => i.ItemInstanceId === instanceId);
    if (!inst) throw fail('ItemNotFound', 'That item isn\'t in that inventory.');
    from.inventory = from.inventory.filter((i) => i !== inst);
    to.inventory.push(inst);
  };
  on('/Server/MoveItemToCharacterFromUser', (body) => {
    const p = serverPlayer(body);
    move(p, findCharacter(p, body.CharacterId), body.ItemInstanceId);
    app.players.save(p);
    return {};
  });
  on('/Server/MoveItemToUserFromCharacter', (body) => {
    const p = serverPlayer(body);
    move(findCharacter(p, body.CharacterId), p, body.ItemInstanceId);
    app.players.save(p);
    return {};
  });
  on('/Server/MoveItemToCharacterFromCharacter', (body) => {
    const p = serverPlayer(body);
    move(findCharacter(p, body.GivingCharacterId), findCharacter(p, body.ReceivingCharacterId), body.ItemInstanceId);
    app.players.save(p);
    return {};
  });

  const changeCurrency = (sign) => (body) => {
    const p = serverPlayer(body);
    const c = findCharacter(p, body.CharacterId);
    if (!app.title().currencies.some((cur) => cur.CurrencyCode === body.VirtualCurrency)) {
      throw fail('InvalidVirtualCurrency', `This game has no currency called ${body.VirtualCurrency}.`);
    }
    if (!Number.isInteger(body.Amount) || body.Amount < 0) {
      throw fail('InvalidParams', 'Invalid input parameters', 400, { Amount: ['Amount should be a whole number, 0 or more.'] });
    }
    c.vc[body.VirtualCurrency] = (c.vc[body.VirtualCurrency] || 0) + sign * body.Amount;
    app.players.save(p);
    return { Balance: c.vc[body.VirtualCurrency], VirtualCurrency: body.VirtualCurrency };
  };
  on('/Server/AddCharacterVirtualCurrency', changeCurrency(1));
  on('/Server/SubtractCharacterVirtualCurrency', changeCurrency(-1));
};

module.exports.findCharacter = findCharacter;
