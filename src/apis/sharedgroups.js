'use strict';
// Shared groups: a small set of players who share key/value data, like a
// clan's base or a turn-based match. PlayFab's rules, from its documentation:
// - anyone may read a group's public keys and its member list;
// - only members (or the game's server) may change data or members;
// - when the last member leaves, the group and its data are deleted.

const crypto = require('node:crypto');
const { fail } = require('../errors');

module.exports = function register(on, app) {
  const store = app.store;
  const find = (id) => {
    const g = typeof id === 'string' ? store.get('sharedGroups', id) : null;
    if (!g) throw fail('InvalidSharedGroupId', `There is no shared group called ${id}.`);
    return g;
  };
  const save = (g) => store.put('sharedGroups', g.id, g);
  const isMember = (g, ctx) => ctx.server || (ctx.player && g.members.includes(ctx.player.id));
  const membersOnly = (g, ctx) => {
    if (!isMember(g, ctx)) throw fail('NotAuthorized', 'Only members of this shared group can change it.', 403);
  };

  const create = (body, ctx) => {
    const id = body.SharedGroupId ? String(body.SharedGroupId) : crypto.randomBytes(8).toString('hex').toUpperCase();
    if (store.has('sharedGroups', id)) throw fail('InvalidSharedGroupId', `There is already a shared group called ${id}.`);
    save({ id, members: ctx.player ? [ctx.player.id] : [], data: {} });
    return { SharedGroupId: id };
  };

  const get = (body, ctx) => {
    const g = find(body.SharedGroupId);
    const member = isMember(g, ctx);
    const wanted = Array.isArray(body.Keys) && body.Keys.length ? new Set(body.Keys) : null;
    const data = {};
    for (const [k, r] of Object.entries(g.data)) {
      if (wanted && !wanted.has(k)) continue;
      if (!member && r.Permission !== 'Public') continue;
      data[k] = { Value: r.Value, LastUpdated: r.LastUpdated, LastUpdatedBy: r.LastUpdatedBy, Permission: r.Permission };
    }
    const out = { Data: data };
    if (body.GetMembers) out.Members = [...g.members];
    return out;
  };

  const update = (body, ctx) => {
    const g = find(body.SharedGroupId);
    membersOnly(g, ctx);
    const at = ctx.now.toISOString();
    const permission = body.Permission === 'Public' ? 'Public' : 'Private';
    for (const [rawKey, value] of Object.entries(body.Data || {})) {
      const k = rawKey.trim();
      if (!k) throw fail('InvalidParams', 'Invalid input parameters', 400, { Data: ['Keys can\'t be empty.'] });
      if (value === null || value === undefined) {
        delete g.data[k];
        continue;
      }
      g.data[k] = {
        Value: typeof value === 'string' ? value : JSON.stringify(value),
        LastUpdated: at,
        LastUpdatedBy: ctx.player ? ctx.player.id : undefined,
        Permission: permission,
      };
    }
    for (const k of body.KeysToRemove || []) delete g.data[String(k).trim()];
    save(g);
    return {};
  };

  const addMembers = (body, ctx) => {
    const g = find(body.SharedGroupId);
    membersOnly(g, ctx);
    for (const id of body.PlayFabIds) {
      const p = app.players.byId(id);
      if (!p) throw fail('AccountNotFound', `User ${id} not found`);
      if (!g.members.includes(p.id)) g.members.push(p.id);
    }
    save(g);
    return {};
  };

  const removeMembers = (body, ctx) => {
    const g = find(body.SharedGroupId);
    membersOnly(g, ctx);
    const gone = new Set(body.PlayFabIds.map((id) => String(id).toUpperCase()));
    g.members = g.members.filter((id) => !gone.has(id));
    if (g.members.length) save(g);
    else store.delete('sharedGroups', g.id); // nobody left: PlayFab deletes the group
    return {};
  };

  for (const api of ['Client', 'Server']) {
    on(`/${api}/CreateSharedGroup`, create);
    on(`/${api}/GetSharedGroupData`, get);
    on(`/${api}/UpdateSharedGroupData`, update);
    on(`/${api}/AddSharedGroupMembers`, addMembers);
    on(`/${api}/RemoveSharedGroupMembers`, removeMembers);
  }
  on('/Server/DeleteSharedGroup', (body) => {
    find(body.SharedGroupId);
    store.delete('sharedGroups', body.SharedGroupId);
    return {};
  });
};
