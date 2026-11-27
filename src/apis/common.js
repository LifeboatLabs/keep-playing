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

// Looks a name up in a plain object without finding the names every object
// has built in, like "constructor", which a request could otherwise send.
function own(map, key) {
  if (!map || (typeof key !== 'string' && typeof key !== 'number')) return undefined;
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

module.exports = { targetPlayer, takesPlayFabId, own };
