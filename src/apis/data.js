'use strict';
// Player data (the key/value saves most games use) and title data.

const { fail } = require('../errors');
const { targetPlayer } = require('./common');

const VERSION_FIELD = { UserReadOnlyData: 'readOnlyDataVersion', UserPublisherReadOnlyData: 'readOnlyDataVersion' };

// Returns a copy of the player's records of one kind, limited to `keys` if given.
// Other players only see records marked Public.
function read(p, kind, keys, isSelf) {
  const records = p.data[kind] || {};
  const wanted = Array.isArray(keys) && keys.length ? new Set(keys) : null;
  const out = {};
  for (const [k, r] of Object.entries(records)) {
    if (wanted && !wanted.has(k)) continue;
    if (!isSelf && r.Permission !== 'Public') continue;
    out[k] = { Value: r.Value, LastUpdated: r.LastUpdated, Permission: r.Permission };
  }
  return out;
}

function pick(map, keys) {
  const wanted = Array.isArray(keys) && keys.length ? keys : null;
  if (!wanted) return { ...map };
  const out = {};
  for (const k of wanted) if (Object.prototype.hasOwnProperty.call(map, k)) out[k] = map[k];
  return out;
}

function checkKeys(data, keysToRemove) {
  const details = {};
  for (const k of Object.keys(data || {})) {
    if (!k.trim()) details.Data = ['Keys can\'t be empty.'];
    else if (k.trim().startsWith('!')) details.Data = [`Keys can't start with "!" (${k}).`];
  }
  if (keysToRemove !== undefined && keysToRemove !== null && !Array.isArray(keysToRemove)) details.KeysToRemove = ['KeysToRemove should be a list.'];
  if (Object.keys(details).length) throw fail('InvalidParams', 'Invalid input parameters', 400, details);
}

// Writes records. A null value removes the key, like KeysToRemove does.
function write(p, kind, body, now, withPermission) {
  checkKeys(body.Data, body.KeysToRemove);
  const records = (p.data[kind] = p.data[kind] || {});
  const at = now.toISOString();
  const permission = withPermission ? (body.Permission === 'Public' ? 'Public' : 'Private') : undefined;
  for (const [rawKey, value] of Object.entries(body.Data || {})) {
    const k = rawKey.trim();
    if (value === null || value === undefined) {
      delete records[k];
      continue;
    }
    records[k] = { Value: typeof value === 'string' ? value : JSON.stringify(value), LastUpdated: at, Permission: permission };
  }
  for (const k of body.KeysToRemove || []) delete records[String(k).trim()];
  const versionField = VERSION_FIELD[kind] || 'dataVersion';
  p[versionField] = (p[versionField] || 0) + 1;
  return p[versionField];
}

module.exports = function register(on, app) {
  const target = (body, ctx) => targetPlayer(app, body, ctx);

  const getter = (kind, versionField = VERSION_FIELD[kind] || 'dataVersion') => (body, ctx) => {
    const p = target(body, ctx);
    const isSelf = ctx.server || (ctx.player && ctx.player.id === p.id);
    const version = p[versionField] || 0;
    const unchanged = typeof body.IfChangedFromDataVersion === 'number' && version <= body.IfChangedFromDataVersion;
    const result = { Data: unchanged ? {} : read(p, kind, body.Keys, isSelf), DataVersion: version };
    if (ctx.server) result.PlayFabId = p.id;
    return result;
  };

  const setter = (kind, withPermission) => (body, ctx) => {
    const p = target(body, ctx);
    const version = write(p, kind, body, ctx.now, withPermission);
    app.players.save(p);
    return { DataVersion: version };
  };

  // Client: a player's own data, or another player's public data.
  on('/Client/GetUserData', getter('UserData'));
  on('/Client/GetUserReadOnlyData', getter('UserReadOnlyData'));
  on('/Client/GetUserPublisherData', getter('UserPublisherData'));
  on('/Client/GetUserPublisherReadOnlyData', getter('UserPublisherReadOnlyData'));
  on('/Client/UpdateUserData', (body, ctx) => setter('UserData', true)({ ...body, PlayFabId: undefined }, ctx));
  on('/Client/UpdateUserPublisherData', (body, ctx) => setter('UserPublisherData', true)({ ...body, PlayFabId: undefined }, ctx));

  // Server and Admin: any player's data of every kind.
  for (const api of ['Server', 'Admin']) {
    on(`/${api}/GetUserData`, getter('UserData'));
    on(`/${api}/GetUserReadOnlyData`, getter('UserReadOnlyData'));
    on(`/${api}/GetUserInternalData`, getter('UserInternalData'));
    on(`/${api}/GetUserPublisherData`, getter('UserPublisherData'));
    on(`/${api}/GetUserPublisherReadOnlyData`, getter('UserPublisherReadOnlyData'));
    on(`/${api}/GetUserPublisherInternalData`, getter('UserPublisherInternalData'));
    on(`/${api}/UpdateUserData`, setter('UserData', true));
    on(`/${api}/UpdateUserReadOnlyData`, setter('UserReadOnlyData', true));
    on(`/${api}/UpdateUserInternalData`, setter('UserInternalData', false));
    on(`/${api}/UpdateUserPublisherData`, setter('UserPublisherData', true));
    on(`/${api}/UpdateUserPublisherReadOnlyData`, setter('UserPublisherReadOnlyData', true));
    on(`/${api}/UpdateUserPublisherInternalData`, setter('UserPublisherInternalData', false));
  }

  // Title data: settings the whole game shares.
  const titleGetter = (field) => (body) => ({ Data: pick(app.title()[field], body.Keys) });
  const titleSetter = (field) => (body) => {
    const t = app.title();
    const key = String(body.Key).trim();
    if (!key) throw fail('InvalidParams', 'Invalid input parameters', 400, { Key: ['The Key field is required.'] });
    // PlayFab: "Set to null to remove a value". An empty string is kept.
    if (body.Value === null || body.Value === undefined) delete t[field][key];
    else t[field][key] = String(body.Value);
    app.saveTitle(t);
    return {};
  };

  on('/Client/GetTitleData', titleGetter('titleData'));
  on('/Client/GetPublisherData', titleGetter('publisherData'));
  for (const api of ['Server', 'Admin']) {
    on(`/${api}/GetTitleData`, titleGetter('titleData'));
    on(`/${api}/SetTitleData`, titleSetter('titleData'));
    on(`/${api}/GetTitleInternalData`, titleGetter('titleInternalData'));
    on(`/${api}/SetTitleInternalData`, titleSetter('titleInternalData'));
    on(`/${api}/GetPublisherData`, titleGetter('publisherData'));
    on(`/${api}/SetPublisherData`, titleSetter('publisherData'));
  }
};

module.exports.read = read;
module.exports.pick = pick;
module.exports.write = write;
