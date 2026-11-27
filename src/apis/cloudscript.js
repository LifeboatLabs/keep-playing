'use strict';
// Classic CloudScript: the game's own JavaScript, run on the server.
//
// Scripts run in a separate JavaScript context with PlayFab's globals:
// handlers, currentPlayerId, server, entity, log, http and script.
// This keeps scripts tidy, but it is NOT a security boundary: only load
// CloudScript you trust, because it runs with the server's permissions.

const vm = require('node:vm');
const spec = require('../spec');
const { ApiError, fail } = require('../errors');
const { profile } = require('../players');

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_LOG_BYTES = 350 * 1024;

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Entity API names (GetObjects, SetObjects, ...) to their addresses.
function entityApiMap() {
  const map = new Map();
  for (const c of spec.allCalls()) {
    const group = c.url.split('/')[1];
    if (['Client', 'Server', 'Admin', 'Matchmaker'].includes(group)) continue;
    if (!map.has(c.name)) map.set(c.name, c.url);
  }
  return map;
}

module.exports = function register(on, app) {
  const compiled = new Map(); // "revision" -> vm.Script
  // Built once, run in every script's context.
  const setupScript = new vm.Script(`(function (bridge, setupText) {
    'use strict';
    var setup = JSON.parse(setupText);
    var g = globalThis;
    var unwrap = function (text) {
      var r = JSON.parse(text);
      if (r.ok) return r.data;
      var e = new Error(r.message);
      if (r.info) e.apiErrorInfo = r.info;
      throw e;
    };
    var api = function (group) {
      return new Proxy({}, {
        get: function (target, name) {
          if (typeof name !== 'string' || !bridge('has', group + ':' + name, '')) return undefined;
          return function (request) {
            var body = request === undefined || request === null ? {} : request;
            return unwrap(bridge('call', group + ':' + name, JSON.stringify(body)));
          };
        }
      });
    };
    var logger = function (level) {
      return function (message, data) {
        bridge('log', level, JSON.stringify([message === undefined ? null : String(message), data === undefined ? null : data]));
      };
    };
    // Scripts see the server's clock. It's the real time, except in tests,
    // which set the clock; then Date follows it.
    if (setup.clockOffset) {
      var RealDate = g.Date;
      var offset = setup.clockOffset;
      var KPDate = function () {
        if (!(this instanceof KPDate)) return new RealDate(RealDate.now() + offset).toString();
        var args = Array.prototype.slice.call(arguments);
        var d = args.length === 0 ? new RealDate(RealDate.now() + offset)
          : new (Function.prototype.bind.apply(RealDate, [null].concat(args)))();
        Object.setPrototypeOf(d, KPDate.prototype);
        return d;
      };
      KPDate.prototype = Object.create(RealDate.prototype, { constructor: { value: KPDate, writable: true, configurable: true } });
      KPDate.now = function () { return RealDate.now() + offset; };
      KPDate.UTC = RealDate.UTC;
      KPDate.parse = RealDate.parse;
      g.Date = KPDate;
    }
    g.handlers = {};
    g.currentPlayerId = setup.currentPlayerId === null ? undefined : setup.currentPlayerId;
    g.script = { revision: setup.script.revision, titleId: setup.script.titleId === null ? undefined : setup.script.titleId };
    g.log = { debug: logger('Debug'), info: logger('Info'), error: logger('Error') };
    g.server = api('server');
    g.entity = api('entity');
    g.http = { request: function () { return unwrap(bridge('http', '', '')); } };
  })`, { filename: 'Keep Playing setup' });

  // Calls the function and reports back in text, catching everything inside.
  const callHandler = new vm.Script(`(function () {
    var describe = function (e) {
      try { return String(e && e.stack ? e.stack : e); } catch (x) { return 'An error that could not be shown'; }
    };
    if (typeof handlers[__kpName] !== 'function') return JSON.stringify({ missing: true });
    try {
      var out = handlers[__kpName](JSON.parse(__kpArgs), JSON.parse(__kpContext));
      return JSON.stringify({ ok: true, undefined: out === undefined, value: out === undefined ? null : out });
    } catch (e) {
      var api = false;
      try { api = !!(e && typeof e === 'object' && e.apiErrorInfo); } catch (x) { api = false; }
      return JSON.stringify({ ok: false, api: api, stack: describe(e) });
    }
  })()`, { filename: 'Keep Playing' });

  const formatError = new vm.Script(`(function () {
    try { return String(__kpErr && __kpErr.stack ? __kpErr.stack : __kpErr); } catch (x) { return 'An error that could not be shown'; }
  })()`, { filename: 'Keep Playing' });
  const entityApis = entityApiMap();

  function pickRevision(t, selection, specific) {
    const revs = t.cloudScript.revisions;
    if (!revs.length) throw fail('CloudScriptNotFound', 'This game has no CloudScript.');
    if (selection === 'Specific') {
      const r = revs.find((x) => x.Revision === specific);
      if (!r) throw fail('RevisionNotFound', `There is no CloudScript revision ${specific}.`);
      return r;
    }
    if (selection === 'Latest') return revs[revs.length - 1];
    return revs.find((x) => x.Revision === t.cloudScript.live) || revs[revs.length - 1];
  }

  function scriptFor(rev) {
    const key = String(rev.Revision) + ':' + rev.CreatedAt;
    if (!compiled.has(key)) {
      const source = rev.Files.map((f) => f.FileContents).join('\n;\n');
      compiled.set(key, new vm.Script(source, { filename: 'Script Document' }));
    }
    return compiled.get(key);
  }

  // Runs one CloudScript function and returns ExecuteCloudScriptResult.
  function execute({ player, functionName, args, selection, specific, now }) {
    const t = app.title();
    const rev = pickRevision(t, selection, specific);
    const timeout = t.settings.cloudScriptTimeoutMs || DEFAULT_TIMEOUT_MS;
    const logs = [];
    let logBytes = 0;
    let logsTooLarge = false;
    let apiCount = 0;
    let httpCount = 0;

    const addLog = (Level, message, data) => {
      const entry = { Level, Message: message === undefined ? undefined : String(message), Data: clone(data) };
      const size = JSON.stringify(entry).length;
      if (logBytes + size > MAX_LOG_BYTES) {
        logsTooLarge = true;
        return;
      }
      logBytes += size;
      logs.push(entry);
    };

    // The script's world is built inside its own context, and it reaches the
    // server only through `bridge`, which takes and gives back text. So no
    // object from the server side leaks into the script.
    const context = vm.createContext(Object.create(null), { name: 'CloudScript', codeGeneration: { strings: true, wasm: false } });
    const titleEntity = { Type: 'title', Id: t.titleId || '' };
    const resolve = (group, name) => {
      if (group === 'server') return spec.call(`/Server/${name}`) ? `/Server/${name}` : null;
      if (group === 'entity') return entityApis.get(name) || null;
      return null;
    };
    const bridge = (kind, name, text) => {
      try {
        if (kind === 'log') {
          const [message, data] = JSON.parse(text);
          addLog(name, message === null ? undefined : message, data === null ? undefined : data);
          return '';
        }
        const [group, apiName] = String(name).split(':');
        if (kind === 'has') return resolve(group, apiName) ? '1' : '';
        if (kind === 'http') {
          httpCount++;
          return JSON.stringify({ ok: false, message: 'Keep Playing does not let CloudScript make web requests yet.' });
        }
        if (kind === 'call') {
          const url = resolve(group, apiName);
          if (!url) return JSON.stringify({ ok: false, message: `${group}.${apiName} is not a function` });
          const request = JSON.parse(text);
          const auth = group === 'server' ? { server: true } : { server: true, entity: titleEntity };
          apiCount++;
          try {
            return JSON.stringify({ ok: true, data: app.run(url, request, auth) });
          } catch (e) {
            if (!(e instanceof ApiError)) throw e;
            const info = { api: url, request, result: null, apiError: e.toJSON() };
            addLog('Error', 'PlayFabAPIError', info);
            return JSON.stringify({ ok: false, message: `${url} failed: ${e.message}`, info });
          }
        }
      } catch (e) {
        app.log(`CloudScript bridge problem: ${e && e.stack ? e.stack : e}`, 'error');
        return JSON.stringify({ ok: false, message: 'Keep Playing had a problem answering that call.' });
      }
      return '';
    };
    setupScript.runInContext(context, { displayErrors: false })(bridge, JSON.stringify({
      clockOffset: app.customClock && now ? now.getTime() - Date.now() : 0,
      currentPlayerId: player ? player.id : null,
      script: { revision: rev.Revision, titleId: t.titleId || null },
    }));

    const started = process.hrtime.bigint();
    const startedMs = Date.now();
    const cpuStart = process.cpuUsage();
    const timedOut = () => Date.now() - startedMs >= timeout;
    const timeLimit = { Error: 'CloudScriptExecutionTimeLimitExceeded', Message: `The script ran for more than ${timeout / 1000} seconds.`, StackTrace: '' };
    // displayErrors is off everywhere: when it's on, Node reads a thrown value's
    // stack outside the time limit, which a booby-trapped value can use to hang us.
    // Turns something the script threw into text, inside the script's own
    // context and with a time limit, so a booby-trapped error can't hang us.
    const describe = (thrown) => {
      try {
        context.__kpErr = thrown;
        return formatError.runInContext(context, { timeout: 1000, displayErrors: false });
      } catch (e) {
        return 'An error that could not be shown';
      } finally {
        context.__kpErr = undefined;
      }
    };

    let FunctionResult;
    let error;
    let loaded = false;
    try {
      scriptFor(rev).runInContext(context, { timeout, displayErrors: false });
      loaded = true;
    } catch (e) {
      error = timedOut() ? timeLimit : { Error: 'JavascriptException', Message: 'JavascriptException', StackTrace: describe(e) };
    }
    if (loaded) {
      context.__kpName = functionName;
      context.__kpArgs = JSON.stringify(args === undefined ? null : args);
      context.__kpContext = JSON.stringify({ playerProfile: player ? profile(player, t, null) : null });
      let outcome = null;
      try {
        outcome = JSON.parse(callHandler.runInContext(context, { timeout, displayErrors: false }));
      } catch (e) {
        error = timedOut() ? timeLimit : { Error: 'JavascriptException', Message: 'JavascriptException', StackTrace: 'An error that could not be shown' };
      }
      if (outcome && outcome.missing) {
        error = { Error: 'CloudScriptNotFound', Message: `No function named ${functionName} was found to execute`, StackTrace: '' };
      } else if (outcome && outcome.ok) {
        FunctionResult = outcome.undefined ? undefined : outcome.value;
      } else if (outcome) {
        error = outcome.api
          ? { Error: 'CloudScriptAPIRequestError', Message: 'The script called a PlayFab API, which returned an error. See the Error logs for details.', StackTrace: outcome.stack }
          : { Error: 'JavascriptException', Message: 'JavascriptException', StackTrace: outcome.stack };
      }
    }
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const cpu = process.cpuUsage(cpuStart);

    const result = {
      FunctionName: functionName,
      Revision: rev.Revision,
      Logs: logs,
      ExecutionTimeSeconds: seconds,
      ProcessorTimeSeconds: (cpu.user + cpu.system) / 1e6,
      MemoryConsumedBytes: 0,
      APIRequestsIssued: apiCount,
      HttpRequestsIssued: httpCount,
    };
    if (logsTooLarge) result.LogsTooLarge = true;
    if (error) result.Error = error;
    else if (FunctionResult !== undefined) {
      if (JSON.stringify(FunctionResult).length > MAX_RESULT_BYTES) result.FunctionResultTooLarge = true;
      else result.FunctionResult = FunctionResult;
    }
    return result;
  }

  const fromBody = (body, player, now) => execute({
    player,
    functionName: String(body.FunctionName),
    args: clone(body.FunctionParameter),
    selection: body.RevisionSelection || 'Live',
    specific: body.SpecificRevision,
    now,
  });

  on('/Client/ExecuteCloudScript', (body, ctx) => fromBody(body, ctx.player, ctx.now));
  on('/Server/ExecuteCloudScript', (body, ctx) => {
    const p = app.players.byId(body.PlayFabId);
    if (!p) throw fail('AccountNotFound', 'User not found');
    return fromBody(body, p, ctx.now);
  });
  on('/CloudScript/ExecuteEntityCloudScript', (body, ctx) => {
    let player = ctx.player;
    if (body.Entity && ctx.server) {
      player = body.Entity.Type === 'title_player_account' ? app.players.byEntity(body.Entity.Id)
        : body.Entity.Type === 'master_player_account' ? app.players.byId(body.Entity.Id) : null;
    }
    return fromBody(body, player || null, ctx.now);
  });

  // Admin: uploading and choosing revisions. Classic CloudScript has one version, 1.
  on('/Admin/UpdateCloudScript', (body, ctx) => {
    const t = app.title();
    const revs = t.cloudScript.revisions;
    const files = (body.Files || []).map((f) => ({ Filename: String(f.Filename), FileContents: String(f.FileContents) }));
    if (!files.length) throw fail('InvalidParams', 'Invalid input parameters', 400, { Files: ['Send at least one file.'] });
    for (const f of files) {
      try {
        new vm.Script(f.FileContents, { filename: f.Filename });
      } catch (e) {
        throw fail('JavascriptException', `${f.Filename} has a syntax error: ${e.message}`);
      }
    }
    const revision = (revs.length ? revs[revs.length - 1].Revision : 0) + 1;
    revs.push({ Revision: revision, Files: files, CreatedAt: ctx.now.toISOString(), Published: !!body.Publish });
    if (body.Publish) t.cloudScript.live = revision;
    app.saveTitle(t);
    return { Revision: revision, Version: 1 };
  });

  on('/Admin/GetCloudScriptRevision', (body) => {
    const t = app.title();
    const r = body.Revision === undefined || body.Revision === null
      ? pickRevision(t, 'Live')
      : pickRevision(t, 'Specific', body.Revision);
    return { CreatedAt: r.CreatedAt, Files: clone(r.Files), IsPublished: r.Revision === t.cloudScript.live, Revision: r.Revision, Version: 1 };
  });

  on('/Admin/GetCloudScriptVersions', () => {
    const cs = app.title().cloudScript;
    if (!cs.revisions.length) return { Versions: [] };
    return {
      Versions: [{ Version: 1, PublishedRevision: cs.live || 0, LatestRevision: cs.revisions[cs.revisions.length - 1].Revision }],
    };
  });

  on('/Admin/SetPublishedRevision', (body) => {
    const t = app.title();
    const r = t.cloudScript.revisions.find((x) => x.Revision === body.Revision);
    if (!r) throw fail('RevisionNotFound', `There is no CloudScript revision ${body.Revision}.`);
    t.cloudScript.live = r.Revision;
    app.saveTitle(t);
    return {};
  });
};
