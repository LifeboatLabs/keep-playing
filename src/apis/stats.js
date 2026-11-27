'use strict';
// Player statistics and the classic leaderboards built from them.

const { fail } = require('../errors');
const { targetPlayer, own } = require('./common');
const { profile } = require('../players');

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

// When a statistic with a reset interval should next start a new version.
function nextReset(interval, from) {
  const d = new Date(from.getTime());
  switch (interval) {
    case 'Hour':
      d.setUTCMinutes(0, 0, 0);
      d.setUTCHours(d.getUTCHours() + 1);
      return d;
    case 'Day':
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() + 1);
      return d;
    case 'Week': {
      // PlayFab's weeks start on Monday at 00:00 UTC.
      d.setUTCHours(0, 0, 0, 0);
      const days = (8 - d.getUTCDay()) % 7 || 7;
      d.setUTCDate(d.getUTCDate() + days);
      return d;
    }
    case 'Month':
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d;
    default:
      return null;
  }
}

// Gets a statistic's definition, making a default one the first time it's used
// (PlayFab does the same), and starts new versions when a reset is due.
const MAX_HISTORY = 1000;

function definition(app, name, now, create) {
  const t = app.title();
  let def = own(t.statistics, name);
  let changed = false;
  if (!def) {
    if (!create) return null;
    def = t.statistics[name] = { aggregation: 'Last', resetInterval: 'Never', version: 0 };
    changed = true;
  }
  if (!def.versions) {
    def.versions = [{ version: def.version, activated: now.toISOString(), deactivated: null }];
    changed = true;
  }
  if (def.resetInterval && def.resetInterval !== 'Never') {
    for (;;) {
      const current = def.versions[def.versions.length - 1];
      const due = nextReset(def.resetInterval, new Date(current.activated));
      if (!due || due > now) break;
      current.deactivated = due.toISOString();
      def.version += 1;
      def.versions.push({ version: def.version, activated: due.toISOString(), deactivated: null });
      if (def.versions.length > MAX_HISTORY) def.versions.shift();
      changed = true;
    }
  }
  if (changed) app.saveTitle(t);
  return def;
}

// The player's current statistics, as StatisticValue records.
function values(app, p, names, now) {
  const wanted = Array.isArray(names) && names.length ? new Set(names) : null;
  const out = [];
  for (const [name, s] of Object.entries(p.stats)) {
    if (wanted && !wanted.has(name)) continue;
    const def = definition(app, name, now, false);
    if (def && s.version !== def.version) continue; // reset since it was written
    out.push({ StatisticName: name, Value: s.value, Version: s.version });
  }
  return out;
}

function update(app, p, updates, now) {
  if (!Array.isArray(updates)) throw fail('InvalidParams', 'Invalid input parameters', 400, { Statistics: ['The Statistics field is required.'] });
  const names = new Set();
  for (const u of updates) {
    if (!u || typeof u.StatisticName !== 'string' || !u.StatisticName) {
      throw fail('InvalidParams', 'Invalid input parameters', 400, { Statistics: ['Every statistic needs a StatisticName.'] });
    }
    if (names.has(u.StatisticName)) throw fail('DuplicateStatisticName', `${u.StatisticName} appears twice in this request.`);
    names.add(u.StatisticName);
    if (!Number.isInteger(u.Value) || u.Value > INT32_MAX || u.Value < INT32_MIN) {
      throw fail('InvalidParams', 'Invalid input parameters', 400, { Statistics: [`The value for ${u.StatisticName} should be a whole number.`] });
    }
  }
  for (const u of updates) {
    const def = definition(app, u.StatisticName, now, true);
    if (u.Version !== undefined && u.Version !== null && u.Version !== def.version) {
      throw fail('StatisticVersionClosedForWrites', `Version ${u.Version} of ${u.StatisticName} is closed; the current version is ${def.version}.`);
    }
    const old = own(p.stats, u.StatisticName);
    const current = old && old.version === def.version ? old.value : null;
    let value = u.Value;
    if (current !== null) {
      if (def.aggregation === 'Min') value = Math.min(current, u.Value);
      else if (def.aggregation === 'Max') value = Math.max(current, u.Value);
      else if (def.aggregation === 'Sum') value = current + u.Value;
    }
    if (value > INT32_MAX || value < INT32_MIN) throw fail('StatisticValueAggregationOverflow', `${u.StatisticName} would go past the largest allowed value.`);
    p.stats[u.StatisticName] = { value, version: def.version, updated: now.toISOString() };
  }
  app.players.save(p);
}

