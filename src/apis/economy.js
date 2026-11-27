'use strict';
// PlayFab's classic economy: catalogs, stores, virtual currency and inventory.

const { fail } = require('../errors');
const { targetPlayer } = require('./common');
const { hexId } = require('../tokens');
const { normaliseItem } = require('../title');

const DAY_S = 24 * 60 * 60;

function catalog(title, version) {
  const v = version || title.primaryCatalog;
  return (v && title.catalogs[v]) || null;
}

function findItem(title, version, itemId) {
  const list = catalog(title, version);
  return list ? list.find((i) => i.ItemId === itemId) || null : null;
}

const clean = (o) => JSON.parse(JSON.stringify(o));

function instance(item, now, extra = {}) {
  const inst = {
    ItemId: item.ItemId,
    ItemInstanceId: hexId(8),
    ItemClass: item.ItemClass,
    PurchaseDate: now.toISOString(),
    CatalogVersion: item.CatalogVersion,
    DisplayName: item.DisplayName,
    UnitCurrency: extra.unitCurrency,
    UnitPrice: extra.unitPrice || 0,
    Annotation: extra.annotation,
    BundleParent: extra.bundleParent,
  };
  const c = item.Consumable;
  if (c && c.UsageCount) inst.RemainingUses = c.UsageCount;
  if (c && c.UsagePeriod) inst.Expiration = new Date(now.getTime() + c.UsagePeriod * 1000).toISOString();
  return inst;
}

// Drops items whose time ran out.
function prune(p, now) {
  const before = p.inventory.length;
  p.inventory = p.inventory.filter((i) => !i.Expiration || new Date(i.Expiration) > now);
  return p.inventory.length !== before;
}

function inventory(p) {
  return clean(p.inventory);
}

// Gives the player an item, and everything inside it if it's a bundle.
// Returns copies of every item instance created or topped up.
function grant(title, p, item, now, extra = {}) {
  const out = [];
  const add = (it, more) => {
    if (it.IsStackable) {
      const existing = p.inventory.find((i) => i.ItemId === it.ItemId && i.CatalogVersion === it.CatalogVersion && !i.BundleParent);
      if (existing) {
        const by = (it.Consumable && it.Consumable.UsageCount) || 1;
        existing.RemainingUses = (existing.RemainingUses || 0) + by;
        existing.UsesIncrementedBy = by;
        out.push(existing);
        return existing;
      }
    }
    const inst = instance(it, now, more);
    p.inventory.push(inst);
    out.push(inst);
    return inst;
  };
  const top = add(item, extra);
  if (item.Bundle) {
    const contents = [];
    for (const id of item.Bundle.BundledItems || []) {
      const child = findItem(title, item.CatalogVersion, id);
      if (child) contents.push(add(child, { bundleParent: top.ItemInstanceId, annotation: extra.annotation }).ItemInstanceId);
    }
    if (contents.length) top.BundleContents = contents;
    for (const [code, amount] of Object.entries(item.Bundle.BundledVirtualCurrencies || {})) p.vc[code] = (p.vc[code] || 0) + amount;
  }
  return out.map(clean);
}

// Balances, after topping up currencies that recharge over time.
function currency(app, p, now) {
  const title = app.title();
  p.vcRecharge = p.vcRecharge || {};
  const recharge = {};
  let changed = false;
  for (const c of title.currencies) {
    if (!(c.CurrencyCode in p.vc)) {
      // Currency added after this player joined: PlayFab shows 0 (the starting
      // amount only goes to new players).
      p.vc[c.CurrencyCode] = 0;
      changed = true;
    }
    if (!c.RechargeRate || c.RechargeRate <= 0) continue;
    const code = c.CurrencyCode;
    const perUnit = DAY_S / c.RechargeRate; // seconds per unit
    let last = p.vcRecharge[code] ? new Date(p.vcRecharge[code]) : now;
    if (p.vc[code] >= c.RechargeMax) {
      last = now;
    } else {
      const units = Math.floor((now - last) / 1000 / perUnit);
      if (units > 0) {
        p.vc[code] = Math.min(c.RechargeMax, p.vc[code] + units);
        last = p.vc[code] >= c.RechargeMax ? now : new Date(last.getTime() + units * perUnit * 1000);
        changed = true;
      }
    }
    if (p.vcRecharge[code] !== last.toISOString()) {
      p.vcRecharge[code] = last.toISOString();
      changed = true;
    }
    const full = p.vc[code] >= c.RechargeMax;
    const nextAt = full ? now : new Date(last.getTime() + perUnit * 1000);
    recharge[code] = {
      RechargeMax: c.RechargeMax,
      RechargeTime: nextAt.toISOString(),
      SecondsToRecharge: full ? 0 : Math.max(0, Math.ceil((nextAt - now) / 1000)),
    };
  }
  if (changed) app.players.save(p);
  return { balances: { ...p.vc }, recharge };
}

