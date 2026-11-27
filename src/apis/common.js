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

module.exports = { targetPlayer, takesPlayFabId };
