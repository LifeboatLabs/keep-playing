'use strict';
// Helpers the call files share.

const spec = require('../spec');
const { fail } = require('../errors');

// Does this call's request have a PlayFabId field?
const takesPlayFabId = (call) => {
  const t = call && spec.type(call.api, call.request);
  return !!(t && t.p && t.p.some((p) => p[0] === 'PlayFabId'));
};

// The player a call is about. Servers name the player with PlayFabId. Players
// get themselves, unless the call is one where PlayFab lets them name someone
// else (only ever to read). A PlayFabId sent to any other call is ignored, so a
// player can't change someone else's things.
function targetPlayer(app, body, ctx) {
  const named = body.PlayFabId !== undefined && body.PlayFabId !== null && body.PlayFabId !== '';
  if (ctx.player && (!named || (!ctx.server && !takesPlayFabId(ctx.call)))) return ctx.player;
  if (!named) throw fail('InvalidParams', 'Invalid input parameters', 400, { PlayFabId: ['The PlayFabId field is required.'] });
  const p = app.players.byId(body.PlayFabId);
  if (!p) throw fail('AccountNotFound', 'User not found');
  return p;
}

// Finds where an entity's things of one kind ('objects' or 'files') live, and
// checks the caller may use them. Anyone may look; only the player themselves
// or the game's own server may change a player's, and only the server the
// title's. save() counts a new profile version; keep() saves without one.
function entityHolder(app, entityKey, ctx, write, kind) {
  const key = entityKey || ctx.entity;
  if (!key || typeof key.Id !== 'string') throw fail('InvalidParams', 'Invalid input parameters', 400, { Entity: ['The Entity field is required.'] });
  const type = key.Type || key.TypeString;
  if (type === 'title_player_account' || type === 'master_player_account') {
    const p = type === 'title_player_account' ? app.players.byEntity(key.Id) : app.players.byId(key.Id);
    if (!p) throw fail('ProfileDoesNotExist', `There is no ${type} ${key.Id}.`);
    const mine = ctx.player && ctx.player.id === p.id;
    if (!mine && !ctx.server && write) throw fail('NotAuthorized', `Players can only change their own ${kind}.`, 403);
    const field = type === 'title_player_account' ? kind : `master${kind[0].toUpperCase()}${kind.slice(1)}`;
    return {
      entity: { Id: type === 'title_player_account' ? p.entityId : p.id, Type: type, TypeString: type },
      get: () => (p[field] = p[field] || {}),
      version: () => p.profileVersion || 0,
      save: () => {
        p.profileVersion = (p.profileVersion || 0) + 1;
        app.players.save(p);
        return p.profileVersion;
      },
      keep: () => app.players.save(p),
      player: p,
      type,
    };
  }
  if (type === 'title') {
    const t = app.title();
    if (write && !ctx.server) throw fail('NotAuthorized', `Only the game itself can change title ${kind}.`, 403);
    return {
      entity: { Id: t.titleId || key.Id, Type: 'title', TypeString: 'title' },
      get: () => (t[kind] = t[kind] || {}),
      version: () => t.objectsVersion || 0, // the title's profile version, whatever changed
      save: () => {
        t.objectsVersion = (t.objectsVersion || 0) + 1;
        app.saveTitle(t);
        return t.objectsVersion;
      },
      keep: () => app.saveTitle(t),
      type,
    };
  }
  throw fail('NotImplemented', `Keep Playing doesn't support ${type || 'that kind of'} entities yet.`, 501);
}

// Looks a name up in a plain object without finding the names every object
// has built in, like "constructor", which a request could otherwise send.
function own(map, key) {
  if (!map || (typeof key !== 'string' && typeof key !== 'number')) return undefined;
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

module.exports = { targetPlayer, takesPlayFabId, own, entityHolder };