module.exports = function register(on, app) {
  const target = (body, ctx) => targetPlayer(app, body, ctx);
  const noCharacters = (body) => {
    if (body.CharacterId) throw fail('CharacterNotFound', "Keep Playing doesn't support characters yet.");
  };
  const knownCurrency = (code) => {
    if (!app.title().currencies.some((c) => c.CurrencyCode === code)) {
      throw fail('InvalidVirtualCurrency', `This game has no currency called ${code}.`);
    }
  };

  // Catalogs and stores.
  const getCatalog = (body) => ({ Catalog: clean(catalog(app.title(), body.CatalogVersion) || []) });
  const getStore = (body) => {
    const t = app.title();
    const s = t.stores[body.StoreId];
    if (!s) throw fail('StoreNotFound', `There is no store called ${body.StoreId}.`);
    return {
      Store: clean(s.items),
      StoreId: body.StoreId,
      CatalogVersion: s.catalogVersion || body.CatalogVersion || t.primaryCatalog || undefined,
      MarketingData: s.marketing ? clean(s.marketing) : undefined,
      Source: 'Admin',
    };
  };
  for (const api of ['Client', 'Server', 'Admin']) {
    on(`/${api}/GetCatalogItems`, getCatalog);
    on(`/${api}/GetStoreItems`, getStore);
  }

  // Inventory and balances.
  const getInventory = (body, ctx) => {
    noCharacters(body);
    const p = target(body, ctx);
    if (prune(p, ctx.now)) app.players.save(p);
    const vc = currency(app, p, ctx.now);
    const out = { Inventory: inventory(p), VirtualCurrency: vc.balances, VirtualCurrencyRechargeTimes: vc.recharge };
    if (ctx.server) out.PlayFabId = p.id;
    return out;
  };
  on('/Client/GetUserInventory', getInventory);
  on('/Server/GetUserInventory', getInventory);
  on('/Admin/GetUserInventory', getInventory);

  const changeCurrency = (sign, fromClient) => (body, ctx) => {
    if (fromClient && !ctx.title.settings.allowClientCurrency) {
      throw fail('APINotEnabledForGameClientAccess', 'This game does not let players change their own currency. Turn on allowClientCurrency in title.json.');
    }
    const p = fromClient ? ctx.player : target(body, ctx);
    knownCurrency(body.VirtualCurrency);
    if (!Number.isInteger(body.Amount) || body.Amount < 0) {
      throw fail('InvalidParams', 'Invalid input parameters', 400, { Amount: ['Amount should be a whole number, 0 or more.'] });
    }
    currency(app, p, ctx.now);
    const change = sign * body.Amount;
    p.vc[body.VirtualCurrency] = (p.vc[body.VirtualCurrency] || 0) + change; // PlayFab lets balances go below 0 here
    app.players.save(p);
    return { PlayFabId: p.id, VirtualCurrency: body.VirtualCurrency, BalanceChange: change, Balance: p.vc[body.VirtualCurrency] };
  };
  on('/Client/AddUserVirtualCurrency', changeCurrency(1, true));
  on('/Client/SubtractUserVirtualCurrency', changeCurrency(-1, true));
  for (const api of ['Server', 'Admin']) {
    on(`/${api}/AddUserVirtualCurrency`, changeCurrency(1, false));
    on(`/${api}/SubtractUserVirtualCurrency`, changeCurrency(-1, false));
  }

  on('/Client/PurchaseItem', (body, ctx) => {
    noCharacters(body);
    const t = app.title();
    const p = ctx.player;
    const item = findItem(t, body.CatalogVersion, body.ItemId);
    if (!item) throw fail('ItemNotFound', `There is no item called ${body.ItemId} in the catalog.`);
    let prices = item.VirtualCurrencyPrices || {};
    if (body.StoreId) {
      const s = t.stores[body.StoreId];
      if (!s) throw fail('StoreNotFound', `There is no store called ${body.StoreId}.`);
      const inStore = s.items.find((i) => i.ItemId === body.ItemId);
      if (!inStore) throw fail('ItemNotFound', `${body.ItemId} isn't sold in ${body.StoreId}.`);
      prices = inStore.VirtualCurrencyPrices || {};
    }
    const code = body.VirtualCurrency;
    if (code === 'RM') throw fail('WrongVirtualCurrency', "Real-money purchases can't happen on Keep Playing.");
    if (!Object.prototype.hasOwnProperty.call(prices, code)) throw fail('WrongVirtualCurrency', `${body.ItemId} can't be bought with ${code}.`);
    if (prices[code] !== body.Price) throw fail('WrongPrice', `${body.ItemId} costs ${prices[code]} ${code}, not ${body.Price}.`);
    currency(app, p, ctx.now);
    if ((p.vc[code] || 0) < body.Price) throw fail('InsufficientFunds', `Not enough ${code}.`);
    p.vc[code] -= body.Price;
    const items = grant(t, p, item, ctx.now, { unitCurrency: code, unitPrice: body.Price });
    app.players.save(p);
    return { Items: items };
  });

  const consume = (body, ctx) => {
    noCharacters(body);
    const p = target(body, ctx);
    const inst = p.inventory.find((i) => i.ItemInstanceId === body.ItemInstanceId);
    if (!inst) throw fail('ItemNotFound', 'That item isn\'t in the player\'s inventory.');
    if (typeof inst.RemainingUses !== 'number') throw fail('InvalidItemProperties', "That item can't be used up.");
    const count = body.ConsumeCount;
    if (!Number.isInteger(count) || count < 1) throw fail('InvalidParams', 'Invalid input parameters', 400, { ConsumeCount: ['ConsumeCount should be 1 or more.'] });
    if (inst.RemainingUses < count) throw fail('NoRemainingUses', 'That item doesn\'t have that many uses left.');
    inst.RemainingUses -= count;
    if (inst.RemainingUses === 0) p.inventory = p.inventory.filter((i) => i !== inst);
    app.players.save(p);
    return { ItemInstanceId: inst.ItemInstanceId, RemainingUses: inst.RemainingUses };
  };
  on('/Client/ConsumeItem', consume);
  on('/Server/ConsumeItem', consume);

  on('/Server/GrantItemsToUser', (body, ctx) => {
    const t = app.title();
    const p = target(body, ctx);
    const results = [];
    for (const id of body.ItemIds) {
      const item = findItem(t, body.CatalogVersion, id);
      if (!item) {
        results.push({ ItemId: id, PlayFabId: p.id, Result: false, UnitPrice: 0 });
        continue;
      }
      for (const inst of grant(t, p, item, ctx.now, { annotation: body.Annotation })) {
        results.push({ ...inst, PlayFabId: p.id, Result: true });
      }
    }
    app.players.save(p);
    return { ItemGrantResults: results };
  });

  const revokeOne = (p, id) => {
    const before = p.inventory.length;
    p.inventory = p.inventory.filter((i) => i.ItemInstanceId !== id);
    return p.inventory.length !== before;
  };
  for (const api of ['Server', 'Admin']) {
    on(`/${api}/RevokeInventoryItem`, (body, ctx) => {
      noCharacters(body);
      const p = target(body, ctx);
      if (!revokeOne(p, body.ItemInstanceId)) throw fail('ItemNotFound', 'That item isn\'t in the player\'s inventory.');
      app.players.save(p);
      return {};
    });
    on(`/${api}/RevokeInventoryItems`, (body) => {
      const errors = [];
      for (const it of body.Items || []) {
        const p = app.players.byId(it.PlayFabId);
        if (!p) errors.push({ Item: it, Error: 'AccountNotFound' });
        else if (!revokeOne(p, it.ItemInstanceId)) errors.push({ Item: it, Error: 'ItemNotFound' });
        else app.players.save(p);
      }
      return { Errors: errors };
    });
  }

  on('/Server/ModifyItemUses', (body, ctx) => {
    const p = target(body, ctx);
    const inst = p.inventory.find((i) => i.ItemInstanceId === body.ItemInstanceId);
    if (!inst) throw fail('ItemNotFound', 'That item isn\'t in the player\'s inventory.');
    const uses = (inst.RemainingUses || 0) + body.UsesToAdd;
    if (uses < 0) throw fail('NoRemainingUses', 'That would leave the item with fewer than 0 uses.');
    inst.RemainingUses = uses;
    if (uses === 0) p.inventory = p.inventory.filter((i) => i !== inst);
    app.players.save(p);
    return { ItemInstanceId: inst.ItemInstanceId, RemainingUses: uses };
  });

  on('/Server/UpdateUserInventoryItemCustomData', (body, ctx) => {
    noCharacters(body);
    const p = target(body, ctx);
    const inst = p.inventory.find((i) => i.ItemInstanceId === body.ItemInstanceId);
    if (!inst) throw fail('ItemNotFound', 'That item isn\'t in the player\'s inventory.');
    inst.CustomData = inst.CustomData || {};
    for (const [k, v] of Object.entries(body.Data || {})) {
      if (v === null || v === undefined) delete inst.CustomData[k];
      else inst.CustomData[k] = String(v);
    }
    for (const k of body.KeysToRemove || []) delete inst.CustomData[k];
    if (!Object.keys(inst.CustomData).length) delete inst.CustomData;
    app.players.save(p);
    return {};
  });

  // Containers: a box item, maybe opened with a key item.
  function unlock(p, containerInst, keyInst, ctx, version) {
    const t = app.title();
    const item = findItem(t, version || containerInst.CatalogVersion, containerInst.ItemId);
    if (!item || !item.Container) throw fail('InvalidContainerItem', `${containerInst.ItemId} isn't a container.`);
    const keyId = item.Container.KeyItemId;
    if (keyId) {
      if (!keyInst) keyInst = p.inventory.find((i) => i.ItemId === keyId);
      if (!keyInst || keyInst.ItemId !== keyId) throw fail('KeyNotOwned', `Opening this needs a ${keyId}.`);
    }
    const use = (inst) => {
      if (typeof inst.RemainingUses === 'number' && inst.RemainingUses > 1) inst.RemainingUses -= 1;
      else p.inventory = p.inventory.filter((i) => i !== inst);
    };
    use(containerInst);
    if (keyId) use(keyInst);
    const granted = [];
    for (const id of item.Container.ItemContents || []) {
      const child = findItem(t, item.CatalogVersion, id);
      if (child) granted.push(...grant(t, p, child, ctx.now, {}));
    }
    if ((item.Container.ResultTableContents || []).length) {
      app.warnOnce('droptables', 'a container uses drop tables, which Keep Playing does not support yet, so those items were not given.');
    }
    const vc = {};
    for (const [code, amount] of Object.entries(item.Container.VirtualCurrencyContents || {})) {
      p.vc[code] = (p.vc[code] || 0) + amount;
      vc[code] = amount;
    }
    app.players.save(p);
    return {
      UnlockedItemInstanceId: containerInst.ItemInstanceId,
      UnlockedWithItemInstanceId: keyId ? keyInst.ItemInstanceId : undefined,
      GrantedItems: granted,
      VirtualCurrency: vc,
    };
  }

  const unlockItem = (body, ctx) => {
    noCharacters(body);
    const p = target(body, ctx);
    const inst = p.inventory.find((i) => i.ItemId === body.ContainerItemId);
    if (!inst) throw fail('ContainerNotOwned', `The player doesn't have a ${body.ContainerItemId}.`);
    return unlock(p, inst, null, ctx, body.CatalogVersion);
  };
  const unlockInstance = (body, ctx) => {
    noCharacters(body);
    const p = target(body, ctx);
    const inst = p.inventory.find((i) => i.ItemInstanceId === body.ContainerItemInstanceId);
    if (!inst) throw fail('ContainerNotOwned', "The player doesn't have that container.");
    const key = body.KeyItemInstanceId ? p.inventory.find((i) => i.ItemInstanceId === body.KeyItemInstanceId) : null;
    if (body.KeyItemInstanceId && !key) throw fail('KeyNotOwned', "The player doesn't have that key.");
    return unlock(p, inst, key, ctx, body.CatalogVersion);
  };
  on('/Client/UnlockContainerItem', unlockItem);
  on('/Server/UnlockContainerItem', unlockItem);
  on('/Client/UnlockContainerInstance', unlockInstance);
  on('/Server/UnlockContainerInstance', unlockInstance);

  // Admin: setting up the economy.
  const setCatalog = (merge) => (body) => {
    const t = app.title();
    const version = body.CatalogVersion || t.primaryCatalog || 'Main';
    const items = (body.Catalog || []).map((i) => normaliseItem(i, version));
    if (merge && t.catalogs[version]) {
      const byId = new Map(t.catalogs[version].map((i) => [i.ItemId, i]));
      for (const i of items) byId.set(i.ItemId, i);
      t.catalogs[version] = [...byId.values()];
    } else {
      t.catalogs[version] = items;
    }
    if (body.SetAsDefaultCatalog || !t.primaryCatalog) t.primaryCatalog = version;
    app.saveTitle(t);
    return {};
  };
  on('/Admin/SetCatalogItems', setCatalog(false));
  on('/Admin/UpdateCatalogItems', setCatalog(true));

  const setStore = (merge) => (body) => {
    const t = app.title();
    const current = t.stores[body.StoreId];
    let items = clean(body.Store || []);
    if (merge && current) {
      const byId = new Map(current.items.map((i) => [i.ItemId, i]));
      for (const i of items) byId.set(i.ItemId, i);
      items = [...byId.values()];
    }
    t.stores[body.StoreId] = {
      catalogVersion: body.CatalogVersion || (current && current.catalogVersion) || null,
      items,
      marketing: body.MarketingData ? clean(body.MarketingData) : (current && current.marketing) || null,
    };
    app.saveTitle(t);
    return {};
  };
  on('/Admin/SetStoreItems', setStore(false));
  on('/Admin/UpdateStoreItems', setStore(true));
  on('/Admin/DeleteStore', (body) => {
    const t = app.title();
    if (!t.stores[body.StoreId]) throw fail('StoreNotFound', `There is no store called ${body.StoreId}.`);
    delete t.stores[body.StoreId];
    app.saveTitle(t);
    return {};
  });

  on('/Admin/AddVirtualCurrencyTypes', (body) => {
    const t = app.title();
    for (const v of body.VirtualCurrencies) {
      if (!/^[A-Z0-9]{2}$/.test(String(v.CurrencyCode)) || v.CurrencyCode === 'RM') {
        throw fail('InvalidVirtualCurrency', `Currency codes are two capital letters or digits (and not RM); "${v.CurrencyCode}" isn't one.`);
      }
      const entry = {
        CurrencyCode: v.CurrencyCode,
        DisplayName: v.DisplayName,
        InitialDeposit: v.InitialDeposit || 0,
        RechargeRate: v.RechargeRate || 0,
        RechargeMax: v.RechargeMax || 0,
      };
      const i = t.currencies.findIndex((c) => c.CurrencyCode === v.CurrencyCode);
      if (i >= 0) t.currencies[i] = entry;
      else t.currencies.push(entry);
    }
    app.saveTitle(t);
    return {};
  });
  on('/Admin/ListVirtualCurrencyTypes', () => ({ VirtualCurrencies: clean(app.title().currencies) }));
  on('/Admin/RemoveVirtualCurrencyTypes', (body) => {
    const t = app.title();
    const gone = new Set(body.VirtualCurrencies.map((v) => v.CurrencyCode));
    t.currencies = t.currencies.filter((c) => !gone.has(c.CurrencyCode));
    app.saveTitle(t);
    return {};
  });
};

module.exports.inventory = inventory;
module.exports.currency = currency;
module.exports.grant = grant;
module.exports.findItem = findItem;
