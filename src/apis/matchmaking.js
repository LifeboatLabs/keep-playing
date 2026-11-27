'use strict';
// Matchmaking: players (or the game's server) put tickets in a queue, and
// tickets that fit the queue's rules become a match. PlayFab runs this as a
// service and games find out by asking (GetMatchmakingTicket every few
// seconds) or through notifications. Keep Playing tries to match whenever a
// ticket is made, joined or asked about, so asking works; notifications
// (SubscribeToMatchmakingResource) aren't supported yet. Keep Playing can't
// start game servers either, so a queue that wants one still matches, just
// without server details.
//
// Rules it checks: match and ticket sizes, teams and team size balance,
// string equality, difference, set intersection, match total and region
// selection, each with its expansions over time. Weights only rank good
// matches against each other, so they aren't used: the oldest ticket is
// matched with the others that fit, in the order they came. Team difference
// and team ticket size similarity rules, and attributes taken from the
// player's entity rather than the ticket, aren't checked yet.

const crypto = require('node:crypto');
const { fail } = require('../errors');
const { own } = require('./common');

const ACTIVE = new Set(['WaitingForPlayers', 'WaitingForMatch', 'WaitingForServer']);
const MAX_ATTRIBUTES = 10 * 1024; // characters of JSON per player: ours, not PlayFab's
const KEEP_MS = 24 * 60 * 60 * 1000; // finished tickets and matches are kept a day: ours
const ANY = Symbol('any');

