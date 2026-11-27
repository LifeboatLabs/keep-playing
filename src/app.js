'use strict';
// The server: reads each request the way PlayFab's SDKs send it, checks who is
// calling, runs the matching call and answers in PlayFab's envelope.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const spec = require('./spec');
const { ApiError, fail, STATUS_TEXT } = require('./errors');
const { Store } = require('./store');
const { Players, isBanned } = require('./players');
const tokens = require('./tokens');
const titles = require('./title');

const MAX_BODY = 16 * 1024 * 1024;
const VERSION = require('../package.json').version;

const MODULES = [
  require('./apis/auth'),
  require('./apis/account'),
  require('./apis/data'),
  require('./apis/stats'),
  require('./apis/economy'),
  require('./apis/cloudscript'),
  require('./apis/events'),
  require('./apis/objects'),
  require('./apis/sharedgroups'),
  require('./apis/platforms'), // after auth: it uses app.auth
];

function loadKeys(dir) {
  const fresh = () => ({
    serverKey: crypto.randomBytes(32).toString('hex'),
    secretKey: crypto.randomBytes(24).toString('base64url'),
  });
  if (!dir) return fresh();
  const file = path.join(dir, 'keys.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const keys = fresh();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(keys, null, 2) + '\n', { mode: 0o600 });
  return keys;
}

// "__proto__" as a key (or as a name we use as a key, like an ObjectName)
// would change an object's prototype when we store it, so requests that use it
// anywhere are refused.
function hasProtoKey(value, depth = 0) {
  if (typeof value === 'string') return value === '__proto__';
  if (value === null || typeof value !== 'object') return false;
  if (depth > 64) return true; // nothing a game sends is this deep
  if (Array.isArray(value)) return value.some((v) => hasProtoKey(v, depth + 1));
  for (const k of Object.keys(value)) {
    if (k === '__proto__') return true;
    if (hasProtoKey(value[k], depth + 1)) return true;
  }
  return false;
}

function createApp(options = {}) {
  const dataDir = options.dataDir || null;
  const store = new Store(dataDir);
  const keys = options.keys || loadKeys(dataDir);
  const clock = options.now || (() => new Date());
  const log = options.log || (() => {});

  if (options.titleDir) titles.load(store, options.titleDir);
  else titles.get(store);

  const app = {
    version: VERSION,
    store,
    keys,
    log,
    players: new Players(store),
    now: () => clock(),
    customClock: !!options.now, // tests set the clock
    title: () => titles.get(store),
    saveTitle: (t) => titles.save(store, t),
    handlers: new Map(),
    seen: new Map(), // url -> { count, answered, lastError }
    warned: new Set(),
  };

  // Lets the API files say: on('/Client/GetTime', (body, ctx) => ({ Time: ... }))
  const on = (url, fn) => {
    if (!spec.call(url)) throw new Error(`${url} isn't in Microsoft's description`);
    if (app.handlers.has(url)) throw new Error(`${url} is handled twice`);
    app.handlers.set(url, fn);
  };
  for (const m of MODULES) m(on, app);

  app.warnOnce = (key, message) => {
    if (app.warned.has(key)) return;
    app.warned.add(key);
    log(`Note: ${message}`);
  };

  app.isSecretKey = (key) => {
    const t = app.title();
    if (typeof key !== 'string' || !key) return false;
    if (t.settings.acceptAnySecretKey) return true;
    return [keys.secretKey, ...t.secretKeys].some((k) => tokens.sameText(k, key));
  };

  // Runs one call. Used by the HTTP side and by CloudScript's server.* functions.
  app.run = (url, body, auth) => {
    const call = spec.call(url);
    const handler = app.handlers.get(url);
    if (!call) throw fail('NotImplemented', `${url} isn't a PlayFab call.`, 404);
    if (!handler) {
      const why = call.retired
        ? `Microsoft retired ${url}${call.retired.replacedBy ? `; games should use ${call.retired.replacedBy} instead` : ''}.`
        : `Keep Playing can't answer ${url} yet.`;
      throw fail('NotImplemented', why, 501);
    }
    const ctx = { app, call, now: app.now(), title: app.title(), ...auth };
    if (hasProtoKey(body)) {
      throw fail('InvalidParams', 'Names like "__proto__" can\'t be used as keys.', 400, { Request: ['A key is called __proto__.'] });
    }
    if (app.title().settings.checkRequiredFields !== false && call.request) {
      const details = spec.requestProblems(call.api, call.request, body);
      if (details) throw fail('InvalidParams', 'Invalid input parameters', 400, details);
    }
    return handler(body, ctx) || {};
  };

  // Works out who is calling from the request headers.
  function authenticate(call, headers, url) {
    const now = app.now();
    const ticket = headers['x-authorization'];
    const secret = headers['x-secretkey'];
    const entityTok = headers['x-entitytoken'];

    const fromTicket = () => {
      const t = tokens.readSessionTicket(keys.serverKey, ticket, now);
      if (!t) throw fail('InvalidSessionTicket', 'That session ticket is not valid. Sign in again.', 401);
      if (t.expired) throw fail('NotAuthenticated', 'That session ticket has expired. Sign in again.', 401);
      const player = app.players.byId(t.playFabId);
      if (!player) throw fail('AccountNotFound', 'The account for that session ticket no longer exists.', 401);
      if (isBanned(player, now)) throw fail('AccountBanned', 'This account is banned.', 403);
      return { player };
    };
    const fromSecret = () => {
      // Some old games call a Server API from the game itself, with a key built in
      // that nobody has any more. A title can open just those calls.
      const open = app.title().settings.openServerCalls;
      if (Array.isArray(open) && open.includes(url)) return { server: true };
      if (!app.isSecretKey(secret)) throw fail('NotAuthenticated', 'The X-SecretKey header is missing or wrong.', 401);
      return { server: true };
    };
    const fromEntity = () => {
      if (!entityTok) throw fail('EntityTokenMissing', 'This call needs an X-EntityToken header.', 401);
      const e = tokens.readEntityToken(keys.serverKey, entityTok, now);
      if (!e) throw fail('EntityTokenInvalid', 'That entity token is not valid.', 401);
      if (e.expired) throw fail('EntityTokenExpired', 'That entity token has expired.', 401);
      const entity = { Id: e.Id, Type: e.Type };
      const player = e.Type === 'title_player_account' ? app.players.byEntity(e.Id)
        : e.Type === 'master_player_account' ? app.players.byId(e.Id) : null;
      if ((e.Type === 'title_player_account' || e.Type === 'master_player_account') && !player) {
        throw fail('AccountNotFound', 'The account for that entity token no longer exists.', 401);
      }
      if (player && isBanned(player, now)) throw fail('AccountBanned', 'This account is banned.', 403);
      if (call.entityTypes && !call.entityTypes.includes(e.Type)) {
        throw fail('NotAuthorized', `${url} can't be called with a ${e.Type} entity token.`, 403);
      }
      return { entity, player, server: e.Type === 'title' };
    };

    if (url === '/Authentication/GetEntityToken') {
      if (entityTok) return fromEntity();
      if (ticket) return fromTicket();
      if (secret) return fromSecret();
      throw fail('NotAuthenticated', 'Send X-Authorization, X-SecretKey or X-EntityToken to get an entity token.', 401);
    }
    switch (call.auth) {
      case 'SessionTicket':
        if (!ticket) throw fail('NotAuthenticated', 'Must be logged in to call this method', 401);
        return fromTicket();
      case 'SecretKey':
        return fromSecret();
      case 'EntityToken':
        return fromEntity();
      default:
        return {};
    }
  }

  function note(url, result) {
    const s = app.seen.get(url) || { count: 0, answered: 0, lastError: null };
    s.count++;
    if (result === true) s.answered++;
    else s.lastError = result;
    app.seen.set(url, s);
  }

  function send(res, status, body, reportAsSuccess) {
    const text = JSON.stringify(body);
    res.writeHead(reportAsSuccess ? 200 : status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      ...CORS,
    });
    res.end(text);
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw fail('InvalidParams', 'The request is too big.', 413);
      chunks.push(chunk);
    }
    let buf = Buffer.concat(chunks);
    const encoding = String(req.headers['content-encoding'] || '').toLowerCase();
    if (encoding === 'gzip') {
      try {
        buf = zlib.gunzipSync(buf, { maxOutputLength: MAX_BODY });
      } catch (e) {
        throw fail('InvalidParams', 'The request said it was gzip-compressed but could not be unpacked.', 400);
      }
    }
    if (!buf.length) return {};
    let body;
    try {
      body = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      throw fail('InvalidParams', 'The request body is not valid JSON.', 400);
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw fail('InvalidParams', 'The request body should be a JSON object.', 400);
    }
    return body;
  }

  async function handle(req, res) {
    const url = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
    const reportAsSuccess = String(req.headers['x-reporterrorassuccess'] || '').toLowerCase() === 'true';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (req.method === 'GET' && (url === '/' || url === '/status')) {
      return send(res, 200, app.status());
    }
    if (req.method !== 'POST') {
      return send(res, 405, { code: 405, status: 'MethodNotAllowed', error: 'InvalidRequest', errorCode: spec.errorCode('InvalidRequest'), errorMessage: 'PlayFab calls are POST requests.' });
    }

    const started = Date.now();
    try {
      const call = spec.call(url);
      const body = await readBody(req);
      if (!call) throw fail('NotImplemented', `${url} isn't a PlayFab call.`, 404);
      const auth = authenticate(call, req.headers, url);
      const data = app.run(url, body, auth);
      note(url, true);
      send(res, 200, { code: 200, status: 'OK', data }, false);
      log(`${url} OK ${Date.now() - started}ms`, 'debug');
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      if (!e) log(`${url} failed: ${err && err.stack ? err.stack : err}`, 'error');
      const out = e || fail('InternalServerError', 'Something went wrong inside Keep Playing. The server log has the details.', 500);
      // Only real PlayFab calls are counted, so made-up addresses can't fill memory.
      if (spec.call(url)) {
        note(url, out.name);
        if (out.name === 'NotImplemented') app.warnOnce(`missing:${url}`, `the game called ${url}, which Keep Playing can't answer yet.`);
      }
      send(res, out.httpStatus, out.toJSON(), reportAsSuccess);
    }
  }

  app.status = () => {
    const all = spec.allCalls();
    const live = all.filter((c) => !c.retired);
    const working = live.filter((c) => app.handlers.has(c.url)).length;
    return {
      name: 'Keep Playing',
      version: VERSION,
      about: 'A free, open-source server that answers PlayFab calls. Not made by or affiliated with Microsoft.',
      titleId: app.title().titleId,
      players: store.size('players'),
      calls: { working, total: live.length, retiredByMicrosoft: all.length - live.length },
      seen: Object.fromEntries([...app.seen].sort().map(([u, s]) => [u, s])),
    };
  };

  app.handle = handle;
  app.close = () => store.close();
  return app;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Content-Encoding, Accept-Encoding, X-Authorization, X-SecretKey, X-EntityToken, X-PlayFabSDK, X-ReportErrorAsSuccess',
  'Access-Control-Max-Age': '86400',
};

module.exports = { createApp, STATUS_TEXT };