module.exports = function register(on, app) {
  const target = (body, ctx) => targetPlayer(app, body, ctx);

  // Everyone with a value in the version asked for, highest first. PlayFab
  // breaks ties by who got there first.
  function board(name, version, now, among) {
    const def = definition(app, name, now, false);
    const v = version === undefined || version === null ? (def ? def.version : 0) : version;
    const rows = [];
    for (const p of among || app.players.all()) {
      const s = own(p.stats, name);
      if (s && s.version === v) rows.push({ p, value: s.value, at: s.updated });
    }
    rows.sort((a, b) => b.value - a.value || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    return { rows, version: v, def };
  }

  function entries(rows, start, count, title, constraints) {
    return rows.slice(start, start + count).map((r, i) => ({
      PlayFabId: r.p.id,
      DisplayName: r.p.displayName || undefined,
      StatValue: r.value,
      Position: start + i,
      Profile: profile(r.p, title, constraints),
    }));
  }

  const clampCount = (n, fallback) => Math.max(0, Math.min(100, Number.isInteger(n) ? n : fallback));

  function result(b, list, now) {
    const out = { Leaderboard: list, Version: b.version };
    if (b.def && b.def.resetInterval && b.def.resetInterval !== 'Never') {
      const cur = b.def.versions[b.def.versions.length - 1];
      out.NextReset = nextReset(b.def.resetInterval, new Date(cur.activated)).toISOString();
    }
    return out;
  }

  const getLeaderboard = (friendsOnly) => (body, ctx) => {
    const among = friendsOnly ? friendsAndSelf(target(body, ctx)) : null;
    const b = board(body.StatisticName, body.Version, ctx.now, among);
    const start = Math.max(0, body.StartPosition || 0);
    return result(b, entries(b.rows, start, clampCount(body.MaxResultsCount, 10), ctx.title, body.ProfileConstraints), ctx.now);
  };

  const around = (friendsOnly) => (body, ctx) => {
    const p = target(body, ctx);
    const among = friendsOnly ? friendsAndSelf(p) : null;
    const b = board(body.StatisticName, body.Version, ctx.now, among);
    const count = clampCount(body.MaxResultsCount, 10);
    let index = b.rows.findIndex((r) => r.p.id === p.id);
    if (index === -1) {
      // Players with no value yet show up at the bottom with 0.
      b.rows.push({ p, value: 0, at: ctx.now.toISOString() });
      index = b.rows.length - 1;
    }
    const start = Math.max(0, Math.min(index - Math.floor((count - 1) / 2), b.rows.length - count));
    return result(b, entries(b.rows, start, count, ctx.title, body.ProfileConstraints), ctx.now);
  };

  function friendsAndSelf(p) {
    const list = [p];
    for (const id of p.friends) {
      const f = app.players.byId(id);
      if (f) list.push(f);
    }
    return list;
  }

  on('/Client/GetLeaderboard', getLeaderboard(false));
  on('/Server/GetLeaderboard', getLeaderboard(false));
  on('/Client/GetLeaderboardAroundPlayer', around(false));
  on('/Server/GetLeaderboardAroundUser', around(false));
  on('/Client/GetFriendLeaderboard', getLeaderboard(true));
  on('/Server/GetFriendLeaderboard', getLeaderboard(true));
  on('/Client/GetFriendLeaderboardAroundPlayer', around(true));

  on('/Client/GetPlayerStatistics', (body, ctx) => ({
    Statistics: values(app, ctx.player, body.StatisticNames, ctx.now),
  }));
  on('/Server/GetPlayerStatistics', (body, ctx) => {
    const p = target(body, ctx);
    return { PlayFabId: p.id, Statistics: values(app, p, body.StatisticNames, ctx.now) };
  });

  on('/Client/UpdatePlayerStatistics', (body, ctx) => {
    if (!ctx.title.settings.allowClientStatistics) {
      throw fail('APINotEnabledForGameClientAccess', 'This game does not let players post their own statistics. Turn on allowClientStatistics in title.json.');
    }
    update(app, ctx.player, body.Statistics, ctx.now);
    return {};
  });
  on('/Server/UpdatePlayerStatistics', (body, ctx) => {
    update(app, target(body, ctx), body.Statistics, ctx.now);
    return {};
  });

  const versions = (body, ctx) => {
    const def = definition(app, body.StatisticName, ctx.now, false);
    if (!def) throw fail('StatisticNotFound', `There is no statistic called ${body.StatisticName}.`);
    return {
      StatisticVersions: def.versions.map((v) => ({
        StatisticName: body.StatisticName,
        Version: v.version,
        ActivationTime: v.activated,
        DeactivationTime: v.deactivated || undefined,
      })),
    };
  };
  on('/Client/GetPlayerStatisticVersions', versions);
  on('/Server/GetPlayerStatisticVersions', versions);

  // Admin: statistic definitions.
  const describe = (name, def) => ({
    StatisticName: name,
    CurrentVersion: def.version,
    AggregationMethod: def.aggregation,
    VersionChangeInterval: def.resetInterval,
  });
  on('/Admin/CreatePlayerStatisticDefinition', (body, ctx) => {
    const t = app.title();
    if (own(t.statistics, body.StatisticName)) throw fail('StatisticNameConflict', `There is already a statistic called ${body.StatisticName}.`);
    t.statistics[body.StatisticName] = {
      aggregation: body.AggregationMethod || 'Last',
      resetInterval: body.VersionChangeInterval || 'Never',
      version: 0,
      versions: [{ version: 0, activated: ctx.now.toISOString(), deactivated: null }],
    };
    app.saveTitle(t);
    return { Statistic: describe(body.StatisticName, t.statistics[body.StatisticName]) };
  });
  on('/Admin/UpdatePlayerStatisticDefinition', (body, ctx) => {
    const t = app.title();
    const def = own(t.statistics, body.StatisticName);
    if (!def) throw fail('StatisticNotFound', `There is no statistic called ${body.StatisticName}.`);
    if (body.AggregationMethod) def.aggregation = body.AggregationMethod;
    if (body.VersionChangeInterval) def.resetInterval = body.VersionChangeInterval;
    app.saveTitle(t);
    return { Statistic: describe(body.StatisticName, def) };
  });
  on('/Admin/GetPlayerStatisticDefinitions', (body, ctx) => ({
    Statistics: Object.keys(app.title().statistics).map((n) => describe(n, definition(app, n, ctx.now, false))),
  }));
  on('/Admin/IncrementPlayerStatisticVersion', (body, ctx) => {
    const def = definition(app, body.StatisticName, ctx.now, false);
    if (!def) throw fail('StatisticNotFound', `There is no statistic called ${body.StatisticName}.`);
    const t = app.title();
    const d = own(t.statistics, body.StatisticName);
    const at = ctx.now.toISOString();
    d.versions[d.versions.length - 1].deactivated = at;
    d.version += 1;
    d.versions.push({ version: d.version, activated: at, deactivated: null });
    app.saveTitle(t);
    return {
      StatisticVersion: { StatisticName: body.StatisticName, Version: d.version, ActivationTime: at, ArchivalStatus: 'NotScheduled' },
    };
  });
  on('/Admin/GetPlayerStatisticVersions', versions);
};

module.exports.values = values;
module.exports.update = update;
module.exports.nextReset = nextReset;