module.exports = function register(on, app) {
  const store = app.store;
  const callerId = (ctx) => (ctx.player ? ctx.player.entityId : null);
  const keyOf = (eid) => (eid === 'title'
    ? { Id: app.title().titleId || '', Type: 'title', TypeString: 'title' }
    : { Id: eid, Type: 'title_player_account', TypeString: 'title_player_account' });
  const clean = (o) => JSON.parse(JSON.stringify(o)); // drops fields left undefined

  // ---- queues

  function checkQueue(q, where = '') {
    const bad = (why) => fail('MatchmakingQueueConfigInvalid', `${where}${why}`);
    if (!q || typeof q !== 'object' || typeof q.Name !== 'string' || !q.Name.trim()) throw bad('A queue needs a Name.');
    const whole = (n) => Number.isInteger(n) && n >= 0;
    if (!whole(q.MinMatchSize) || q.MinMatchSize < 1) throw bad('MinMatchSize should be a whole number, 1 or more.');
    if (!whole(q.MaxMatchSize) || q.MaxMatchSize < q.MinMatchSize) throw bad('MaxMatchSize should be a whole number, at least MinMatchSize.');
    if (q.MaxTicketSize !== undefined && (!whole(q.MaxTicketSize) || q.MaxTicketSize < 1)) throw bad('MaxTicketSize should be a whole number, 1 or more.');
    if (q.Teams !== undefined && q.Teams !== null) {
      if (!Array.isArray(q.Teams)) throw bad('Teams should be a list.');
      const names = new Set();
      for (const t of q.Teams) {
        if (!t || typeof t.Name !== 'string' || !t.Name) throw bad('Each team needs a Name.');
        if (names.has(t.Name.toLowerCase())) throw bad(`There are two teams called ${t.Name}.`);
        names.add(t.Name.toLowerCase());
        if (!whole(t.MinTeamSize) || !whole(t.MaxTeamSize) || t.MinTeamSize > t.MaxTeamSize) throw bad(`Team ${t.Name} needs MinTeamSize no bigger than MaxTeamSize.`);
      }
      const min = q.Teams.reduce((n, t) => n + t.MinTeamSize, 0);
      const max = q.Teams.reduce((n, t) => n + t.MaxTeamSize, 0);
      if (min > q.MaxMatchSize || max < q.MinMatchSize) throw bad("The teams' sizes don't fit the match's sizes.");
    }
  }

  function queue(name) {
    const q = own(app.title().matchmakingQueues || {}, name);
    if (!q) throw fail('MatchmakingQueueNotFound', `There is no matchmaking queue called ${name}.`);
    checkQueue(q, `The queue ${name} in the title's settings is set up wrongly: `);
    return q;
  }

  const titleOnly = (ctx) => {
    if (!ctx.server) throw fail('MatchmakingUnauthorized', "Only the game's server can do that.", 403);
  };

  // ---- players and their attributes

  function playerEntity(key) {
    if (!key || typeof key.Id !== 'string') throw fail('MatchmakingEntityInvalid', 'An entity is missing.');
    if ((key.Type || key.TypeString) !== 'title_player_account') {
      throw fail('MatchmakingEntityInvalid', 'Matchmaking is for players (title_player_account entities).');
    }
    const p = app.players.byEntity(key.Id);
    if (!p) throw fail('MatchmakingEntityInvalid', `There is no player ${key.Id}.`);
    return p.entityId;
  }
  // A player acts for themselves; the game's server can act for any player.
  function actingFor(key, ctx) {
    if (!key) {
      if (ctx.player) return ctx.player.entityId;
      throw fail('MatchmakingEntityInvalid', 'Say which player this is for (Entity).');
    }
    const eid = playerEntity(key);
    if (!ctx.server && eid !== callerId(ctx)) throw fail('MatchmakingUnauthorized', 'Players can only do that for themselves.', 403);
    return eid;
  }

  function readAttributes(a) {
    if (a === undefined || a === null) return null;
    let obj = a.DataObject;
    if (a.EscapedDataObject !== undefined && a.EscapedDataObject !== null) {
      try {
        obj = JSON.parse(String(a.EscapedDataObject));
      } catch (e) {
        throw fail('MatchmakingPlayerAttributesInvalid', "EscapedDataObject isn't valid JSON.");
      }
    }
    if (obj === undefined || obj === null) return null;
    if (typeof obj !== 'object' || Array.isArray(obj)) throw fail('MatchmakingPlayerAttributesInvalid', 'Attributes should be a JSON object.');
    if (JSON.stringify(obj).length > MAX_ATTRIBUTES) throw fail('MatchmakingPlayerAttributesTooLarge', 'Those attributes are too big.');
    return obj;
  }
  const showAttributes = (obj, escape) => (obj ? (escape ? { EscapedDataObject: JSON.stringify(obj) } : { DataObject: obj }) : undefined);

  // An attribute's path can be "Skill", "stats.skill" or "$.stats.skill".
  function attribute(obj, path) {
    let v = obj;
    for (const part of String(path).replace(/^\$\.?/, '').split('.').filter(Boolean)) {
      if (!v || typeof v !== 'object') return undefined;
      v = own(v, part);
    }
    return v;
  }

  // ---- tickets

  const saveTicket = (t) => store.put('matchTickets', t.id, t);
  function findTicket(id, q) {
    const t = typeof id === 'string' ? store.get('matchTickets', id) : null;
    if (!t || t.queue !== q.Name) throw fail('MatchmakingTicketNotFound', `There is no ticket ${id} in the queue ${q.Name}.`);
    return t;
  }
  const joined = (t, eid) => t.members.some((m) => m.entity === eid);
  const isIn = (t, eid) => !!eid && (t.creator === eid || joined(t, eid) || t.invited.includes(eid));
  const players = (t) => t.members.length;
  const age = (t, now) => (now - Date.parse(t.created)) / 1000;

  function finish(t, status, reason) {
    t.status = status;
    if (reason) t.cancellationReason = reason;
    t.changeNumber += 1;
    saveTicket(t);
  }
  // A ticket that's waited longer than it said it would is canceled.
  function expire(t, now) {
    if (ACTIVE.has(t.status) && now - Date.parse(t.created) >= t.giveUpAfterSeconds * 1000) finish(t, 'Canceled', 'Timeout');
  }
  // Expires tickets, and forgets finished tickets and matches after a day.
  function sweep(now) {
    for (const t of [...store.values('matchTickets')]) {
      expire(t, now);
      if (!ACTIVE.has(t.status) && now - Date.parse(t.created) > KEEP_MS) store.delete('matchTickets', t.id);
    }
    for (const m of [...store.values('matches')]) if (now - Date.parse(m.created) > KEEP_MS) store.delete('matches', m.id);
  }
  const active = (q) => [...store.values('matchTickets')].filter((t) => t.queue === q.Name && ACTIVE.has(t.status));

  function makeTicket(ctx, q, members, invited, giveUp, creator) {
    if (typeof giveUp !== 'number' || !(giveUp > 0)) throw fail('MatchmakingBadRequest', 'GiveUpAfterSeconds should be more than 0.');
    const everyone = [...members.map((m) => m.entity), ...invited];
    if (new Set(everyone).size !== everyone.length) throw fail('MatchmakingBadRequest', 'A player is in the ticket twice.');
    if (everyone.length > (q.MaxTicketSize || q.MaxMatchSize) || everyone.length > q.MaxMatchSize) {
      throw fail('MatchmakingNumberOfPlayersInTicketTooLarge', `That's too many players for one ticket in ${q.Name}.`);
    }
    // A player can be in one waiting ticket per queue: PlayFab's limit, as we understand it.
    const busy = active(q);
    for (const eid of everyone) {
      if (busy.some((t) => isIn(t, eid))) {
        throw fail('MatchmakingTicketMembershipLimitExceeded', `${eid} is already in a ticket in ${q.Name}. Cancel it first, for example with CancelAllMatchmakingTicketsForPlayer.`);
      }
    }
    const t = {
      id: crypto.randomUUID(),
      queue: q.Name,
      created: ctx.now.toISOString(),
      creator,
      giveUpAfterSeconds: giveUp,
      members,
      invited,
      status: invited.length ? 'WaitingForPlayers' : 'WaitingForMatch',
      changeNumber: 1,
    };
    saveTicket(t);
    if (t.status === 'WaitingForMatch') matchQueue(q, ctx);
    return { TicketId: t.id };
  }

  function ticketView(t, escape) {
    return clean({
      CancellationReason: t.cancellationReason,
      CancellationReasonString: t.cancellationReason,
      ChangeNumber: t.changeNumber,
      Created: t.created,
      Creator: keyOf(t.creator),
      GiveUpAfterSeconds: t.giveUpAfterSeconds,
      MatchId: t.matchId,
      Members: t.members.map((m) => ({ Attributes: showAttributes(m.attributes, escape), Entity: keyOf(m.entity) })),
      MembersToMatchWith: t.invited.length ? t.invited.map(keyOf) : undefined,
      QueueName: t.queue,
      Status: t.status,
      TicketId: t.id,
    });
  }

  // ---- the matching

  const optional = (rule, secs) => typeof rule.SecondsUntilOptional === 'number' && secs >= rule.SecondsUntilOptional;
  const steps = (exp, secs) => (exp && exp.SecondsBetweenExpansions > 0 ? Math.floor(secs / exp.SecondsBetweenExpansions) : 0);
  // Which custom value applies after some expansions: we read the list as one value per interval, starting with the first.
  const custom = (list, n) => (Array.isArray(list) && list.length ? Number(list[Math.min(n, list.length - 1)].Value) : undefined);

  function allowedDifference(r, secs) {
    if (r.CustomExpansion) return custom(r.CustomExpansion.DifferenceOverrides, steps(r.CustomExpansion, secs));
    let d = Number(r.Difference);
    if (r.LinearExpansion) {
      d += Number(r.LinearExpansion.Delta) * steps(r.LinearExpansion, secs);
      if (typeof r.LinearExpansion.Limit === 'number') d = Math.min(d, r.LinearExpansion.Limit);
    }
    return d;
  }
  function minIntersection(r, secs) {
    if (r.CustomExpansion) return custom(r.CustomExpansion.MinIntersectionSizeOverrides, steps(r.CustomExpansion, secs));
    let n = Number(r.MinIntersectionSize);
    if (r.LinearExpansion) n = Math.max(1, n - Number(r.LinearExpansion.Delta) * steps(r.LinearExpansion, secs));
    return n;
  }
  function maxLatency(r, secs) {
    if (r.CustomExpansion) return custom(r.CustomExpansion.MaxLatencyOverrides, steps(r.CustomExpansion, secs));
    let n = Number(r.MaxLatency);
    if (r.LinearExpansion) n = Math.min(n + Number(r.LinearExpansion.Delta) * steps(r.LinearExpansion, secs), r.LinearExpansion.Limit);
    return n;
  }

  // One ticket's value for a rule: ANY when it's missing and the rule says
  // "match any". A ticket with several players uses the first player's value
  // for string rules, their merged value (Min, Max or Average) for difference
  // rules, and what all their sets share for set rules.
  function ticketValue(t, rule, kind) {
    if (rule.Attribute && rule.Attribute.Source === 'PlayerEntity') {
      app.warnOnce('mm-entity-attributes', "a matchmaking rule reads the player's entity, which Keep Playing doesn't do yet; the rule treats every player as a match.");
      return ANY;
    }
    const raw = t.members.map((m) => attribute(m.attributes, rule.Attribute && rule.Attribute.Path));
    const values = raw.map((v) => (v === undefined || v === null
      ? (rule.AttributeNotSpecifiedBehavior === 'MatchAny' || rule.DefaultAttributeValue === undefined ? ANY : rule.DefaultAttributeValue)
      : v));
    const known = values.filter((v) => v !== ANY);
    if (!known.length) return ANY;
    if (kind === 'string') return String(known[0]);
    if (kind === 'set') return known.map((v) => (Array.isArray(v) ? v.map(String) : [String(v)])).reduce((a, b) => a.filter((x) => b.includes(x)));
    const nums = known.map(Number).filter(Number.isFinite);
    if (!nums.length) return ANY;
    if (rule.MergeFunction === 'Min') return Math.min(...nums);
    if (rule.MergeFunction === 'Max') return Math.max(...nums);
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  // Regions every player in the group can reach in time, best (lowest average latency) first.
  // A player without latencies can play anywhere.
  function regions(r, group, secs) {
    const limit = maxLatency(r, secs);
    let names = null;
    const seen = new Map();
    for (const t of group) {
      for (const m of t.members) {
        const list = attribute(m.attributes, r.Path);
        if (!Array.isArray(list)) continue;
        const mine = new Map();
        for (const x of list) if (x && typeof x === 'object' && Number(x.latency) <= limit) mine.set(String(x.region), Number(x.latency));
        names = names === null ? new Set(mine.keys()) : new Set([...names].filter((n) => mine.has(n)));
        for (const [n, ms] of mine) {
          if (!seen.has(n)) seen.set(n, []);
          seen.get(n).push(ms);
        }
      }
    }
    if (names === null) return [];
    const average = (n) => seen.get(n).reduce((a, b) => a + b, 0) / seen.get(n).length;
    return [...names].sort((a, b) => average(a) - average(b));
  }

  // Puts tickets into teams, keeping each ticket's players together: the
  // biggest tickets first, each into the team with the most room. Returns
  // ticket id -> team name, or null if they don't fit.
  function teamsFor(q, group, secs, final) {
    const teams = q.Teams.map((t) => ({ name: t.Name, min: t.MinTeamSize, max: t.MaxTeamSize, size: 0 }));
    const out = new Map();
    for (const t of [...group].sort((a, b) => players(b) - players(a))) {
      const room = teams.filter((x) => x.size + players(t) <= x.max).sort((a, b) => (a.size / a.max) - (b.size / b.max) || a.size - b.size)[0];
      if (!room) return null;
      room.size += players(t);
      out.set(t.id, room.name);
    }
    if (final) {
      if (teams.some((x) => x.size < x.min)) return null;
      const b = q.TeamSizeBalanceRule;
      if (b && !optional(b, secs)) {
        const sizes = teams.map((x) => x.size);
        if (Math.max(...sizes) - Math.min(...sizes) > allowedDifference(b, secs)) return null;
      }
    }
    return out;
  }

  // Whether a group of tickets can be (or, when final, is) a match.
  function fits(q, group, secs, final) {
    for (const r of q.StringEqualityRules || []) {
      if (optional(r, secs)) continue;
      if (r.Expansion && Array.isArray(r.Expansion.EnabledOverrides) && r.Expansion.EnabledOverrides.length
        && !r.Expansion.EnabledOverrides[Math.min(steps(r.Expansion, secs), r.Expansion.EnabledOverrides.length - 1)]) continue;
      const vals = new Set(group.map((t) => ticketValue(t, r, 'string')).filter((v) => v !== ANY));
      if (vals.size > 1) return false;
    }
    for (const r of q.DifferenceRules || []) {
      if (optional(r, secs)) continue;
      const vals = group.map((t) => ticketValue(t, r, 'number')).filter((v) => v !== ANY);
      if (vals.length > 1 && Math.max(...vals) - Math.min(...vals) > allowedDifference(r, secs)) return false;
    }
    for (const r of q.SetIntersectionRules || []) {
      if (optional(r, secs)) continue;
      const sets = group.map((t) => ticketValue(t, r, 'set')).filter((v) => v !== ANY);
      if (sets.length > 1 && new Set(sets.reduce((a, b) => a.filter((x) => b.includes(x)))).size < minIntersection(r, secs)) return false;
    }
    for (const r of q.MatchTotalRules || []) {
      if (optional(r, secs)) continue;
      let total = 0;
      for (const t of group) for (const m of t.members) total += Number(attribute(m.attributes, r.Attribute && r.Attribute.Path)) || 0;
      const e = r.Expansion;
      const max = (e && custom(e.MaxOverrides, steps(e, secs))) ?? r.Max;
      const min = (e && custom(e.MinOverrides, steps(e, secs))) ?? r.Min;
      if (total > max || (final && total < min)) return false;
    }
    const rs = q.RegionSelectionRule;
    if (rs && !optional(rs, secs) && group.some((t) => t.members.some((m) => Array.isArray(attribute(m.attributes, rs.Path))))) {
      if (!regions(rs, group, secs).length) return false;
    }
    if (q.Teams && q.Teams.length && !teamsFor(q, group, secs, final)) return false;
    return true;
  }

  function matchQueue(q, ctx) {
    const now = ctx.now.getTime();
    let waiting = active(q).filter((t) => (expire(t, now), t.status === 'WaitingForMatch'))
      .sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
    const most = q.Teams && q.Teams.length ? Math.min(q.MaxMatchSize, q.Teams.reduce((n, t) => n + t.MaxTeamSize, 0)) : q.MaxMatchSize;
    for (let i = 0; i < waiting.length;) {
      // Start with this ticket, and add the others that fit, oldest first.
      const anchor = waiting[i];
      const secs = age(anchor, now);
      const group = [anchor];
      let count = players(anchor);
      for (const c of waiting) {
        if (c === anchor || count + players(c) > most) continue;
        if (!fits(q, [...group, c], secs, false)) continue;
        group.push(c);
        count += players(c);
        if (count === most) break;
      }
      if (count >= q.MinMatchSize && fits(q, group, secs, true)) {
        makeMatch(q, group, secs, ctx);
        waiting = waiting.filter((t) => !group.includes(t));
        i = 0;
      } else {
        i += 1;
      }
    }
  }

  function makeMatch(q, group, secs, ctx) {
    const teams = q.Teams && q.Teams.length ? teamsFor(q, group, secs, true) : null;
    const rs = q.RegionSelectionRule;
    const where = rs ? regions(rs, group, secs) : [];
    const m = {
      id: crypto.randomUUID(),
      queue: q.Name,
      created: ctx.now.toISOString(),
      members: group.flatMap((t) => t.members.map((x) => ({ entity: x.entity, attributes: x.attributes, team: teams ? teams.get(t.id) : undefined }))),
      regions: where.length ? where : undefined,
    };
    store.put('matches', m.id, m);
    for (const t of group) {
      t.matchId = m.id;
      t.secondsToMatch = age(t, ctx.now.getTime());
      finish(t, 'Matched');
    }
    if (q.ServerAllocationEnabled) {
      app.warnOnce(`mm-server:${q.Name}`, `the queue ${q.Name} asks for a game server, which Keep Playing can't start; its matches come without server details.`);
    }
  }

  // ---- the calls

  on('/Match/CreateMatchmakingTicket', (body, ctx) => {
    const q = queue(body.QueueName);
    sweep(ctx.now.getTime());
    const creator = actingFor(body.Creator && body.Creator.Entity, ctx);
    const invited = [...new Set((body.MembersToMatchWith || []).map(playerEntity))].filter((e) => e !== creator);
    return makeTicket(ctx, q, [{ entity: creator, attributes: readAttributes(body.Creator && body.Creator.Attributes) }], invited, body.GiveUpAfterSeconds, creator);
  });

  on('/Match/CreateServerMatchmakingTicket', (body, ctx) => {
    titleOnly(ctx);
    const q = queue(body.QueueName);
    sweep(ctx.now.getTime());
    const members = (body.Members || []).map((m) => ({ entity: playerEntity(m && m.Entity), attributes: readAttributes(m && m.Attributes) }));
    if (!members.length) throw fail('MatchmakingBadRequest', 'A ticket needs at least one player.');
    return makeTicket(ctx, q, members, [], body.GiveUpAfterSeconds, 'title');
  });

  // Invited players join with their own attributes; once everyone has, the ticket starts matching.
  on('/Match/JoinMatchmakingTicket', (body, ctx) => {
    const q = queue(body.QueueName);
    const t = findTicket(body.TicketId, q);
    const eid = actingFor(body.Member && body.Member.Entity, ctx);
    expire(t, ctx.now.getTime());
    if (!t.invited.includes(eid)) throw fail('MatchmakingUnauthorized', "That player wasn't asked to join this ticket.", 403);
    if (joined(t, eid)) throw fail('MatchmakingAlreadyJoinedTicket', 'That player has already joined this ticket.');
    if (t.status !== 'WaitingForPlayers') throw fail('MatchmakingTicketAlreadyCompleted', 'That ticket has already started matching, or has finished.');
    t.members.push({ entity: eid, attributes: readAttributes(body.Member.Attributes) });
    if (t.invited.every((x) => joined(t, x))) t.status = 'WaitingForMatch';
    t.changeNumber += 1;
    saveTicket(t);
    if (t.status === 'WaitingForMatch') matchQueue(q, ctx);
    return {};
  });

  on('/Match/GetMatchmakingTicket', (body, ctx) => {
    const q = queue(body.QueueName);
    const t = findTicket(body.TicketId, q);
    if (!ctx.server && !isIn(t, callerId(ctx))) throw fail('MatchmakingUnauthorized', "Only the ticket's players and the game's server can see it.", 403);
    expire(t, ctx.now.getTime());
    if (t.status === 'WaitingForMatch') matchQueue(q, ctx);
    return ticketView(t, body.EscapeObject === true);
  });

  // A matched ticket can't be canceled; canceling a canceled one does nothing.
  on('/Match/CancelMatchmakingTicket', (body, ctx) => {
    const q = queue(body.QueueName);
    const t = findTicket(body.TicketId, q);
    const me = callerId(ctx);
    if (!ctx.server && !joined(t, me) && t.creator !== me) {
      if (t.invited.includes(me)) throw fail('MatchmakingPlayerHasNotJoinedTicket', "That player hasn't joined this ticket yet.");
      throw fail('MatchmakingUnauthorized', "Only the ticket's players and the game's server can cancel it.", 403);
    }
    expire(t, ctx.now.getTime());
    if (t.status === 'Matched') throw fail('MatchmakingTicketAlreadyCompleted', "That ticket has already been matched, so it can't be canceled.");
    if (t.status !== 'Canceled') finish(t, 'Canceled', 'Requested');
    return {};
  });

  on('/Match/CancelAllMatchmakingTicketsForPlayer', (body, ctx) => {
    const q = queue(body.QueueName);
    const eid = actingFor(body.Entity, ctx);
    sweep(ctx.now.getTime());
    for (const t of active(q)) if (isIn(t, eid)) finish(t, 'Canceled', 'Requested');
    return {};
  });

  on('/Match/ListMatchmakingTicketsForPlayer', (body, ctx) => {
    const q = queue(body.QueueName);
    const eid = actingFor(body.Entity, ctx);
    sweep(ctx.now.getTime());
    return { TicketIds: active(q).filter((t) => isIn(t, eid)).map((t) => t.id) };
  });

  on('/Match/GetMatch', (body, ctx) => {
    const q = queue(body.QueueName);
    const m = typeof body.MatchId === 'string' ? store.get('matches', body.MatchId) : null;
    if (!m || m.queue !== q.Name) throw fail('MatchmakingMatchNotFound', `There is no match ${body.MatchId} in ${q.Name}.`);
    if (!ctx.server && !m.members.some((x) => x.entity === callerId(ctx))) throw fail('MatchmakingUnauthorized', "Only the match's players and the game's server can see it.", 403);
    return clean({
      MatchId: m.id,
      Members: m.members.map((x) => ({
        Attributes: body.ReturnMemberAttributes === true ? showAttributes(x.attributes, body.EscapeObject === true) : undefined,
        Entity: keyOf(x.entity),
        TeamId: x.team,
      })),
      RegionPreferences: m.regions,
    });
  });

  // Players see only what the queue lets them; the game's server sees everything.
  on('/Match/GetQueueStatistics', (body, ctx) => {
    const q = queue(body.QueueName);
    const vis = q.StatisticsVisibilityToPlayers || {};
    const count = ctx.server || vis.ShowNumberOfPlayersMatching === true;
    const times = ctx.server || vis.ShowTimeToMatch === true;
    if (!count && !times) throw fail('MatchmakingUnauthorized', "This queue doesn't show its statistics to players.", 403);
    sweep(ctx.now.getTime());
    const out = {};
    if (count) out.NumberOfPlayersMatching = active(q).filter((t) => t.status === 'WaitingForMatch').reduce((n, t) => n + players(t), 0);
    if (times) {
      const secs = [...store.values('matchTickets')].filter((t) => t.queue === q.Name && t.status === 'Matched').map((t) => t.secondsToMatch).sort((a, b) => a - b);
      if (secs.length) {
        const at = (p) => secs[Math.min(secs.length - 1, Math.ceil((p / 100) * secs.length) - 1)];
        out.TimeToMatchStatisticsInSeconds = { Average: secs.reduce((a, b) => a + b, 0) / secs.length, Percentile50: at(50), Percentile90: at(90), Percentile99: at(99) };
      }
    }
    return out;
  });

  // ---- queue settings (the game's server only)

  on('/Match/SetMatchmakingQueue', (body, ctx) => {
    titleOnly(ctx);
    checkQueue(body.MatchmakingQueue);
    const t = app.title();
    t.matchmakingQueues = { ...(t.matchmakingQueues || {}), [body.MatchmakingQueue.Name]: body.MatchmakingQueue };
    app.saveTitle(t);
    return {};
  });

  on('/Match/GetMatchmakingQueue', (body, ctx) => {
    titleOnly(ctx);
    return { MatchmakingQueue: queue(body.QueueName) };
  });

  on('/Match/ListMatchmakingQueues', (body, ctx) => {
    titleOnly(ctx);
    return { MatchMakingQueues: Object.values(app.title().matchmakingQueues || {}) };
  });

  // Removing a queue cancels its waiting tickets (with the reason "Internal": our guess).
  on('/Match/RemoveMatchmakingQueue', (body, ctx) => {
    titleOnly(ctx);
    const q = queue(body.QueueName);
    for (const tk of active(q)) finish(tk, 'Canceled', 'Internal');
    const t = app.title();
    const next = { ...t.matchmakingQueues };
    delete next[q.Name];
    t.matchmakingQueues = next;
    app.saveTitle(t);
    return {};
  });
};
