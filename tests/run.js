'use strict';
// Tests for Keep Playing. No dependencies:  node tests/run.js
//
// Every answer the server gives is also checked against Microsoft's published
// description of that call (field names, types, required fields, allowed values).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const { createApp } = require('../src/app');
const spec = require('../src/spec');
const tlsCert = require('../src/tls');

const ROOT = path.join(__dirname, '..');
const EXAMPLE = path.join(ROOT, 'title-example');

// ---------------------------------------------------------------- harness

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let checkedAnswers = 0;
const answered = new Set(); // calls that gave a good answer somewhere in the tests
let handled = [];

async function start(options = {}) {
  const clock = { now: new Date('2026-11-27T10:00:00Z') };
  const app = createApp({ now: () => clock.now, titleDir: EXAMPLE, ...options });
  handled = [...app.handlers.keys()];
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  function raw(method, url, { body, headers = {}, gzip } = {}) {
    return new Promise((resolve, reject) => {
      let payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      const h = { 'Content-Type': 'application/json', ...headers };
      if (gzip && payload) {
        payload = zlib.gzipSync(payload);
        h['Content-Encoding'] = 'gzip';
      }
      if (payload) h['Content-Length'] = payload.length;
      const req = http.request(base + url, { method, headers: h }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch (e) { /* not JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, json, text });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // Makes a PlayFab call and checks the answer against Microsoft's description.
  async function call(url, body = {}, headers = {}, extra = {}) {
    const res = await raw('POST', url + '?sdk=TestSDK-1.0', { body, headers, ...extra });
    assert.ok(res.json, `${url} should answer with JSON, got: ${res.text}`);
    if (res.json.code === 200) {
      assert.equal(res.status, 200);
      assert.equal(res.json.status, 'OK');
      const c = spec.call(url);
      const problems = spec.check(c.api, c.result, res.json.data, { strict: true });
      assert.deepEqual(problems, [], `${url} answer doesn't match ${c.result}: ${problems.join('; ')}`);
      checkedAnswers++;
      answered.add(url);
    } else {
      for (const k of ['code', 'status', 'error', 'errorCode', 'errorMessage']) assert.ok(k in res.json, `error is missing ${k}`);
      assert.equal(typeof res.json.errorCode, 'number');
    }
    return res.json;
  }

  const ok = async (url, body, headers) => {
    const r = await call(url, body, headers);
    assert.equal(r.code, 200, `${url} failed: ${JSON.stringify(r)}`);
    return r.data;
  };
  const err = async (url, body, headers, name) => {
    const r = await call(url, body, headers);
    assert.notEqual(r.code, 200, `${url} should have failed with ${name}`);
    assert.equal(r.error, name, `${url} failed with ${r.error} (${r.errorMessage}), expected ${name}`);
    assert.equal(r.errorCode, spec.errorCode(name));
    return r;
  };

  const secret = { 'X-SecretKey': app.keys.secretKey };
  async function player(customId) {
    const d = await ok('/Client/LoginWithCustomID', { TitleId: '1A2B3', CustomId: customId, CreateAccount: true });
    return { id: d.PlayFabId, auth: { 'X-Authorization': d.SessionTicket }, entity: { 'X-EntityToken': d.EntityToken.EntityToken }, entityKey: d.EntityToken.Entity, login: d };
  }

  const stop = () => new Promise((r) => {
    server.close(() => {
      app.close();
      r();
    });
  });
  return { app, clock, call, ok, err, raw, secret, player, stop, base };
}

// ---------------------------------------------------------------- the description itself

test('the call list has every PlayFab call, with the retired ones marked', () => {
  const all = spec.allCalls();
  assert.equal(all.length, 843);
  assert.equal(all.filter((c) => c.retired).length, 46);
  assert.equal(spec.source.license, 'Apache-2.0');
});

test('every error the code can return is in Microsoft\'s list', () => {
  const names = new Set();
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.js')) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/fail\('([A-Za-z]+)'/g)) names.add(m[1]);
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  const errors = require('../spec/calls.json').errors;
  const missing = [...names].filter((n) => !(n in errors));
  assert.deepEqual(missing, []);
  assert.ok(names.size > 30);
});

test('every handled call is a live call in the description', async () => {
  const t = await start();
  for (const url of t.app.handlers.keys()) {
    const c = spec.call(url);
    assert.ok(c, url);
    assert.equal(c.retired, null, `${url} is retired`);
  }
  await t.stop();
});

// ---------------------------------------------------------------- signing in

test('sign in with a custom ID creates an account once', async () => {
  const t = await start();
  const first = await t.ok('/Client/LoginWithCustomID', { TitleId: '1A2B3', CustomId: 'alice-pc', CreateAccount: true });
  assert.equal(first.NewlyCreated, true);
  assert.match(first.PlayFabId, /^[0-9A-F]{16}$/);
  assert.equal(first.EntityToken.Entity.Type, 'title_player_account');
  assert.equal(first.LastLoginTime, undefined);
  t.clock.now = new Date('2026-11-27T11:00:00Z');
  const again = await t.ok('/Client/LoginWithCustomID', { TitleId: '1A2B3', CustomId: 'alice-pc', CreateAccount: true });
  assert.equal(again.NewlyCreated, false);
  assert.equal(again.PlayFabId, first.PlayFabId);
  assert.equal(again.LastLoginTime, '2026-11-27T10:00:00.000Z');
  await t.stop();
});

test('sign in without CreateAccount fails for a new ID', async () => {
  const t = await start();
  await t.err('/Client/LoginWithCustomID', { TitleId: '1A2B3', CustomId: 'nobody' }, {}, 'AccountNotFound');
  await t.stop();
});

test('a missing required field gives PlayFab\'s InvalidParams details', async () => {
  const t = await start();
  const p = await t.player('bob');
  const r = await t.err('/Client/UpdateUserTitleDisplayName', {}, p.auth, 'InvalidParams');
  assert.deepEqual(r.errorDetails, { DisplayName: ['The DisplayName field is required.'] });
  await t.stop();
});

test('the wrong title ID is refused', async () => {
  const t = await start();
  await t.err('/Client/LoginWithCustomID', { TitleId: 'FFFF', CustomId: 'x', CreateAccount: true }, {}, 'InvalidTitleId');
  await t.stop();
});

test('device IDs sign in and link', async () => {
  const t = await start();
  const a = await t.ok('/Client/LoginWithAndroidDeviceID', { TitleId: '1A2B3', AndroidDeviceId: 'droid-1', CreateAccount: true });
  const i = await t.ok('/Client/LoginWithIOSDeviceID', { TitleId: '1A2B3', DeviceId: 'iphone-1', CreateAccount: true });
  assert.notEqual(a.PlayFabId, i.PlayFabId);
  const auth = { 'X-Authorization': a.SessionTicket };
  await t.ok('/Client/LinkCustomID', { CustomId: 'link-me' }, auth);
  const back = await t.ok('/Client/LoginWithCustomID', { TitleId: '1A2B3', CustomId: 'link-me' });
  assert.equal(back.PlayFabId, a.PlayFabId);
  await t.err('/Client/LinkIOSDeviceID', { DeviceId: 'iphone-1' }, auth, 'LinkedAccountAlreadyClaimed');
  await t.ok('/Client/LinkIOSDeviceID', { DeviceId: 'iphone-1', ForceLink: true }, auth);
  const info = await t.ok('/Client/GetAccountInfo', {}, auth);
  assert.equal(info.AccountInfo.IosDeviceInfo.IosDeviceId, 'iphone-1');
  assert.equal(info.AccountInfo.TitleInfo.Origination, 'Android');
  await t.ok('/Client/UnlinkCustomID', {}, auth);
  await t.err('/Client/LoginWithCustomID', { TitleId: '1A2B3', CustomId: 'link-me' }, {}, 'AccountNotFound');
  await t.stop();
});

test('register, then sign in with a username or an email', async () => {
  const t = await start();
  const r = await t.ok('/Client/RegisterPlayFabUser', { TitleId: '1A2B3', Username: 'carol', Email: 'carol@example.com', Password: 'hunter22', DisplayName: 'Carol' });
  assert.equal(r.Username, 'carol');
  const u = await t.ok('/Client/LoginWithPlayFab', { TitleId: '1A2B3', Username: 'CAROL', Password: 'hunter22' });
  assert.equal(u.PlayFabId, r.PlayFabId);
  const e = await t.ok('/Client/LoginWithEmailAddress', { TitleId: '1A2B3', Email: 'carol@example.com', Password: 'hunter22' });
  assert.equal(e.PlayFabId, r.PlayFabId);
  await t.err('/Client/LoginWithPlayFab', { TitleId: '1A2B3', Username: 'carol', Password: 'wrong-one' }, {}, 'InvalidUsernameOrPassword');
  await t.err('/Client/LoginWithEmailAddress', { TitleId: '1A2B3', Email: 'nobody@example.com', Password: 'hunter22' }, {}, 'InvalidEmailOrPassword');
  await t.err('/Client/RegisterPlayFabUser', { TitleId: '1A2B3', Username: 'carol', Email: 'c2@example.com', Password: 'hunter22' }, {}, 'UsernameNotAvailable');
  const bad = await t.err('/Client/RegisterPlayFabUser', { TitleId: '1A2B3', Username: 'x', Email: 'nope', Password: '123' }, {}, 'InvalidParams');
  assert.deepEqual(Object.keys(bad.errorDetails).sort(), ['Email', 'Password', 'Username']);
  await t.stop();
});

test('a device account can add a username and password', async () => {
  const t = await start();
  const p = await t.player('dave');
  const r = await t.ok('/Client/AddUsernamePassword', { Username: 'dave1', Email: 'dave@example.com', Password: 'secret123' }, p.auth);
  assert.equal(r.Username, 'dave1');
  const back = await t.ok('/Client/LoginWithPlayFab', { TitleId: '1A2B3', Username: 'dave1', Password: 'secret123' });
  assert.equal(back.PlayFabId, p.id);
  await t.stop();
});

test('Steam tickets sign in by the Steam ID inside them', async () => {
  const t = await start();
  const steamId = 76561197960287930n;
  const ticket = Buffer.alloc(52);
  ticket.writeUInt32LE(20, 0);
  ticket.writeBigUInt64LE(0x1234n, 4);
  ticket.writeBigUInt64LE(steamId, 12);
  const a = await t.ok('/Client/LoginWithSteam', { TitleId: '1A2B3', SteamTicket: ticket.toString('hex'), CreateAccount: true });
  ticket.writeBigUInt64LE(0x9999n, 4); // a new ticket for the same person
  const b = await t.ok('/Client/LoginWithSteam', { TitleId: '1A2B3', SteamTicket: ticket.toString('hex') });
  assert.equal(a.PlayFabId, b.PlayFabId);
  const ids = await t.ok('/Client/GetPlayFabIDsFromSteamIDs', { SteamStringIDs: [steamId.toString(), '76561197960287931'] }, { 'X-Authorization': a.SessionTicket });
  assert.equal(ids.Data[0].PlayFabId, a.PlayFabId);
  assert.equal(ids.Data[1].PlayFabId, undefined);
  await t.err('/Client/LoginWithSteam', { TitleId: '1A2B3', SteamTicket: 'not-a-ticket', CreateAccount: true }, {}, 'InvalidSteamTicket');
  await t.stop();
});

test('session tickets are checked and run out after a day', async () => {
  const t = await start();
  const p = await t.player('erin');
  await t.err('/Client/GetAccountInfo', {}, {}, 'NotAuthenticated');
  await t.err('/Client/GetAccountInfo', {}, { 'X-Authorization': p.auth['X-Authorization'].replace(/.$/, (c) => (c === '0' ? '1' : '0')) }, 'InvalidSessionTicket');
  t.clock.now = new Date('2026-11-28T10:00:01Z');
  await t.err('/Client/GetAccountInfo', {}, p.auth, 'NotAuthenticated');
  await t.stop();
});

test('X-ReportErrorAsSuccess makes errors come back with HTTP 200', async () => {
  const t = await start();
  const r = await t.raw('POST', '/Client/GetAccountInfo', { body: {}, headers: { 'X-ReportErrorAsSuccess': 'true' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.code, 401);
  assert.equal(r.json.error, 'NotAuthenticated');
  await t.stop();
});

test('game servers can check a player\'s session ticket', async () => {
  const t = await start();
  const p = await t.player('frank');
  const r = await t.ok('/Server/AuthenticateSessionTicket', { SessionTicket: p.auth['X-Authorization'] }, t.secret);
  assert.equal(r.UserInfo.PlayFabId, p.id);
  assert.equal(r.IsSessionTicketExpired, false);
  await t.err('/Server/AuthenticateSessionTicket', { SessionTicket: p.auth['X-Authorization'] }, { 'X-SecretKey': 'wrong' }, 'NotAuthenticated');
  const s = await t.ok('/Server/LoginWithServerCustomId', { ServerCustomId: 'server-side-1', CreateAccount: true }, t.secret);
  assert.equal(s.NewlyCreated, true);
  await t.stop();
});

test('entity tokens for players and for the title', async () => {
  const t = await start();
  const p = await t.player('gina');
  const mine = await t.ok('/Authentication/GetEntityToken', {}, p.auth);
  assert.equal(mine.Entity.Id, p.entityKey.Id);
  const title = await t.ok('/Authentication/GetEntityToken', {}, t.secret);
  assert.deepEqual(title.Entity, { Id: '1A2B3', Type: 'title', TypeString: 'title' });
  const v = await t.ok('/Authentication/ValidateEntityToken', { EntityToken: mine.EntityToken }, { 'X-EntityToken': title.EntityToken });
  assert.equal(v.Lineage.MasterPlayerAccountId, p.id);
  await t.err('/Object/GetObjects', { Entity: p.entityKey }, { 'X-EntityToken': 'nonsense.abc' }, 'EntityTokenInvalid');
  await t.err('/Object/GetObjects', { Entity: p.entityKey }, {}, 'EntityTokenMissing');
  await t.stop();
});

test('sign-in can return combined info in one go', async () => {
  const t = await start();
  const d = await t.ok('/Client/LoginWithCustomID', {
    TitleId: '1A2B3', CustomId: 'henry', CreateAccount: true,
    InfoRequestParameters: { GetUserAccountInfo: true, GetUserVirtualCurrency: true, GetTitleData: true, TitleDataKeys: ['motd'], GetPlayerProfile: true, GetUserData: true },
  });
  const info = d.InfoResultPayload;
  assert.equal(info.AccountInfo.PlayFabId, d.PlayFabId);
  assert.deepEqual(info.UserVirtualCurrency, { GO: 500, GE: 0 });
  assert.deepEqual(Object.keys(info.TitleData), ['motd']);
  assert.equal(info.PlayerProfile.TitleId, '1A2B3');
  await t.stop();
});

// The same requests and checks as the test page in Microsoft's PlayFab
// JavaScript SDK (PlayFabTestingExample/PlayFabApiTest.js), written out here.
test('passes the checks Microsoft\'s JavaScript SDK test page makes', async () => {
  const t = await start();
  const sdk = { 'X-PlayFabSDK': 'JavaScriptSDK-1.222.260922' };
  // PlayFab.GenerateErrorReport: the message, then each detail.
  const report = (e) => [e.errorMessage, ...Object.entries(e.errorDetails || {}).map(([k, v]) => `${k}: ${v.join(', ')}`)].join('\n');

  // InvalidLogin
  await t.ok('/Client/RegisterPlayFabUser', { TitleId: '1A2B3', Username: 'realuser', Email: 'nobody@example.com', Password: 'right-password' }, sdk);
  const invalid = await t.call('/Client/LoginWithEmailAddress', { TitleId: '1A2B3', Email: 'nobody@example.com', Password: 'INVALID' }, sdk);
  assert.notEqual(invalid.code, 200);
  assert.ok(invalid.errorMessage.toLowerCase().includes('password'), invalid.errorMessage);

  // InvalidRegistration
  const reg = await t.call('/Client/RegisterPlayFabUser', { TitleId: '1A2B3', Username: 'x', Email: 'x', Password: 'x' }, sdk);
  assert.notEqual(reg.code, 200);
  assert.ok(report(reg).toLowerCase().includes('email address is not valid.'), report(reg));
  assert.ok(report(reg).toLowerCase().includes('password must be between'), report(reg));

  // LoginOrRegister
  const login = await t.ok('/Client/LoginWithCustomID', { TitleId: '1A2B3', CustomId: 'jbuild_javascriptsdk_test', CreateAccount: true }, sdk);
  const auth = { ...sdk, 'X-Authorization': login.SessionTicket };

  // GetEntityToken
  const token = await t.ok('/Authentication/GetEntityToken', {}, auth);
  const entity = { ...sdk, 'X-EntityToken': token.EntityToken };
  const key = { Id: token.Entity.Id, Type: token.Entity.Type };

  // EntityObjects
  const objs1 = await t.ok('/Object/GetObjects', { Entity: key, EscapeObject: true }, entity);
  let n = objs1.Objects.testCounter ? JSON.parse(objs1.Objects.testCounter.EscapedDataObject) : 0;
  n = (n + 1) % 100;
  await t.ok('/Object/SetObjects', { Entity: key, Objects: [{ ObjectName: 'testCounter', DataObject: n }] }, entity);
  const objs2 = await t.ok('/Object/GetObjects', { Entity: key, EscapeObject: true }, entity);
  assert.equal(JSON.parse(objs2.Objects.testCounter.EscapedDataObject), n);

  // UserDataApi: the SDK test sends a number where PlayFab expects text.
  const data1 = await t.ok('/Client/GetUserData', {}, auth);
  let counter = data1.Data.testCounter ? parseInt(data1.Data.testCounter.Value, 10) : 1;
  counter = (counter + 1) % 100;
  await t.ok('/Client/UpdateUserData', { Data: { testCounter: counter } }, auth);
  const data2 = await t.ok('/Client/GetUserData', {}, auth);
  assert.equal(parseInt(data2.Data.testCounter.Value, 10), counter);
  const updated = new Date(data2.Data.testCounter.LastUpdated).getTime();
  assert.ok(Math.abs(updated - t.clock.now.getTime()) <= 5 * 60 * 1000);

  // PlayerStatisticsApi
  const stats1 = await t.ok('/Client/GetPlayerStatistics', {}, auth);
  let stat = (stats1.Statistics.find((x) => x.StatisticName === 'str') || { Value: 0 }).Value;
  stat = (stat + 1) % 100;
  await t.ok('/Client/UpdatePlayerStatistics', { Statistics: [{ StatisticName: 'str', Value: stat }] }, auth);
  const stats2 = await t.ok('/Client/GetPlayerStatistics', {}, auth);
  assert.equal(stats2.Statistics.find((x) => x.StatisticName === 'str').Value, stat);

  // UserCharacter
  await t.ok('/Client/GetAllUsersCharacters', {}, auth);

  // LeaderBoard, from the client and from the server
  const lbC = await t.ok('/Client/GetLeaderboard', { MaxResultsCount: 3, StartPosition: 0, StatisticName: 'str' }, auth);
  assert.ok(lbC.Leaderboard.length > 0);
  const lbS = await t.ok('/Server/GetLeaderboard', { MaxResultsCount: 3, StartPosition: 0, StatisticName: 'str' }, { ...sdk, ...t.secret });
  assert.ok(lbS.Leaderboard.length > 0);

  // AccountInfo
  const info = await t.ok('/Client/GetAccountInfo', {}, auth);
  assert.ok(info.AccountInfo.TitleInfo.Origination.length > 0);

  // CloudScript and CloudScriptError
  const hello = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'helloWorld' }, auth);
  assert.equal(hello.FunctionResult.messageValue, `Hello ${login.PlayFabId}!`);
  const broken = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'throwError' }, auth);
  assert.equal(broken.FunctionResult, undefined);
  assert.equal(broken.Error.Error, 'JavascriptException');

  // WriteEvent
  await t.ok('/Client/WritePlayerEvent', { EventName: 'ForumPostEvent', Body: { Subject: 'My First Post', Body: 'This is my awesome post.' } }, auth);
  await t.stop();
});

test('other sign-ins: Apple, Game Center, Nintendo, Battle.net, Kongregate, Instant Games, OpenID', async () => {
  const t = await start();
  const jwt = (claims) => ['{"alg":"RS256"}', JSON.stringify(claims), 'sig'].map((x, i) => (i < 2 ? Buffer.from(x).toString('base64url') : x)).join('.');
  const login = async (url, body) => t.ok(url, { TitleId: '1A2B3', CreateAccount: true, ...body });

  const apple = await login('/Client/LoginWithApple', { IdentityToken: jwt({ sub: 'apple-user-1', iss: 'https://appleid.apple.com' }) });
  const appleAgain = await t.ok('/Client/LoginWithApple', { TitleId: '1A2B3', IdentityToken: jwt({ sub: 'apple-user-1', iat: 2 }) });
  assert.equal(appleAgain.PlayFabId, apple.PlayFabId);
  const auth = { 'X-Authorization': apple.SessionTicket };
  const info = await t.ok('/Client/GetAccountInfo', {}, auth);
  assert.equal(info.AccountInfo.AppleAccountInfo.AppleSubjectId, 'apple-user-1');
  assert.equal(info.AccountInfo.TitleInfo.Origination, 'Apple');
  await t.err('/Client/LoginWithApple', { TitleId: '1A2B3', IdentityToken: 'not-a-token', CreateAccount: true }, {}, 'InvalidParams');

  // Link several more to the same account, then sign in with each.
  await t.ok('/Client/LinkGameCenterAccount', { GameCenterId: 'G:123' }, auth);
  await t.ok('/Client/LinkKongregate', { KongregateId: 'kong-9', AuthTicket: 'x' }, auth);
  await t.ok('/Client/LinkNintendoSwitchDeviceId', { NintendoSwitchDeviceId: 'switch-1' }, auth);
  await t.ok('/Client/LinkNintendoServiceAccount', { IdentityToken: jwt({ sub: 'na-77' }) }, auth);
  await t.ok('/Client/LinkBattleNetAccount', { IdentityToken: jwt({ sub: 'bnet-5' }) }, auth);
  const fbPayload = Buffer.from(JSON.stringify({ player_id: 'fbig-3', algorithm: 'HMAC-SHA256' })).toString('base64url');
  await t.ok('/Client/LinkFacebookInstantGamesId', { FacebookInstantGamesSignature: `sig.${fbPayload}` }, auth);
  await t.ok('/Client/LinkOpenIdConnect', { ConnectionId: 'mysite', IdToken: jwt({ sub: 'oid-1', iss: 'https://id.example.com' }) }, auth);
  for (const [url, body] of [
    ['/Client/LoginWithGameCenter', { PlayerId: 'G:123' }],
    ['/Client/LoginWithKongregate', { KongregateId: 'kong-9', AuthTicket: 'x' }],
    ['/Client/LoginWithNintendoSwitchDeviceId', { NintendoSwitchDeviceId: 'switch-1' }],
    ['/Client/LoginWithNintendoServiceAccount', { IdentityToken: jwt({ sub: 'na-77' }) }],
    ['/Client/LoginWithBattleNet', { IdentityToken: jwt({ sub: 'bnet-5' }) }],
    ['/Client/LoginWithFacebookInstantGamesId', { FacebookInstantGamesSignature: `other.${fbPayload}` }],
    ['/Client/LoginWithOpenIdConnect', { ConnectionId: 'mysite', IdToken: jwt({ sub: 'oid-1', iss: 'https://id.example.com' }) }],
  ]) {
    const r = await t.ok(url, { TitleId: '1A2B3', ...body });
    assert.equal(r.PlayFabId, apple.PlayFabId, url);
  }
  const all = await t.ok('/Client/GetAccountInfo', {}, auth);
  assert.equal(all.AccountInfo.GameCenterInfo.GameCenterId, 'G:123');
  assert.equal(all.AccountInfo.NintendoSwitchAccountInfo.NintendoSwitchAccountSubjectId, 'na-77');
  assert.deepEqual(all.AccountInfo.OpenIdInfo, [{ ConnectionId: 'mysite', Issuer: 'https://id.example.com', Subject: 'oid-1' }]);
  const profile = await t.ok('/Client/GetPlayerProfile', { ProfileConstraints: { ShowLinkedAccounts: true, ShowOrigination: true } }, auth);
  assert.equal(profile.PlayerProfile.Origination, 'Apple');
  assert.ok(profile.PlayerProfile.LinkedAccounts.some((l) => l.Platform === 'OpenIdConnect' && l.PlatformUserId === 'oid-1'));

  // Lookups, from the client and the server.
  const gc = await t.ok('/Client/GetPlayFabIDsFromGameCenterIDs', { GameCenterIDs: ['G:123', 'G:999'] }, auth);
  assert.deepEqual(gc.Data, [{ GameCenterId: 'G:123', PlayFabId: apple.PlayFabId }, { GameCenterId: 'G:999' }]);
  const oid = await t.ok('/Server/GetPlayFabIDsFromOpenIdSubjectIdentifiers', { OpenIdSubjectIdentifiers: [{ Issuer: 'https://id.example.com', Subject: 'oid-1' }] }, t.secret);
  assert.equal(oid.Data[0].PlayFabId, apple.PlayFabId);
  for (const [url, field, id] of [
    ['/Client/GetPlayFabIDsFromKongregateIDs', 'KongregateIDs', 'kong-9'],
    ['/Server/GetPlayFabIDsFromNintendoSwitchDeviceIds', 'NintendoSwitchDeviceIds', 'switch-1'],
    ['/Server/GetPlayFabIDsFromNintendoServiceAccountIds', 'NintendoAccountIds', 'na-77'],
    ['/Server/GetPlayFabIDsFromFacebookInstantGamesIds', 'FacebookInstantGamesIds', 'fbig-3'],
    ['/Server/GetPlayFabIDsFromBattleNetAccountIds', 'BattleNetAccountIds', 'bnet-5'],
  ]) {
    const r = await t.ok(url, { [field]: [id] }, url.startsWith('/Server') ? t.secret : auth);
    assert.equal(r.Data[0].PlayFabId, apple.PlayFabId, url);
  }

  // Unlinking, from the client and the server.
  await t.ok('/Client/UnlinkOpenIdConnect', { ConnectionId: 'mysite' }, auth);
  await t.ok('/Server/UnlinkGameCenterAccount', { PlayFabId: apple.PlayFabId }, t.secret);
  await t.err('/Client/LoginWithGameCenter', { TitleId: '1A2B3', PlayerId: 'G:123' }, {}, 'AccountNotFound');
  const server = await t.ok('/Server/LoginWithBattleNet', { IdentityToken: jwt({ sub: 'bnet-5' }) }, t.secret);
  assert.equal(server.PlayFabId, apple.PlayFabId);
  await t.ok('/Server/LinkNintendoServiceAccountSubject', { PlayFabId: apple.PlayFabId, Subject: 'na-88', ForceLink: true }, t.secret);
  await t.ok('/Server/UnlinkNintendoServiceAccount', { PlayFabId: apple.PlayFabId }, t.secret);
  await t.stop();
});

test('generic IDs, custom properties, segments and reports', async () => {
  const t = await start();
  const a = await t.player('gp-a');
  const b = await t.player('gp-b');
  await t.ok('/Client/AddGenericID', { GenericId: { ServiceName: 'OldForum', UserId: 'user-42' } }, a.auth);
  await t.err('/Client/AddGenericID', { GenericId: { ServiceName: 'OldForum', UserId: 'user-42' } }, b.auth, 'LinkedAccountAlreadyClaimed');
  const found = await t.ok('/Server/GetPlayFabIDsFromGenericIDs', { GenericIDs: [{ ServiceName: 'OldForum', UserId: 'user-42' }] }, t.secret);
  assert.equal(found.Data[0].PlayFabId, a.id);
  await t.ok('/Client/RemoveGenericID', { GenericId: { ServiceName: 'OldForum', UserId: 'user-42' } }, a.auth);
  await t.ok('/Server/AddGenericID', { PlayFabId: b.id, GenericId: { ServiceName: 'OldForum', UserId: 'user-42' } }, t.secret);

  const v1 = await t.ok('/Client/UpdatePlayerCustomProperties', { Properties: [{ Name: 'region', Value: 'eu' }, { Name: 'level', Value: 7 }] }, a.auth);
  assert.equal(v1.PropertiesVersion, 1);
  await t.err('/Client/UpdatePlayerCustomProperties', { Properties: [{ Name: 'x', Value: 1 }], ExpectedPropertiesVersion: 0 }, a.auth, 'PlayerCustomPropertiesVersionMismatch');
  await t.err('/Client/UpdatePlayerCustomProperties', { Properties: [{ Name: 'bad name', Value: 1 }] }, a.auth, 'PlayerCustomPropertiesPropertyNameIsInvalid');
  await t.err('/Client/UpdatePlayerCustomProperties', { Properties: [{ Name: 'obj', Value: { no: 1 } }] }, a.auth, 'PlayerCustomPropertiesValueIsInvalidType');
  const one = await t.ok('/Client/GetPlayerCustomProperty', { PropertyName: 'level' }, a.auth);
  assert.deepEqual(one.Property, { Name: 'level', Value: 7 });
  await t.err('/Client/GetPlayerCustomProperty', { PropertyName: 'nope' }, a.auth, 'PlayerCustomPropertiesPropertyDoesNotExist');
  const list = await t.ok('/Server/ListPlayerCustomProperties', { PlayFabId: a.id }, t.secret);
  assert.equal(list.Properties.length, 2);
  const del = await t.ok('/Admin/DeletePlayerCustomProperties', { PlayFabId: a.id, PropertyNames: ['region', 'nope'] }, t.secret);
  assert.deepEqual(del.DeletedProperties, [{ Name: 'region', WasDeleted: true }, { Name: 'nope', WasDeleted: false }]);
  assert.equal(del.PropertiesVersion, 2);

  assert.deepEqual((await t.ok('/Client/GetPlayerSegments', {}, a.auth)).Segments, []);
  for (let i = 4; i >= 0; i--) assert.equal((await t.ok('/Client/ReportPlayer', { ReporteeId: b.id }, a.auth)).SubmissionsRemaining, i);
  assert.deepEqual(await t.ok('/Client/ReportPlayer', { ReporteeId: b.id }, a.auth), { SubmissionsRemaining: 0, Updated: false });
  await t.ok('/Server/ReportPlayer', { ReporterId: b.id, ReporteeId: a.id, Comment: 'test' }, t.secret);
  await t.ok('/Client/GetAdPlacements', { AppId: 'app' }, a.auth);
  await t.ok('/Client/AndroidDevicePushNotificationRegistration', { DeviceToken: 'tok' }, a.auth);
  await t.ok('/Client/RegisterForIOSPushNotification', { DeviceToken: 'tok' }, a.auth);
  await t.stop();
});

// ---------------------------------------------------------------- data

test('player data: save, read, remove, versions and privacy', async () => {
  const t = await start();
  const a = await t.player('ivy');
  const b = await t.player('jack');
  const v1 = await t.ok('/Client/UpdateUserData', { Data: { level: '3', secret: 'x' } }, a.auth);
  const v2 = await t.ok('/Client/UpdateUserData', { Data: { name: 'Ivy' }, Permission: 'Public' }, a.auth);
  assert.equal(v2.DataVersion, v1.DataVersion + 1);
  const mine = await t.ok('/Client/GetUserData', {}, a.auth);
  assert.deepEqual(Object.keys(mine.Data).sort(), ['level', 'name', 'secret']);
  assert.equal(mine.Data.level.Permission, 'Private');
  const theirs = await t.ok('/Client/GetUserData', { PlayFabId: a.id }, b.auth);
  assert.deepEqual(Object.keys(theirs.Data), ['name']);
  const unchanged = await t.ok('/Client/GetUserData', { IfChangedFromDataVersion: v2.DataVersion }, a.auth);
  assert.deepEqual(unchanged.Data, {});
  await t.ok('/Client/UpdateUserData', { KeysToRemove: ['secret'], Data: { level: null } }, a.auth);
  const after = await t.ok('/Client/GetUserData', { Keys: ['level', 'secret', 'name'] }, a.auth);
  assert.deepEqual(Object.keys(after.Data), ['name']);
  await t.err('/Client/UpdateUserData', { Data: { '!bad': '1' } }, a.auth, 'InvalidParams');
  // Numbers sent for text are turned into text, like PlayFab does.
  await t.ok('/Client/UpdateUserData', { Data: { counter: 7, flag: true } }, a.auth);
  const coerced = await t.ok('/Client/GetUserData', { Keys: ['counter', 'flag'] }, a.auth);
  assert.equal(coerced.Data.counter.Value, '7');
  assert.equal(coerced.Data.flag.Value, 'true');
  await t.err('/Client/UpdateUserData', { Data: { nested: { no: 1 } } }, a.auth, 'InvalidParams');
  await t.stop();
});

test('read-only and internal data are written by the server', async () => {
  const t = await start();
  const p = await t.player('kate');
  await t.ok('/Server/UpdateUserReadOnlyData', { PlayFabId: p.id, Data: { rank: 'gold' } }, t.secret);
  await t.ok('/Server/UpdateUserInternalData', { PlayFabId: p.id, Data: { cheatFlags: '0' } }, t.secret);
  const ro = await t.ok('/Client/GetUserReadOnlyData', {}, p.auth);
  assert.equal(ro.Data.rank.Value, 'gold');
  const internal = await t.ok('/Server/GetUserInternalData', { PlayFabId: p.id }, t.secret);
  assert.equal(internal.Data.cheatFlags.Value, '0');
  assert.equal(internal.PlayFabId, p.id);
  await t.stop();
});

test('title data from the folder, changed by the server', async () => {
  const t = await start();
  const p = await t.player('liam');
  const d = await t.ok('/Client/GetTitleData', { Keys: ['motd', 'nope'] }, p.auth);
  assert.deepEqual(d.Data, { motd: 'Welcome back! Double gold this weekend.' });
  const all = await t.ok('/Client/GetTitleData', {}, p.auth);
  assert.equal(JSON.parse(all.Data.dropRates).rare, 0.25);
  await t.ok('/Server/SetTitleData', { Key: 'motd', Value: 'Patch day' }, t.secret);
  assert.equal((await t.ok('/Client/GetTitleData', { Keys: ['motd'] }, p.auth)).Data.motd, 'Patch day');
  await t.ok('/Admin/SetTitleData', { Key: 'motd' }, t.secret);
  assert.deepEqual((await t.ok('/Client/GetTitleData', { Keys: ['motd'] }, p.auth)).Data, {});
  await t.stop();
});

// ---------------------------------------------------------------- statistics

test('statistics keep the best score and fill the leaderboard', async () => {
  const t = await start();
  const players = [];
  for (const [name, score] of [['mia', 300], ['noah', 900], ['olga', 600], ['pete', 900]]) {
    const p = await t.player(name);
    await t.ok('/Client/UpdateUserTitleDisplayName', { DisplayName: name.toUpperCase() }, p.auth);
    await t.ok('/Client/UpdatePlayerStatistics', { Statistics: [{ StatisticName: 'HighScore', Value: score }] }, p.auth);
    players.push(p);
    t.clock.now = new Date(t.clock.now.getTime() + 1000);
  }
  // HighScore keeps the maximum.
  await t.ok('/Client/UpdatePlayerStatistics', { Statistics: [{ StatisticName: 'HighScore', Value: 100 }] }, players[0].auth);
  const s = await t.ok('/Client/GetPlayerStatistics', { StatisticNames: ['HighScore'] }, players[0].auth);
  assert.equal(s.Statistics[0].Value, 300);

  const lb = await t.ok('/Client/GetLeaderboard', { StatisticName: 'HighScore', StartPosition: 0, MaxResultsCount: 10 }, players[0].auth);
  assert.deepEqual(lb.Leaderboard.map((e) => [e.DisplayName, e.StatValue, e.Position]), [['NOAH', 900, 0], ['PETE', 900, 1], ['OLGA', 600, 2], ['MIA', 300, 3]]);
  const around = await t.ok('/Client/GetLeaderboardAroundPlayer', { StatisticName: 'HighScore', MaxResultsCount: 3 }, players[2].auth);
  assert.deepEqual(around.Leaderboard.map((e) => e.DisplayName), ['PETE', 'OLGA', 'MIA']);
  await t.err('/Client/UpdatePlayerStatistics', { Statistics: [{ StatisticName: 'A', Value: 1 }, { StatisticName: 'A', Value: 2 }] }, players[0].auth, 'DuplicateStatisticName');
  await t.stop();
});

test('weekly statistics start a new version every Monday', async () => {
  const t = await start();
  const p = await t.player('quinn');
  await t.ok('/Client/UpdatePlayerStatistics', { Statistics: [{ StatisticName: 'WeeklyKills', Value: 5 }] }, p.auth);
  await t.ok('/Client/UpdatePlayerStatistics', { Statistics: [{ StatisticName: 'WeeklyKills', Value: 7 }] }, p.auth);
  let lb = await t.ok('/Client/GetLeaderboard', { StatisticName: 'WeeklyKills', StartPosition: 0 }, p.auth);
  assert.equal(lb.Leaderboard[0].StatValue, 12);
  assert.equal(lb.NextReset, '2026-11-30T00:00:00.000Z');
  t.clock.now = new Date('2026-11-30T00:00:05Z'); // Monday
  const fresh = await t.player('quinn');
  lb = await t.ok('/Client/GetLeaderboard', { StatisticName: 'WeeklyKills', StartPosition: 0 }, fresh.auth);
  assert.equal(lb.Leaderboard.length, 0);
  assert.equal(lb.Version, 1);
  const old = await t.ok('/Client/GetLeaderboard', { StatisticName: 'WeeklyKills', StartPosition: 0, Version: 0 }, fresh.auth);
  assert.equal(old.Leaderboard[0].StatValue, 12);
  const versions = await t.ok('/Client/GetPlayerStatisticVersions', { StatisticName: 'WeeklyKills' }, fresh.auth);
  assert.equal(versions.StatisticVersions.length, 2);
  await t.stop();
});

test('players can be stopped from posting their own statistics', async () => {
  const t = await start();
  t.app.title().settings.allowClientStatistics = false;
  const p = await t.player('rosa');
  await t.err('/Client/UpdatePlayerStatistics', { Statistics: [{ StatisticName: 'HighScore', Value: 1 }] }, p.auth, 'APINotEnabledForGameClientAccess');
  await t.ok('/Server/UpdatePlayerStatistics', { PlayFabId: p.id, Statistics: [{ StatisticName: 'HighScore', Value: 1 }] }, t.secret);
  await t.stop();
});

// ---------------------------------------------------------------- economy

test('new players get their starting currency, and shops sell items', async () => {
  const t = await start();
  const p = await t.player('sam');
  let inv = await t.ok('/Client/GetUserInventory', {}, p.auth);
  assert.deepEqual(inv.VirtualCurrency, { GO: 500, GE: 0 });
  const cat = await t.ok('/Client/GetCatalogItems', {}, p.auth);
  assert.equal(cat.Catalog.length, 5);
  await t.err('/Client/PurchaseItem', { ItemId: 'sword', VirtualCurrency: 'GO', Price: 99 }, p.auth, 'WrongPrice');
  await t.err('/Client/PurchaseItem', { ItemId: 'sword', VirtualCurrency: 'GE', Price: 100 }, p.auth, 'WrongVirtualCurrency');
  await t.err('/Client/PurchaseItem', { ItemId: 'dragon', VirtualCurrency: 'GO', Price: 1 }, p.auth, 'ItemNotFound');
  const bought = await t.ok('/Client/PurchaseItem', { ItemId: 'sword', VirtualCurrency: 'GO', Price: 60, StoreId: 'weekend_sale' }, p.auth);
  assert.equal(bought.Items[0].UnitPrice, 60);
  const pack = await t.ok('/Client/PurchaseItem', { ItemId: 'starter_pack', VirtualCurrency: 'GO', Price: 150 }, p.auth);
  assert.deepEqual(pack.Items.map((i) => i.ItemId), ['starter_pack', 'sword', 'potion']);
  inv = await t.ok('/Client/GetUserInventory', {}, p.auth);
  assert.equal(inv.VirtualCurrency.GO, 290);
  assert.equal(inv.VirtualCurrency.GE, 5);
  assert.equal(inv.Inventory.length, 4);
  const store = await t.ok('/Client/GetStoreItems', { StoreId: 'weekend_sale' }, p.auth);
  assert.equal(store.MarketingData.DisplayName, 'Weekend sale');
  await t.err('/Client/GetStoreItems', { StoreId: 'nope' }, p.auth, 'StoreNotFound');
  for (let i = 0; i < 29; i++) await t.ok('/Client/PurchaseItem', { ItemId: 'potion', VirtualCurrency: 'GO', Price: 10 }, p.auth);
  await t.err('/Client/PurchaseItem', { ItemId: 'potion', VirtualCurrency: 'GO', Price: 10 }, p.auth, 'InsufficientFunds');
  await t.stop();
});

test('stackable consumables stack, and get used up', async () => {
  const t = await start();
  const p = await t.player('tara');
  await t.ok('/Server/GrantItemsToUser', { PlayFabId: p.id, ItemIds: ['potion', 'potion', 'potion', 'dragon'] }, t.secret);
  const inv = await t.ok('/Client/GetUserInventory', {}, p.auth);
  const potion = inv.Inventory.find((i) => i.ItemId === 'potion');
  assert.equal(inv.Inventory.length, 1);
  assert.equal(potion.RemainingUses, 3);
  const used = await t.ok('/Client/ConsumeItem', { ItemInstanceId: potion.ItemInstanceId, ConsumeCount: 2 }, p.auth);
  assert.equal(used.RemainingUses, 1);
  await t.err('/Client/ConsumeItem', { ItemInstanceId: potion.ItemInstanceId, ConsumeCount: 2 }, p.auth, 'NoRemainingUses');
  await t.ok('/Client/ConsumeItem', { ItemInstanceId: potion.ItemInstanceId, ConsumeCount: 1 }, p.auth);
  assert.equal((await t.ok('/Client/GetUserInventory', {}, p.auth)).Inventory.length, 0);
  await t.stop();
});

test('containers need their key and give what is inside', async () => {
  const t = await start();
  const p = await t.player('uma');
  await t.ok('/Client/PurchaseItem', { ItemId: 'crate', VirtualCurrency: 'GO', Price: 40 }, p.auth);
  await t.err('/Client/UnlockContainerItem', { ContainerItemId: 'crate' }, p.auth, 'KeyNotOwned');
  await t.ok('/Client/PurchaseItem', { ItemId: 'crate_key', VirtualCurrency: 'GO', Price: 25 }, p.auth);
  const r = await t.ok('/Client/UnlockContainerItem', { ContainerItemId: 'crate' }, p.auth);
  assert.deepEqual(r.GrantedItems.map((i) => i.ItemId), ['potion']);
  assert.deepEqual(r.VirtualCurrency, { GO: 50 });
  const inv = await t.ok('/Client/GetUserInventory', {}, p.auth);
  assert.deepEqual(inv.Inventory.map((i) => i.ItemId), ['potion']);
  assert.equal(inv.VirtualCurrency.GO, 500 - 40 - 25 + 50);
  await t.stop();
});

test('currency: players can\'t add their own, servers can, and gems recharge', async () => {
  const t = await start();
  const p = await t.player('vic');
  await t.err('/Client/AddUserVirtualCurrency', { VirtualCurrency: 'GO', Amount: 1000 }, p.auth, 'APINotEnabledForGameClientAccess');
  const r = await t.ok('/Server/AddUserVirtualCurrency', { PlayFabId: p.id, VirtualCurrency: 'GO', Amount: 25 }, t.secret);
  assert.equal(r.Balance, 525);
  await t.err('/Server/AddUserVirtualCurrency', { PlayFabId: p.id, VirtualCurrency: 'ZZ', Amount: 1 }, t.secret, 'InvalidVirtualCurrency');
  let inv = await t.ok('/Client/GetUserInventory', {}, p.auth);
  assert.equal(inv.VirtualCurrency.GE, 0);
  assert.equal(inv.VirtualCurrencyRechargeTimes.GE.SecondsToRecharge, 3600);
  t.clock.now = new Date(t.clock.now.getTime() + 3.5 * 3600 * 1000); // 24 a day = one an hour
  inv = await t.ok('/Client/GetUserInventory', {}, p.auth);
  assert.equal(inv.VirtualCurrency.GE, 3);
  assert.equal(inv.VirtualCurrencyRechargeTimes.GE.SecondsToRecharge, 1800);
  t.clock.now = new Date(t.clock.now.getTime() + 48 * 3600 * 1000);
  const later = await t.player('vic'); // the old session ticket ran out after a day
  inv = await t.ok('/Client/GetUserInventory', {}, later.auth);
  assert.equal(inv.VirtualCurrency.GE, 10); // RechargeMax
  await t.stop();
});

test('the economy can be set up through Admin calls', async () => {
  const t = await start({ titleDir: null });
  await t.ok('/Admin/AddVirtualCurrencyTypes', { VirtualCurrencies: [{ CurrencyCode: 'CO', DisplayName: 'Coins', InitialDeposit: 10 }] }, t.secret);
  await t.err('/Admin/AddVirtualCurrencyTypes', { VirtualCurrencies: [{ CurrencyCode: 'coins' }] }, t.secret, 'InvalidVirtualCurrency');
  await t.ok('/Admin/SetCatalogItems', { CatalogVersion: 'v1', Catalog: [{ ItemId: 'hat', VirtualCurrencyPrices: { CO: 5 } }], SetAsDefaultCatalog: true }, t.secret);
  await t.ok('/Admin/UpdateCatalogItems', { CatalogVersion: 'v1', Catalog: [{ ItemId: 'scarf', VirtualCurrencyPrices: { CO: 3 } }] }, t.secret);
  const cat = await t.ok('/Admin/GetCatalogItems', { CatalogVersion: 'v1' }, t.secret);
  assert.deepEqual(cat.Catalog.map((i) => i.ItemId), ['hat', 'scarf']);
  const p = await t.ok('/Client/LoginWithCustomID', { TitleId: 'ABCD', CustomId: 'wes', CreateAccount: true });
  assert.equal(t.app.title().titleId, 'ABCD'); // set by the first sign-in
  await t.ok('/Client/PurchaseItem', { ItemId: 'hat', VirtualCurrency: 'CO', Price: 5 }, { 'X-Authorization': p.SessionTicket });
  await t.stop();
});

test('characters: data, statistics, leaderboards, inventory and currency', async () => {
  const t = await start();
  const a = await t.player('ch-a');
  const b = await t.player('ch-b');
  await t.ok('/Admin/UpdateCatalogItems', { CatalogVersion: 'Main', Catalog: [{ ItemId: 'hero_token', ItemClass: 'Character', CanBecomeCharacter: true, VirtualCurrencyPrices: { GO: 50 } }] }, t.secret);

  // Two ways to get a character.
  const knight = await t.ok('/Server/GrantCharacterToUser', { PlayFabId: a.id, CharacterName: 'Sir Ida', CharacterType: 'knight' }, t.secret);
  await t.err('/Client/GrantCharacterToUser', { CharacterName: 'Nope', ItemId: 'hero_token' }, a.auth, 'ItemNotFound');
  await t.ok('/Client/PurchaseItem', { ItemId: 'hero_token', VirtualCurrency: 'GO', Price: 50 }, a.auth);
  const hero = await t.ok('/Client/GrantCharacterToUser', { CharacterName: 'Hero', ItemId: 'hero_token' }, a.auth);
  assert.equal(hero.CharacterType, 'hero_token');
  assert.equal(hero.Result, true);
  const mine = await t.ok('/Client/GetAllUsersCharacters', {}, a.auth);
  assert.deepEqual(mine.Characters.map((c) => c.CharacterName).sort(), ['Hero', 'Sir Ida']);
  assert.equal((await t.ok('/Client/GetUserInventory', {}, a.auth)).Inventory.length, 0); // the token was used up
  const knightId = knight.CharacterId;

  // Data: public and private, and server-only kinds.
  await t.ok('/Client/UpdateCharacterData', { CharacterId: knightId, Data: { armour: 'plate' }, Permission: 'Public' }, a.auth);
  await t.ok('/Client/UpdateCharacterData', { CharacterId: knightId, Data: { secret: 'x' } }, a.auth);
  await t.ok('/Server/UpdateCharacterReadOnlyData', { PlayFabId: a.id, CharacterId: knightId, Data: { level: '9' } }, t.secret);
  await t.ok('/Server/UpdateCharacterInternalData', { PlayFabId: a.id, CharacterId: knightId, Data: { flag: '1' } }, t.secret);
  const own = await t.ok('/Client/GetCharacterData', { CharacterId: knightId }, a.auth);
  assert.deepEqual(Object.keys(own.Data).sort(), ['armour', 'secret']);
  const other = await t.ok('/Client/GetCharacterData', { PlayFabId: a.id, CharacterId: knightId }, b.auth);
  assert.deepEqual(Object.keys(other.Data), ['armour']);
  assert.equal((await t.ok('/Client/GetCharacterReadOnlyData', { CharacterId: knightId }, a.auth)).Data.level.Value, '9');
  assert.equal((await t.ok('/Server/GetCharacterInternalData', { PlayFabId: a.id, CharacterId: knightId }, t.secret)).Data.flag.Value, '1');
  await t.err('/Client/GetCharacterData', { CharacterId: 'NOPE' }, a.auth, 'CharacterNotFound');

  // Statistics and leaderboards across everyone's characters.
  const bKnight = await t.ok('/Server/GrantCharacterToUser', { PlayFabId: b.id, CharacterName: 'Dame Bo', CharacterType: 'knight' }, t.secret);
  await t.ok('/Client/UpdateCharacterStatistics', { CharacterId: knightId, CharacterStatistics: { kills: 10 } }, a.auth);
  await t.ok('/Client/UpdateCharacterStatistics', { CharacterId: hero.CharacterId, CharacterStatistics: { kills: 30 } }, a.auth);
  await t.ok('/Server/UpdateCharacterStatistics', { PlayFabId: b.id, CharacterId: bKnight.CharacterId, CharacterStatistics: { kills: 20 } }, t.secret);
  assert.deepEqual((await t.ok('/Client/GetCharacterStatistics', { CharacterId: knightId }, a.auth)).CharacterStatistics, { kills: 10 });
  const lb = await t.ok('/Client/GetCharacterLeaderboard', { StatisticName: 'kills', StartPosition: 0, MaxResultsCount: 10 }, a.auth);
  assert.deepEqual(lb.Leaderboard.map((e) => [e.CharacterName, e.StatValue, e.Position]), [['Hero', 30, 0], ['Dame Bo', 20, 1], ['Sir Ida', 10, 2]]);
  const knights = await t.ok('/Server/GetCharacterLeaderboard', { StatisticName: 'kills', StartPosition: 0, MaxResultsCount: 10, CharacterType: 'knight' }, t.secret);
  assert.deepEqual(knights.Leaderboard.map((e) => e.CharacterName), ['Dame Bo', 'Sir Ida']);
  const near = await t.ok('/Client/GetLeaderboardAroundCharacter', { CharacterId: knightId, StatisticName: 'kills', MaxResultsCount: 1 }, a.auth);
  assert.deepEqual(near.Leaderboard.map((e) => e.Position), [2]);
  const ours = await t.ok('/Client/GetLeaderboardForUserCharacters', { StatisticName: 'kills' }, a.auth);
  assert.deepEqual(ours.Leaderboard.map((e) => [e.CharacterName, e.Position]), [['Hero', 0], ['Sir Ida', 2]]);
  await t.err('/Client/UpdateCharacterStatistics', { CharacterId: knightId, CharacterStatistics: { kills: 1.5 } }, a.auth, 'InvalidParams');
  await t.err('/Client/UpdateCharacterStatistics', { CharacterId: knightId, CharacterStatistics: { kills: 2147483648 } }, a.auth, 'InvalidParams');

  // Inventory and currency.
  const granted = await t.ok('/Server/GrantItemsToCharacter', { PlayFabId: a.id, CharacterId: knightId, ItemIds: ['sword', 'potion', 'crate', 'crate_key'] }, t.secret);
  assert.ok(granted.ItemGrantResults.every((r) => r.CharacterId === knightId && r.Result));
  let inv = await t.ok('/Client/GetCharacterInventory', { CharacterId: knightId }, a.auth);
  assert.equal(inv.Inventory.length, 4);
  const potion = inv.Inventory.find((i) => i.ItemId === 'potion');
  await t.ok('/Client/ConsumeItem', { CharacterId: knightId, ItemInstanceId: potion.ItemInstanceId, ConsumeCount: 1 }, a.auth);
  const opened = await t.ok('/Client/UnlockContainerItem', { CharacterId: knightId, ContainerItemId: 'crate' }, a.auth);
  assert.deepEqual(opened.GrantedItems.map((i) => i.ItemId), ['potion']);
  const sword = inv.Inventory.find((i) => i.ItemId === 'sword');
  await t.ok('/Server/MoveItemToUserFromCharacter', { PlayFabId: a.id, CharacterId: knightId, ItemInstanceId: sword.ItemInstanceId }, t.secret);
  await t.ok('/Server/MoveItemToCharacterFromUser', { PlayFabId: a.id, CharacterId: hero.CharacterId, ItemInstanceId: sword.ItemInstanceId }, t.secret);
  await t.ok('/Server/MoveItemToCharacterFromCharacter', { PlayFabId: a.id, GivingCharacterId: hero.CharacterId, ReceivingCharacterId: knightId, ItemInstanceId: sword.ItemInstanceId }, t.secret);
  const added = await t.ok('/Server/AddCharacterVirtualCurrency', { PlayFabId: a.id, CharacterId: knightId, VirtualCurrency: 'GO', Amount: 30 }, t.secret);
  assert.deepEqual(added, { Balance: 80, VirtualCurrency: 'GO' }); // 50 from the crate, then 30
  await t.ok('/Server/SubtractCharacterVirtualCurrency', { PlayFabId: a.id, CharacterId: knightId, VirtualCurrency: 'GO', Amount: 5 }, t.secret);
  inv = await t.ok('/Server/GetCharacterInventory', { PlayFabId: a.id, CharacterId: knightId }, t.secret);
  assert.deepEqual(inv.Inventory.map((i) => i.ItemId).sort(), ['potion', 'sword']);
  assert.equal(inv.VirtualCurrency.GO, 75);
  await t.err('/Client/PurchaseItem', { CharacterId: knightId, ItemId: 'sword', VirtualCurrency: 'GO', Price: 100 }, a.auth, 'NotImplemented');

  // Combined info lists characters; deleting one can keep its things.
  const info = await t.ok('/Client/GetPlayerCombinedInfo', { InfoRequestParameters: { GetCharacterList: true, GetCharacterInventories: true } }, a.auth);
  assert.equal(info.InfoResultPayload.CharacterList.length, 2);
  await t.ok('/Admin/ResetCharacterStatistics', { PlayFabId: a.id, CharacterId: knightId }, t.secret);
  assert.deepEqual((await t.ok('/Server/GetCharacterStatistics', { PlayFabId: a.id, CharacterId: knightId }, t.secret)).CharacterStatistics, {});
  await t.ok('/Server/DeleteCharacterFromUser', { PlayFabId: a.id, CharacterId: knightId, SaveCharacterInventory: true }, t.secret);
  assert.deepEqual((await t.ok('/Client/GetUserInventory', {}, a.auth)).Inventory.map((i) => i.ItemId).sort(), ['potion', 'sword']);
  assert.equal((await t.ok('/Server/GetAllUsersCharacters', { PlayFabId: a.id }, t.secret)).Characters.length, 1);
  await t.ok('/Server/GetCharacterData', { PlayFabId: b.id, CharacterId: bKnight.CharacterId }, t.secret);
  await t.ok('/Server/GetCharacterReadOnlyData', { PlayFabId: b.id, CharacterId: bKnight.CharacterId }, t.secret);
  await t.ok('/Server/UpdateCharacterData', { PlayFabId: b.id, CharacterId: bKnight.CharacterId, Data: { x: '1' } }, t.secret);
  await t.ok('/Server/GetLeaderboardAroundCharacter', { PlayFabId: b.id, CharacterId: bKnight.CharacterId, StatisticName: 'kills', MaxResultsCount: 3 }, t.secret);
  await t.ok('/Server/GetLeaderboardForUserCharacters', { PlayFabId: b.id, StatisticName: 'kills' }, t.secret);
  await t.stop();
});

// ---------------------------------------------------------------- CloudScript

test('CloudScript runs the game\'s own functions', async () => {
  const t = await start();
  const p = await t.player('xena');
  const hello = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'helloWorld' }, p.auth);
  assert.equal(hello.FunctionResult.messageValue, `Hello ${p.id}!`);
  assert.deepEqual(hello.Logs.map((l) => l.Level), ['Info']);
  assert.equal(hello.Revision, 1);

  const first = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'claimDailyReward' }, p.auth);
  assert.deepEqual(first.FunctionResult, { granted: true, balance: 600 });
  assert.equal(first.APIRequestsIssued, 3);
  const second = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'claimDailyReward' }, p.auth);
  assert.equal(second.FunctionResult.granted, false);

  const level = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'finishLevel', FunctionParameter: { score: 4200 } }, p.auth);
  assert.deepEqual(level.FunctionResult, { best: 4200 });
  await t.stop();
});

test('CloudScript errors come back the way PlayFab sends them', async () => {
  const t = await start();
  const p = await t.player('yuri');
  const missing = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'nope' }, p.auth);
  assert.equal(missing.Error.Error, 'CloudScriptNotFound');
  const thrown = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'finishLevel', FunctionParameter: {} }, p.auth);
  assert.equal(thrown.Error.Error, 'JavascriptException');
  assert.match(thrown.Error.StackTrace, /finishLevel needs a score/);
  const caught = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'lookUpSomeone', FunctionParameter: { playFabId: '0000000000000000' } }, p.auth);
  assert.deepEqual(caught.FunctionResult, { found: false, error: 'AccountNotFound' });
  assert.equal(caught.Logs[0].Message, 'PlayFabAPIError');
  await t.stop();
});

test('CloudScript uploads, revisions and time limits', async () => {
  const t = await start();
  const p = await t.player('zoe');
  await t.err('/Admin/UpdateCloudScript', { Files: [{ Filename: 'a.js', FileContents: 'handlers.x = function( {' }], Publish: true }, t.secret, 'JavascriptException');
  const up = await t.ok('/Admin/UpdateCloudScript', {
    Files: [{ Filename: 'main.js', FileContents: 'handlers.spin = function () { while (true) {} };\nhandlers.who = function () { return script.revision; };' }],
    Publish: false,
  }, t.secret);
  assert.equal(up.Revision, 2);
  const live = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'who' }, p.auth);
  assert.equal(live.Error.Error, 'CloudScriptNotFound'); // revision 1 is still live
  const latest = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'who', RevisionSelection: 'Latest' }, p.auth);
  assert.equal(latest.FunctionResult, 2);
  await t.ok('/Admin/SetPublishedRevision', { Version: 1, Revision: 2 }, t.secret);
  const versions = await t.ok('/Admin/GetCloudScriptVersions', {}, t.secret);
  assert.deepEqual(versions.Versions, [{ Version: 1, PublishedRevision: 2, LatestRevision: 2 }]);
  t.app.title().settings.cloudScriptTimeoutMs = 200;
  const spun = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'spin' }, p.auth);
  assert.equal(spun.Error.Error, 'CloudScriptExecutionTimeLimitExceeded');
  await t.stop();
});

test('CloudScript can use entity calls too', async () => {
  const t = await start();
  const p = await t.player('quentin');
  const source = `handlers.saveLoadout = function (args) {
    var account = server.GetUserAccountInfo({ PlayFabId: currentPlayerId }).UserInfo.TitleInfo.TitlePlayerAccount;
    var key = { Id: account.Id, Type: account.Type };
    entity.SetObjects({ Entity: key, Objects: [{ ObjectName: 'fromScript', DataObject: args }] });
    return entity.GetObjects({ Entity: key }).Objects.fromScript.DataObject;
  };`;
  await t.ok('/Admin/UpdateCloudScript', { Files: [{ Filename: 'entity.js', FileContents: source }], Publish: true }, t.secret);
  const r = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'saveLoadout', FunctionParameter: { hat: 'red' } }, p.auth);
  assert.deepEqual(r.FunctionResult, { hat: 'red' }, JSON.stringify(r));
  assert.equal(r.APIRequestsIssued, 3);
  const got = await t.ok('/Object/GetObjects', { Entity: p.entityKey }, p.entity);
  assert.deepEqual(got.Objects.fromScript.DataObject, { hat: 'red' });
  await t.stop();
});

test('CloudScript can\'t reach the server\'s own objects, and booby traps don\'t hang it', async () => {
  const t = await start();
  const p = await t.player('pam');
  const source = [
    "handlers.viaThis = function () { return this.constructor.constructor('return typeof process')(); };",
    "handlers.viaLog = function () { return log.info.constructor('return typeof process')(); };",
    "handlers.viaResult = function () { var r = server.GetTime({}); return r.constructor.constructor('return typeof process')(); };",
    "handlers.viaError = function () { try { server.GetUserAccountInfo({ PlayFabId: '0000000000000000' }); } catch (e) { return e.apiErrorInfo.constructor.constructor('return typeof process')(); } };",
    "handlers.viaGlobals = function () { return [typeof process, typeof require, typeof globalThis.process, typeof module].join(','); };",
    "handlers.trap = function () { throw { get stack() { for (;;) {} } }; };",
    "handlers.circular = function () { var a = {}; a.a = a; return a; };",
    "handlers.nothing = function () {};",
  ].join('\n');
  await t.ok('/Admin/UpdateCloudScript', { Files: [{ Filename: 'probe.js', FileContents: source }], Publish: true }, t.secret);
  const run = (name) => t.ok('/Client/ExecuteCloudScript', { FunctionName: name }, p.auth);
  for (const name of ['viaThis', 'viaLog', 'viaResult', 'viaError']) {
    const r = await run(name);
    assert.equal(r.FunctionResult, 'undefined', `${name} reached the server: ${JSON.stringify(r)}`);
  }
  assert.equal((await run('viaGlobals')).FunctionResult, 'undefined,undefined,undefined,undefined');
  t.app.title().settings.cloudScriptTimeoutMs = 300;
  const trapped = await run('trap');
  assert.equal(trapped.Error.Error, 'CloudScriptExecutionTimeLimitExceeded');
  const circular = await run('circular');
  assert.equal(circular.Error.Error, 'JavascriptException');
  assert.match(circular.Error.StackTrace, /circular/i);
  const nothing = await run('nothing');
  assert.equal(nothing.FunctionResult, undefined);
  assert.equal(nothing.Error, undefined);

  // A script that breaks while loading.
  await t.ok('/Admin/UpdateCloudScript', { Files: [{ Filename: 'bad.js', FileContents: 'notDefined();' }], Publish: true }, t.secret);
  const broken = await run('anything');
  assert.equal(broken.Error.Error, 'JavascriptException');
  assert.match(broken.Error.StackTrace, /notDefined is not defined/);
  // ...and one that throws a booby-trapped object while loading.
  await t.ok('/Admin/UpdateCloudScript', { Files: [{ Filename: 'trap.js', FileContents: 'throw { get stack() { for (;;) {} } };' }], Publish: true }, t.secret);
  const trappedLoad = await run('anything');
  assert.equal(trappedLoad.Error.StackTrace, 'An error that could not be shown');
  assert.equal((await t.ok('/Client/GetTime', {}, p.auth)).Time, '2026-11-27T10:00:00.000Z');
  await t.stop();
});

// ---------------------------------------------------------------- entities

test('entity objects: players change their own, version checks work', async () => {
  const t = await start();
  const a = await t.player('amy');
  const b = await t.player('ben');
  const set = await t.ok('/Object/SetObjects', { Entity: a.entityKey, Objects: [{ ObjectName: 'loadout', DataObject: { gun: 'rifle', ammo: 30 } }] }, a.entity);
  assert.deepEqual(set.SetResults, [{ ObjectName: 'loadout', SetResult: 'Created' }]);
  const got = await t.ok('/Object/GetObjects', { Entity: a.entityKey }, a.entity);
  assert.deepEqual(got.Objects.loadout.DataObject, { gun: 'rifle', ammo: 30 });
  const escaped = await t.ok('/Object/GetObjects', { Entity: a.entityKey, EscapeObject: true }, a.entity);
  assert.equal(escaped.Objects.loadout.EscapedDataObject, '{"gun":"rifle","ammo":30}');
  await t.err('/Object/SetObjects', { Entity: a.entityKey, Objects: [{ ObjectName: 'x', DataObject: 1 }] }, b.entity, 'NotAuthorized');
  await t.err('/Object/SetObjects', { Entity: a.entityKey, Objects: [{ ObjectName: 'x', DataObject: 1 }], ExpectedProfileVersion: 0 }, a.entity, 'EntityProfileVersionMismatch');
  const del = await t.ok('/Object/SetObjects', { Entity: a.entityKey, Objects: [{ ObjectName: 'loadout', DeleteObject: true }] }, a.entity);
  assert.equal(del.SetResults[0].SetResult, 'Deleted');
  const prof = await t.ok('/Profile/GetProfile', { Entity: a.entityKey }, a.entity);
  assert.equal(prof.Profile.Lineage.MasterPlayerAccountId, a.id);
  const map = await t.ok('/Profile/GetTitlePlayersFromMasterPlayerAccountIds', { MasterPlayerAccountIds: [a.id, b.id] }, a.entity);
  assert.equal(map.TitlePlayerAccounts[b.id].Id, b.entityKey.Id);
  await t.stop();
});

test('entity files: upload, finalise, download, and only the owner changes them', async () => {
  const t = await start();
  const a = await t.player('fay');
  const b = await t.player('gus');
  const bytes = Buffer.from([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
  const put = (url, body) => fetch(url, { method: 'PUT', body, headers: { 'x-ms-blob-type': 'BlockBlob' } });

  const init = await t.ok('/File/InitiateFileUploads', { Entity: a.entityKey, FileNames: ['save.dat'] }, a.entity);
  const upload = init.UploadDetails[0];
  assert.equal(upload.FileName, 'save.dat');
  assert.ok(upload.UploadUrl.startsWith(`${t.base}/files/`));
  await t.err('/File/InitiateFileUploads', { Entity: a.entityKey, FileNames: ['save.dat'] }, a.entity, 'EntityFileOperationPending');
  await t.err('/File/FinalizeFileUploads', { Entity: a.entityKey, FileNames: ['save.dat'], ProfileVersion: init.ProfileVersion }, a.entity, 'FileNotFound');

  // The game sends the file straight to the address, as it would to Azure.
  let res = await put(upload.UploadUrl, bytes);
  assert.equal(res.status, 201);
  const fin = await t.ok('/File/FinalizeFileUploads', { Entity: a.entityKey, FileNames: ['save.dat'], ProfileVersion: init.ProfileVersion }, a.entity);
  const meta = fin.Metadata['save.dat'];
  assert.equal(meta.Size, bytes.length);
  assert.equal(meta.Checksum, crypto.createHash('md5').update(bytes).digest('base64'));
  assert.equal(fin.ProfileVersion, init.ProfileVersion + 1);
  res = await fetch(meta.DownloadUrl);
  assert.equal(res.status, 200);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
  res = await put(upload.UploadUrl, 'again'); // finalised, so the upload address is used up
  assert.equal(res.status, 404);

  // Others can look, but not change anything.
  assert.deepEqual(Object.keys((await t.ok('/File/GetFiles', { Entity: a.entityKey }, b.entity)).Metadata), ['save.dat']);
  await t.err('/File/InitiateFileUploads', { Entity: a.entityKey, FileNames: ['x'] }, b.entity, 'NotAuthorized');
  await t.err('/File/DeleteFiles', { Entity: a.entityKey, FileNames: ['save.dat'] }, b.entity, 'NotAuthorized');

  // Changed addresses don't work, and a download address can't upload.
  const token = meta.DownloadUrl.slice(meta.DownloadUrl.lastIndexOf('/') + 1);
  const [payload, sig] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const forged = Buffer.from(JSON.stringify({ ...claims, x: claims.x + 1 })).toString('base64url');
  assert.equal((await fetch(`${t.base}/files/${forged}.${sig}`)).status, 403);
  assert.equal((await put(meta.DownloadUrl, 'x')).status, 403);
  assert.equal((await put(`${upload.UploadUrl}?comp=block&blockid=AAAA`, 'x')).status, 501);

  // Stopping one upload, replacing a file, and deleting it.
  const again = await t.ok('/File/InitiateFileUploads', { Entity: a.entityKey, FileNames: ['save.dat', 'other.txt'] }, a.entity);
  await t.ok('/File/AbortFileUploads', { Entity: a.entityKey, FileNames: ['other.txt'] }, a.entity);
  await t.err('/File/AbortFileUploads', { Entity: a.entityKey, FileNames: ['other.txt'] }, a.entity, 'NoEntityFileOperationPending');
  assert.equal((await put(again.UploadDetails[0].UploadUrl, 'new save')).status, 201);
  const fin2 = await t.ok('/File/FinalizeFileUploads', { Entity: a.entityKey, FileNames: ['save.dat'], ProfileVersion: 0 }, a.entity);
  assert.equal(await (await fetch(fin2.Metadata['save.dat'].DownloadUrl)).text(), 'new save');
  assert.equal((await fetch(meta.DownloadUrl)).status, 404); // the old copy is gone
  await t.err('/File/FinalizeFileUploads', { Entity: a.entityKey, FileNames: ['save.dat'], ProfileVersion: 0 }, a.entity, 'NoEntityFileOperationPending');
  await t.err('/File/DeleteFiles', { Entity: a.entityKey, FileNames: ['save.dat'], ProfileVersion: 0 }, a.entity, 'EntityProfileVersionMismatch');
  await t.ok('/File/DeleteFiles', { Entity: a.entityKey, FileNames: ['save.dat'] }, a.entity);
  await t.err('/File/DeleteFiles', { Entity: a.entityKey, FileNames: ['save.dat'] }, a.entity, 'FileNotFound');
  assert.deepEqual((await t.ok('/File/GetFiles', { Entity: a.entityKey }, a.entity)).Metadata, {});

  // The title's files are for the game itself to change.
  const tt = await t.ok('/Authentication/GetEntityToken', {}, t.secret);
  const title = { 'X-EntityToken': tt.EntityToken };
  const ti = await t.ok('/File/InitiateFileUploads', { Entity: tt.Entity, FileNames: ['levels.json'] }, title);
  assert.equal((await put(ti.UploadDetails[0].UploadUrl, '[1,2,3]')).status, 201);
  await t.ok('/File/FinalizeFileUploads', { Entity: tt.Entity, FileNames: ['levels.json'], ProfileVersion: ti.ProfileVersion }, title);
  const tf = await t.ok('/File/GetFiles', { Entity: tt.Entity }, a.entity);
  assert.equal(await (await fetch(tf.Metadata['levels.json'].DownloadUrl)).text(), '[1,2,3]');
  await t.err('/File/DeleteFiles', { Entity: tt.Entity, FileNames: ['levels.json'] }, a.entity, 'NotAuthorized');

  // Deleting a player deletes their files.
  const bi = await t.ok('/File/InitiateFileUploads', { Entity: b.entityKey, FileNames: ['b.sav'] }, b.entity);
  await put(bi.UploadDetails[0].UploadUrl, 'gus was here');
  const bf = await t.ok('/File/FinalizeFileUploads', { Entity: b.entityKey, FileNames: ['b.sav'], ProfileVersion: bi.ProfileVersion }, b.entity);
  await t.ok('/Server/DeletePlayer', { PlayFabId: b.id }, t.secret);
  assert.equal((await fetch(bf.Metadata['b.sav'].DownloadUrl)).status, 404);

  // An upload left unfinished is forgotten after an hour; download addresses last a day.
  await t.ok('/File/InitiateFileUploads', { Entity: a.entityKey, FileNames: ['left.dat'] }, a.entity);
  t.clock.now = new Date(t.clock.now.getTime() + 61 * 60 * 1000);
  await t.ok('/File/InitiateFileUploads', { Entity: a.entityKey, FileNames: ['left.dat'] }, a.entity);
  t.clock.now = new Date(t.clock.now.getTime() + 25 * 60 * 60 * 1000);
  assert.equal((await fetch(tf.Metadata['levels.json'].DownloadUrl)).status, 403);
  await t.stop();
});

test("https: Keep Playing's own certificate works, and only for this computer", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-tls-'));
  const now = new Date('2026-11-27T10:00:00Z');
  const first = tlsCert.loadOrCreate(dir, now);
  assert.equal(first.made, true);
  assert.equal(tlsCert.loadOrCreate(dir, now).made, false); // kept for next time
  const x = new crypto.X509Certificate(first.cert);
  assert.equal(x.ca, false); // it can't vouch for any other website
  assert.equal(x.subjectAltName, 'DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1');
  assert.ok(x.verify(x.publicKey));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'keep-playing.key')).mode & 0o777, 0o600);
  const renewed = tlsCert.loadOrCreate(dir, new Date(Date.parse(x.validTo) - 10 * 24 * 60 * 60 * 1000));
  assert.equal(renewed.made, true); // under a month left

  // A game that trusts it signs in over https, and the file addresses it's given are https too.
  // (TLS checks dates by the real clock, so this one is made now.)
  const live = tlsCert.makeCertificate();
  const app = createApp({ now: () => now, titleDir: EXAMPLE });
  const server = https.createServer({ cert: live.cert, key: live.key }, (req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const post = (host, url, body, headers = {}, ca = live.cert) => new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request({ host: '127.0.0.1', port: server.address().port, path: url, method: 'POST', ca, servername: host === '127.0.0.1' ? undefined : host,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, Host: `${host}:${server.address().port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', (e) => resolve({ error: e.code }));
    req.end(payload);
  });
  const login = await post('localhost', '/Client/LoginWithCustomID', { TitleId: '1A2B3', CustomId: 'secure', CreateAccount: true });
  assert.equal(login.status, 200, JSON.stringify(login));
  const entity = { 'X-EntityToken': login.json.data.EntityToken.EntityToken };
  const up = await post('127.0.0.1', '/File/InitiateFileUploads', { Entity: login.json.data.EntityToken.Entity, FileNames: ['a.sav'] }, entity);
  assert.match(up.json.data.UploadDetails[0].UploadUrl, /^https:\/\/127\.0\.0\.1:\d+\/files\//);
  assert.equal((await post('localhost', '/Client/GetTime', {}, {}, null)).error, 'DEPTH_ZERO_SELF_SIGNED_CERT'); // not trusted: refused
  server.close();
  app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('groups: roles, applications, invitations, blocks and members', async () => {
  const t = await start();
  const [ana, ben, cat, dan, eve] = [await t.player('ana'), await t.player('ben'), await t.player('cat'), await t.player('dan'), await t.player('eve')];
  const tt = await t.ok('/Authentication/GetEntityToken', {}, t.secret);
  const title = { 'X-EntityToken': tt.EntityToken };
  const isMember = async (who, roleId) => (await t.ok('/Group/IsMember', { Group: G, Entity: who.entityKey, RoleId: roleId }, ana.entity)).IsMember;

  const made = await t.ok('/Group/CreateGroup', { GroupName: 'Night Owls' }, ana.entity);
  const G = made.Group;
  assert.deepEqual([made.AdminRoleId, made.MemberRoleId, made.Roles], ['admins', 'members', { admins: 'Administrators', members: 'Members' }]);
  await t.err('/Group/CreateGroup', { GroupName: 'night owls' }, ben.entity, 'GroupNameNotAvailable');
  assert.equal((await t.ok('/Group/GetGroup', { GroupName: 'Night Owls' }, ben.entity)).Group.Id, G.Id);

  // Applying, and an admin accepting. Applying twice gives the same application.
  const applied = await t.ok('/Group/ApplyToGroup', { Group: G }, ben.entity);
  assert.deepEqual([applied.Entity.Key.Id, applied.Entity.Lineage.master_player_account.Id], [ben.entityKey.Id, ben.id]);
  assert.equal((await t.ok('/Group/ApplyToGroup', { Group: G }, ben.entity)).Expires, applied.Expires);
  await t.err('/Group/AcceptGroupApplication', { Group: G, Entity: ben.entityKey }, cat.entity, 'NotAuthorized');
  assert.equal((await t.ok('/Group/ListGroupApplications', { Group: G }, ana.entity)).Applications.length, 1);
  await t.ok('/Group/AcceptGroupApplication', { Group: G, Entity: ben.entityKey }, ana.entity);
  assert.equal(await isMember(ben), true);
  await t.err('/Group/ApplyToGroup', { Group: G }, ben.entity, 'EntityIsAlreadyMember');

  // Roles, and an invitation into one.
  assert.equal((await t.ok('/Group/CreateRole', { Group: G, RoleId: 'officers', RoleName: 'Officers' }, ana.entity)).RoleId, 'officers');
  await t.err('/Group/CreateRole', { Group: G, RoleId: 'officers', RoleName: 'Other' }, ana.entity, 'DuplicateRoleId');
  await t.err('/Group/CreateRole', { Group: G, RoleId: 'x', RoleName: 'OFFICERS' }, ana.entity, 'RoleNameNotAvailable');
  await t.err('/Group/CreateRole', { Group: G, RoleId: 'bad id!', RoleName: 'Bad' }, ana.entity, 'InvalidParams');
  await t.err('/Group/CreateRole', { Group: G, RoleId: 'nope', RoleName: 'Nope' }, ben.entity, 'NotAuthorized');
  const inv = await t.ok('/Group/InviteToGroup', { Group: G, Entity: cat.entityKey, RoleId: 'officers' }, ana.entity);
  assert.deepEqual([inv.InvitedByEntity.Key.Id, inv.InvitedEntity.Key.Id, inv.RoleId], [ana.entityKey.Id, cat.entityKey.Id, 'officers']);
  assert.equal((await t.ok('/Group/ListMembershipOpportunities', {}, cat.entity)).Invitations.length, 1);
  assert.deepEqual((await t.ok('/Group/ListMembershipOpportunities', { Entity: cat.entityKey }, ben.entity)).Invitations, []);
  assert.equal((await t.ok('/Group/ListGroupInvitations', { Group: G }, ana.entity)).Invitations.length, 1);
  await t.err('/Group/AcceptGroupInvitation', { Group: G, Entity: cat.entityKey }, ben.entity, 'NotAuthorized');
  await t.ok('/Group/AcceptGroupInvitation', { Group: G }, cat.entity);
  assert.equal(await isMember(cat, 'officers'), true);

  // Applying while invited joins instead, and says so.
  await t.ok('/Group/InviteToGroup', { Group: G, Entity: dan.entityKey }, ana.entity);
  await t.err('/Group/ApplyToGroup', { Group: G }, dan.entity, 'OutstandingInvitationAcceptedInstead');
  assert.equal(await isMember(dan), true);

  // Members and their roles.
  const list = await t.ok('/Group/ListGroupMembers', { Group: G }, eve.entity);
  assert.deepEqual(list.Members.map((r) => [r.RoleId, r.Members.length]), [['admins', 1], ['members', 2], ['officers', 1]]);
  await t.ok('/Group/ChangeMemberRole', { Group: G, Members: [ben.entityKey], OriginRoleId: 'members', DestinationRoleId: 'officers' }, ana.entity);
  await t.err('/Group/ChangeMemberRole', { Group: G, Members: [ben.entityKey], OriginRoleId: 'members' }, ana.entity, 'EntityIsNotAMember');
  await t.ok('/Group/AddMembers', { Group: G, Members: [ben.entityKey], RoleId: 'admins' }, ana.entity);
  const ms = await t.ok('/Group/ListMembership', { Entity: ben.entityKey }, cat.entity);
  assert.deepEqual(ms.Groups[0].Roles.map((r) => r.RoleId).sort(), ['admins', 'officers']);

  // Only the game's server adds someone who isn't in the group; anyone can leave.
  await t.err('/Group/AddMembers', { Group: G, Members: [eve.entityKey] }, ana.entity, 'NotAuthorized');
  await t.ok('/Group/AddMembers', { Group: G, Members: [eve.entityKey] }, title);
  await t.ok('/Group/RemoveMembers', { Group: G, Members: [eve.entityKey] }, eve.entity);
  await t.err('/Group/RemoveMembers', { Group: G, Members: [ana.entityKey] }, dan.entity, 'NotAuthorized');
  await t.ok('/Group/RemoveMembers', { Group: G, Members: [dan.entityKey] }, ana.entity);
  assert.equal(await isMember(dan), false);

  // Blocks.
  await t.ok('/Group/BlockEntity', { Group: G, Entity: dan.entityKey }, ana.entity);
  await t.err('/Group/ApplyToGroup', { Group: G }, dan.entity, 'EntityBlockedByGroup');
  await t.err('/Group/InviteToGroup', { Group: G, Entity: dan.entityKey }, ana.entity, 'EntityBlockedByGroup');
  assert.equal((await t.ok('/Group/ListGroupBlocks', { Group: G }, ana.entity)).BlockedEntities.length, 1);
  await t.ok('/Group/UnblockEntity', { Group: G, Entity: dan.entityKey }, ana.entity);

  // Withdrawing an application, taking back an invitation, and being invited after applying.
  await t.ok('/Group/ApplyToGroup', { Group: G }, dan.entity);
  await t.ok('/Group/RemoveGroupApplication', { Group: G, Entity: dan.entityKey }, dan.entity);
  await t.err('/Group/RemoveGroupApplication', { Group: G, Entity: dan.entityKey }, ana.entity, 'GroupApplicationNotFound');
  await t.ok('/Group/InviteToGroup', { Group: G, Entity: dan.entityKey }, ana.entity);
  await t.ok('/Group/RemoveGroupInvitation', { Group: G, Entity: dan.entityKey }, ana.entity);
  await t.err('/Group/AcceptGroupInvitation', { Group: G }, dan.entity, 'GroupInvitationNotFound');
  await t.ok('/Group/ApplyToGroup', { Group: G }, dan.entity);
  await t.err('/Group/InviteToGroup', { Group: G, Entity: dan.entityKey }, ana.entity, 'OutstandingApplicationAcceptedInstead');
  assert.equal(await isMember(dan), true);

  // Changing the group and its roles. An out-of-date version changes nothing.
  const before = await t.ok('/Group/GetGroup', { Group: G }, ana.entity);
  const renamed = await t.ok('/Group/UpdateGroup', { Group: G, GroupName: 'Night Hawks', ExpectedProfileVersion: before.ProfileVersion }, ana.entity);
  assert.deepEqual([renamed.SetResult, renamed.ProfileVersion], ['Updated', before.ProfileVersion + 1]);
  assert.equal((await t.ok('/Group/UpdateGroup', { Group: G, GroupName: 'X', ExpectedProfileVersion: before.ProfileVersion }, ana.entity)).SetResult, 'None');
  await t.err('/Group/UpdateGroup', { Group: G, AdminRoleId: 'officers' }, ana.entity, 'NotAuthorized');
  assert.equal((await t.ok('/Group/UpdateRole', { Group: G, RoleId: 'officers', RoleName: 'Captains' }, ana.entity)).SetResult, 'Updated');
  await t.err('/Group/DeleteRole', { Group: G, RoleId: 'admins' }, ana.entity, 'RoleIsGroupAdmin');
  await t.err('/Group/DeleteRole', { Group: G, RoleId: 'members' }, ana.entity, 'RoleIsGroupDefaultMember');
  await t.err('/Group/DeleteRole', { Group: G, RoleId: 'nope' }, ana.entity, 'RoleDoesNotExist');
  await t.ok('/Group/DeleteRole', { Group: G, RoleId: 'officers' }, ana.entity);
  assert.deepEqual([await isMember(cat), await isMember(ben)], [false, true]); // cat was only an officer

  // A group's objects: anyone can read them; only its admins can change them.
  await t.ok('/Object/SetObjects', { Entity: G, Objects: [{ ObjectName: 'motto', DataObject: { text: 'Hoot' } }] }, ana.entity);
  await t.err('/Object/SetObjects', { Entity: G, Objects: [{ ObjectName: 'motto', DataObject: 'x' }] }, dan.entity, 'NotAuthorized');
  assert.equal((await t.ok('/Object/GetObjects', { Entity: G }, cat.entity)).Objects.motto.DataObject.text, 'Hoot');

  // A deleted player leaves their groups; only admins delete a group.
  await t.ok('/Server/DeletePlayer', { PlayFabId: ben.id }, t.secret);
  const after = await t.ok('/Group/ListGroupMembers', { Group: G }, ana.entity);
  assert.deepEqual(after.Members.map((r) => [r.RoleId, r.Members.map((m) => m.Key.Id)]), [['admins', [ana.entityKey.Id]], ['members', [dan.entityKey.Id]]]);
  await t.err('/Group/DeleteGroup', { Group: G }, dan.entity, 'NotAuthorized');
  await t.ok('/Group/DeleteGroup', { Group: G }, ana.entity);
  await t.err('/Group/GetGroup', { Group: G }, ana.entity, 'ProfileDoesNotExist');

  // Invitations run out after a week.
  const later = await t.ok('/Group/CreateGroup', { GroupName: 'Later' }, title);
  await t.ok('/Group/InviteToGroup', { Group: later.Group, Entity: dan.entityKey }, title);
  t.clock.now = new Date(t.clock.now.getTime() + 8 * 24 * 60 * 60 * 1000);
  const fresh = { 'X-EntityToken': (await t.ok('/Authentication/GetEntityToken', {}, t.secret)).EntityToken };
  assert.deepEqual((await t.ok('/Group/ListGroupInvitations', { Group: later.Group }, fresh)).Invitations, []);
  await t.stop();
});

test('shared groups: members share data, others see only what\'s public', async () => {
  const t = await start();
  const a = await t.player('sg-a');
  const b = await t.player('sg-b');
  const c = await t.player('sg-c');
  const made = await t.ok('/Client/CreateSharedGroup', { SharedGroupId: 'base-42' }, a.auth);
  assert.equal(made.SharedGroupId, 'base-42');
  await t.err('/Client/CreateSharedGroup', { SharedGroupId: 'base-42' }, b.auth, 'InvalidSharedGroupId');
  await t.ok('/Client/UpdateSharedGroupData', { SharedGroupId: 'base-42', Data: { walls: '3', plan: 'secret' } }, a.auth);
  await t.ok('/Client/UpdateSharedGroupData', { SharedGroupId: 'base-42', Data: { banner: 'red' }, Permission: 'Public' }, a.auth);
  await t.err('/Client/UpdateSharedGroupData', { SharedGroupId: 'base-42', Data: { walls: '0' } }, b.auth, 'NotAuthorized');
  const outside = await t.ok('/Client/GetSharedGroupData', { SharedGroupId: 'base-42', GetMembers: true }, b.auth);
  assert.deepEqual(Object.keys(outside.Data), ['banner']);
  assert.deepEqual(outside.Members, [a.id]);
  await t.ok('/Client/AddSharedGroupMembers', { SharedGroupId: 'base-42', PlayFabIds: [b.id] }, a.auth);
  const inside = await t.ok('/Client/GetSharedGroupData', { SharedGroupId: 'base-42', Keys: ['walls', 'plan'] }, b.auth);
  assert.equal(inside.Data.walls.Value, '3');
  assert.equal(inside.Data.walls.LastUpdatedBy, a.id);
  await t.ok('/Client/UpdateSharedGroupData', { SharedGroupId: 'base-42', KeysToRemove: ['plan'] }, b.auth);
  await t.err('/Client/AddSharedGroupMembers', { SharedGroupId: 'base-42', PlayFabIds: [c.id] }, c.auth, 'NotAuthorized');
  // When the last member leaves, the group goes.
  await t.ok('/Client/RemoveSharedGroupMembers', { SharedGroupId: 'base-42', PlayFabIds: [a.id, b.id] }, a.auth);
  await t.err('/Client/GetSharedGroupData', { SharedGroupId: 'base-42' }, a.auth, 'InvalidSharedGroupId');
  // The server can run groups that have no members.
  const s = await t.ok('/Server/CreateSharedGroup', {}, t.secret);
  assert.match(s.SharedGroupId, /^[0-9A-F]{16}$/);
  await t.ok('/Server/UpdateSharedGroupData', { SharedGroupId: s.SharedGroupId, Data: { round: '1' } }, t.secret);
  await t.ok('/Server/AddSharedGroupMembers', { SharedGroupId: s.SharedGroupId, PlayFabIds: [c.id] }, t.secret);
  assert.equal((await t.ok('/Server/GetSharedGroupData', { SharedGroupId: s.SharedGroupId, GetMembers: true }, t.secret)).Members[0], c.id);
  await t.ok('/Server/RemoveSharedGroupMembers', { SharedGroupId: s.SharedGroupId, PlayFabIds: [] }, t.secret);
  await t.ok('/Server/DeleteSharedGroup', { SharedGroupId: s.SharedGroupId }, t.secret);
  await t.err('/Server/GetSharedGroupData', { SharedGroupId: s.SharedGroupId }, t.secret, 'InvalidSharedGroupId');
  await t.stop();
});

// ---------------------------------------------------------------- friends, events, odds and ends

test('friends and friend leaderboards', async () => {
  const t = await start();
  const a = await t.player('cal');
  const b = await t.player('dot');
  const c = await t.player('eve');
  await t.ok('/Client/UpdateUserTitleDisplayName', { DisplayName: 'Dotty' }, b.auth);
  await t.ok('/Client/AddFriend', { FriendTitleDisplayName: 'Dotty' }, a.auth);
  await t.err('/Client/AddFriend', { FriendPlayFabId: b.id }, a.auth, 'UsersAlreadyFriends');
  for (const [p, v] of [[a, 10], [b, 20], [c, 30]]) await t.ok('/Client/UpdatePlayerStatistics', { Statistics: [{ StatisticName: 'HighScore', Value: v }] }, p.auth);
  const lb = await t.ok('/Client/GetFriendLeaderboard', { StatisticName: 'HighScore', StartPosition: 0 }, a.auth);
  assert.deepEqual(lb.Leaderboard.map((e) => e.StatValue), [20, 10]);
  const list = await t.ok('/Client/GetFriendsList', {}, a.auth);
  assert.equal(list.Friends[0].TitleDisplayName, 'Dotty');
  await t.ok('/Client/RemoveFriend', { FriendPlayFabId: b.id }, a.auth);
  assert.equal((await t.ok('/Client/GetFriendsList', {}, a.auth)).Friends.length, 0);
  await t.stop();
});

test('events are accepted, and bans stop sign-in', async () => {
  const t = await start();
  const p = await t.player('fay');
  const e = await t.ok('/Client/WritePlayerEvent', { EventName: 'level_complete', Body: { level: 3 } }, p.auth);
  assert.match(e.EventId, /^[0-9a-f]{32}$/);
  const many = await t.ok('/Event/WriteEvents', { Events: [{ EventNamespace: 'custom.game', Name: 'a' }, { EventNamespace: 'custom.game', Name: 'b' }] }, p.entity);
  assert.equal(many.AssignedEventIds.length, 2);
  assert.equal(t.app.events.count, 3);
  await t.ok('/Server/BanUsers', { Bans: [{ PlayFabId: p.id, Reason: 'test', DurationInHours: 1 }] }, t.secret);
  await t.err('/Client/LoginWithCustomID', { TitleId: '1A2B3', CustomId: 'fay' }, {}, 'AccountBanned');
  t.clock.now = new Date(t.clock.now.getTime() + 2 * 3600 * 1000);
  await t.ok('/Client/LoginWithCustomID', { TitleId: '1A2B3', CustomId: 'fay' });
  await t.stop();
});

test('calls Keep Playing can\'t answer yet say so, and are counted', async () => {
  const t = await start();
  const p = await t.player('gus');
  const r = await t.err('/Client/GetPlayerTrades', {}, p.auth, 'NotImplemented');
  assert.match(r.errorMessage, /can't answer \/Client\/GetPlayerTrades yet/);
  assert.equal(r.code, 501);
  const retired = await t.err('/Client/GetCloudScriptUrl', {}, p.auth, 'NotImplemented');
  assert.match(retired.errorMessage, /Microsoft retired/);
  const unknown = await t.raw('POST', '/Client/MadeUpCall', { body: {} });
  assert.equal(unknown.status, 404);
  const status = await t.raw('GET', '/');
  assert.equal(status.json.name, 'Keep Playing');
  assert.equal(status.json.seen['/Client/GetPlayerTrades'].lastError, 'NotImplemented');
  assert.equal(status.json.seen['/Client/GetPlayerTrades'].notAnswered, 1);
  assert.equal(status.json.calls.total, 797);

  // A browser gets a page instead, with a report link that lists what's missing.
  const page = await t.raw('GET', '/', { headers: { Accept: 'text/html,application/xhtml+xml' } });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /^text\/html/);
  assert.match(page.headers['content-security-policy'], /default-src 'none'; style-src 'sha256-/);
  assert.match(page.text, /Example game/);
  assert.match(page.text, /<td class="call">\/Client\/GetPlayerTrades<\/td>/);
  const link = page.text.match(/href="(https:\/\/github\.com\/LifeboatLabs\/keep-playing\/issues\/new\?[^"]+)"/);
  assert.ok(link, 'the page should have a report link');
  const body = new URL(link[1].replace(/&amp;/g, '&')).searchParams.get('body');
  assert.match(body, /- \/Client\/GetPlayerTrades \(1 time\)/);
  assert.match(body, /Game: Example game/);
  await t.stop();
});

test('requests can be gzip-compressed, and browsers are allowed in', async () => {
  const t = await start();
  const r = await t.raw('POST', '/Client/LoginWithCustomID', { body: { TitleId: '1A2B3', CustomId: 'hal', CreateAccount: true }, gzip: true });
  assert.equal(r.json.code, 200);
  const pre = await t.raw('OPTIONS', '/Client/LoginWithCustomID');
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], '*');
  assert.match(pre.headers['access-control-allow-headers'], /X-Authorization/);
  const badJson = await t.raw('POST', '/Client/LoginWithCustomID', { body: '{nope' });
  assert.equal(badJson.json.error, 'InvalidParams');
  await t.stop();
});

// ---------------------------------------------------------------- every answered call, once

test('the checker catches answers that don\'t match the description', () => {
  const problems = spec.check('Client', 'LoginResult', { NewlyCreated: 'yes', Bogus: 1, EntityToken: { Entity: { Type: 'x' } } }, { strict: true });
  assert.ok(problems.some((p) => /NewlyCreated should be true or false/.test(p)));
  assert.ok(problems.some((p) => /Bogus isn't in LoginResult/.test(p)));
  assert.ok(problems.some((p) => /EntityToken\.Entity\.Id is required/.test(p)));
  assert.deepEqual(spec.check('Client', 'UserDataRecord', { LastUpdated: 'not a date', Permission: 'Secret' }), [
    'LastUpdated should be a date',
    'Permission is "Secret", which isn\'t a UserDataPermission',
  ]);
});

test('every call Keep Playing answers gives an answer that matches the description', async () => {
  const t = await start();
  const A = await t.player('smoke-a');
  const B = await t.player('smoke-b');
  const C = await t.player('smoke-c');
  const D = await t.player('smoke-d');
  const E = await t.player('smoke-e');
  t.app.title().settings.allowClientCurrency = true;
  const steam = Buffer.alloc(52);
  steam.writeUInt32LE(20, 0);
  steam.writeBigUInt64LE(76561197960287999n, 12);
  const jwt = (claims) => ['{"alg":"RS256"}', JSON.stringify(claims)].map((x) => Buffer.from(x).toString('base64url')).join('.') + '.sig';
  const titleToken = { 'X-EntityToken': (await t.ok('/Authentication/GetEntityToken', {}, t.secret)).EntityToken };

  await t.ok('/Server/UpdatePlayerStatistics', { PlayFabId: A.id, Statistics: [{ StatisticName: 'HighScore', Value: 50 }] }, t.secret);
  await t.ok('/Server/UpdatePlayerStatistics', { PlayFabId: C.id, Statistics: [{ StatisticName: 'HighScore', Value: 70 }] }, t.secret);
  const items = async (...ids) => (await t.ok('/Server/GrantItemsToUser', { PlayFabId: A.id, ItemIds: ids }, t.secret)).ItemGrantResults;
  const [sword] = await items('sword');
  const [potion] = await items('potion');
  const [crate1, crate2, crate3] = await items('crate', 'crate', 'crate');
  const [key1, key2, key3, key4] = await items('crate_key', 'crate_key', 'crate_key', 'crate_key');
  const all = { ShowAvatarUrl: true, ShowBannedUntil: true, ShowCampaignAttributions: true, ShowContactEmailAddresses: true, ShowCreated: true, ShowDisplayName: true, ShowExperimentVariants: true, ShowLastLogin: true, ShowLinkedAccounts: true, ShowLocations: true, ShowMemberships: true, ShowOrigination: true, ShowPushNotificationRegistrations: true, ShowStatistics: true, ShowTags: true, ShowTotalValueToDateInUsd: true, ShowValuesToDate: true };
  const info = { GetCharacterInventories: true, GetCharacterList: true, GetPlayerProfile: true, GetPlayerStatistics: true, GetTitleData: true, GetUserAccountInfo: true, GetUserData: true, GetUserInventory: true, GetUserReadOnlyData: true, GetUserVirtualCurrency: true, ProfileConstraints: all };

  const steps = [
    ['/Client/LinkAndroidDeviceID', { AndroidDeviceId: 'smoke-droid' }],
    ['/Client/UnlinkAndroidDeviceID', {}],
    ['/Client/LinkIOSDeviceID', { DeviceId: 'smoke-ios' }],
    ['/Client/UnlinkIOSDeviceID', {}],
    ['/Client/LinkSteamAccount', { SteamTicket: steam.toString('hex') }],
    ['/Server/GetPlayFabIDsFromSteamIDs', { SteamStringIDs: ['76561197960287999'] }],
    ['/Client/UnlinkSteamAccount', {}],
    ['/Server/LinkServerCustomId', { PlayFabId: A.id, ServerCustomId: 'smoke-server' }],
    ['/Server/GetPlayFabIDsFromServerCustomIDs', { ServerCustomIds: ['smoke-server'] }],
    ['/Server/GetServerCustomIDsFromPlayFabIDs', { PlayFabIDs: [A.id] }],
    ['/Server/UnlinkServerCustomId', { PlayFabId: A.id, ServerCustomId: 'smoke-server' }],
    ['/Server/GetUserAccountInfo', { PlayFabId: A.id }],
    ['/Admin/GetUserAccountInfo', { PlayFabId: A.id }],
    ['/Client/AddOrUpdateContactEmail', { EmailAddress: 'smoke@example.com' }],
    ['/Server/AddOrUpdateContactEmail', { PlayFabId: A.id, EmailAddress: 'smoke@example.com' }],
    ['/Client/UpdateAvatarUrl', { ImageUrl: 'https://example.com/a.png' }],
    ['/Server/UpdateAvatarUrl', { PlayFabId: A.id, ImageUrl: 'https://example.com/b.png' }],
    ['/Server/AddPlayerTag', { PlayFabId: A.id, TagName: 'vip' }],
    ['/Admin/AddPlayerTag', { PlayFabId: A.id, TagName: 'tester' }],
    ['/Client/GetPlayerProfile', { ProfileConstraints: all }],
    ['/Server/GetPlayerProfile', { PlayFabId: A.id, ProfileConstraints: all }],
    ['/Admin/GetPlayerProfile', { PlayFabId: A.id }],
    ['/Client/GetPlayerCombinedInfo', { InfoRequestParameters: info }],
    ['/Server/GetPlayerCombinedInfo', { PlayFabId: A.id, InfoRequestParameters: info }],
    ['/Client/GetPlayerTags', { PlayFabId: A.id }],
    ['/Server/GetPlayerTags', { PlayFabId: A.id, Namespace: 'title.1A2B3' }],
    ['/Admin/GetPlayerTags', { PlayFabId: A.id }],
    ['/Server/RemovePlayerTag', { PlayFabId: A.id, TagName: 'vip' }],
    ['/Admin/RemovePlayerTag', { PlayFabId: A.id, TagName: 'tester' }],
    ['/Client/RemoveContactEmail', {}],
    ['/Admin/UpdateUserTitleDisplayName', { PlayFabId: A.id, DisplayName: 'Smokey' }],
    ['/Client/GetTime', {}],
    ['/Server/GetTime', {}],
    ['/Admin/AddNews', { Title: 'Patch', Body: 'Notes' }],
    ['/Client/GetTitleNews', {}],
    ['/Server/GetTitleNews', { Count: 5 }],
    ['/Server/AddFriend', { PlayFabId: A.id, FriendPlayFabId: C.id }],
    ['/Client/SetFriendTags', { FriendPlayFabId: C.id, Tags: ['raid'] }],
    ['/Server/SetFriendTags', { PlayFabId: A.id, FriendPlayFabId: C.id, Tags: ['raid', 'pvp'] }],
    ['/Server/GetFriendsList', { PlayFabId: A.id, ProfileConstraints: all }],
    ['/Server/GetFriendLeaderboard', { PlayFabId: A.id, StatisticName: 'HighScore', StartPosition: 0, MaxResultsCount: 5 }],
    ['/Client/GetFriendLeaderboardAroundPlayer', { StatisticName: 'HighScore', MaxResultsCount: 5 }],
    ['/Server/RemoveFriend', { PlayFabId: A.id, FriendPlayFabId: C.id }],
    ['/Admin/BanUsers', { Bans: [{ PlayFabId: B.id, DurationInHours: 1, Reason: 'smoke' }] }],
    ['/Server/GetUserBans', { PlayFabId: B.id }],
    ['/Admin/GetUserBans', { PlayFabId: B.id }],
    ['/Server/RevokeAllBansForUser', { PlayFabId: B.id }],
    ['/Admin/RevokeAllBansForUser', { PlayFabId: B.id }],
    ['/Client/UpdateUserPublisherData', { Data: { shared: '1' } }],
    ['/Client/GetUserPublisherData', {}],
    ['/Client/GetUserPublisherReadOnlyData', {}],
    ['/Client/GetPublisherData', { Keys: ['studio'] }],
    ['/Server/GetTitleData', {}],
    ['/Server/SetTitleInternalData', { Key: 'secretSauce', Value: '42' }],
    ['/Server/GetTitleInternalData', {}],
    ['/Server/SetPublisherData', { Key: 'studio', Value: 'Example' }],
    ['/Server/GetPublisherData', { Keys: ['studio'] }],
    ['/Admin/GetTitleData', { Keys: ['motd'] }],
    ['/Admin/SetTitleInternalData', { Key: 'more', Value: 'x' }],
    ['/Admin/GetTitleInternalData', {}],
    ['/Admin/SetPublisherData', { Key: 'studio2', Value: 'y' }],
    ['/Admin/GetPublisherData', { Keys: ['studio2'] }],
    ['/Server/GetLeaderboard', { StatisticName: 'HighScore', StartPosition: 0, MaxResultsCount: 5 }],
    ['/Server/GetLeaderboardAroundUser', { PlayFabId: A.id, StatisticName: 'HighScore', MaxResultsCount: 5 }],
    ['/Server/GetPlayerStatistics', { PlayFabId: A.id }],
    ['/Server/GetPlayerStatisticVersions', { StatisticName: 'HighScore' }],
    ['/Admin/CreatePlayerStatisticDefinition', { StatisticName: 'Coins', AggregationMethod: 'Sum' }],
    ['/Admin/UpdatePlayerStatisticDefinition', { StatisticName: 'Coins', VersionChangeInterval: 'Day' }],
    ['/Admin/GetPlayerStatisticDefinitions', {}],
    ['/Admin/IncrementPlayerStatisticVersion', { StatisticName: 'Coins' }],
    ['/Admin/GetPlayerStatisticVersions', { StatisticName: 'Coins' }],
    ['/Server/GetCatalogItems', {}],
    ['/Server/GetStoreItems', { StoreId: 'weekend_sale' }],
    ['/Admin/GetStoreItems', { StoreId: 'weekend_sale' }],
    ['/Server/GetUserInventory', { PlayFabId: A.id }],
    ['/Admin/GetUserInventory', { PlayFabId: A.id }],
    ['/Client/AddUserVirtualCurrency', { VirtualCurrency: 'GO', Amount: 5 }],
    ['/Client/SubtractUserVirtualCurrency', { VirtualCurrency: 'GO', Amount: 5 }],
    ['/Server/SubtractUserVirtualCurrency', { PlayFabId: A.id, VirtualCurrency: 'GO', Amount: 1 }],
    ['/Admin/AddUserVirtualCurrency', { PlayFabId: A.id, VirtualCurrency: 'GO', Amount: 2 }],
    ['/Admin/SubtractUserVirtualCurrency', { PlayFabId: A.id, VirtualCurrency: 'GO', Amount: 2 }],
    ['/Server/ConsumeItem', { PlayFabId: A.id, ItemInstanceId: potion.ItemInstanceId, ConsumeCount: 0 }, 'InvalidParams'],
    ['/Server/ModifyItemUses', { PlayFabId: A.id, ItemInstanceId: potion.ItemInstanceId, UsesToAdd: 2 }],
    ['/Server/ConsumeItem', { PlayFabId: A.id, ItemInstanceId: potion.ItemInstanceId, ConsumeCount: 1 }],
    ['/Server/UpdateUserInventoryItemCustomData', { PlayFabId: A.id, ItemInstanceId: sword.ItemInstanceId, Data: { colour: 'red' } }],
    ['/Server/UnlockContainerItem', { PlayFabId: A.id, ContainerItemId: 'crate' }],
    ['/Client/UnlockContainerInstance', { ContainerItemInstanceId: crate2.ItemInstanceId, KeyItemInstanceId: key2.ItemInstanceId }],
    ['/Server/UnlockContainerInstance', { PlayFabId: A.id, ContainerItemInstanceId: crate3.ItemInstanceId, KeyItemInstanceId: key3.ItemInstanceId }],
    ['/Server/RevokeInventoryItem', { PlayFabId: A.id, ItemInstanceId: sword.ItemInstanceId }],
    ['/Server/RevokeInventoryItems', { Items: [{ PlayFabId: A.id, ItemInstanceId: 'NOPE' }] }],
    ['/Admin/RevokeInventoryItem', { PlayFabId: A.id, ItemInstanceId: key4.ItemInstanceId }],
    ['/Admin/RevokeInventoryItems', { Items: [] }],
    ['/Admin/SetStoreItems', { StoreId: 'flash', Store: [{ ItemId: 'sword', VirtualCurrencyPrices: { GO: 1 } }] }],
    ['/Admin/UpdateStoreItems', { StoreId: 'flash', Store: [{ ItemId: 'potion', VirtualCurrencyPrices: { GO: 1 } }] }],
    ['/Admin/DeleteStore', { StoreId: 'flash' }],
    ['/Admin/ListVirtualCurrencyTypes', {}],
    ['/Server/ExecuteCloudScript', { PlayFabId: A.id, FunctionName: 'helloWorld' }],
    ['/CloudScript/ExecuteEntityCloudScript', { FunctionName: 'helloWorld' }],
    ['/Admin/GetCloudScriptRevision', {}],
    ['/Client/WriteTitleEvent', { EventName: 'smoke' }],
    ['/Client/WriteCharacterEvent', { EventName: 'smoke', CharacterId: 'c1' }],
    ['/Server/WritePlayerEvent', { PlayFabId: A.id, EventName: 'smoke' }],
    ['/Server/WriteTitleEvent', { EventName: 'smoke' }],
    ['/Server/WriteCharacterEvent', { PlayFabId: A.id, CharacterId: 'c1', EventName: 'smoke' }],
    ['/Event/WriteTelemetryEvents', { Events: [{ EventNamespace: 'custom.smoke', Name: 'tick' }] }],
    ['/Client/ReportDeviceInfo', { Info: { os: 'Windows 11' } }],
    ['/Client/AttributeInstall', {}],
    ['/Profile/GetProfiles', { Entities: [A.entityKey, B.entityKey] }],
    ['/Profile/SetProfileLanguage', { Entity: A.entityKey, Language: 'en-GB' }],
    ['/Profile/SetDisplayName', { Entity: A.entityKey, DisplayName: 'Smoke Entity' }],
    ['/Profile/GetProfile', { Entity: { Id: '1A2B3', Type: 'title' } }, null, titleToken],
    ['/Client/GetAllUsersCharacters', {}],
    ['/Server/GetAllUsersCharacters', { PlayFabId: A.id }],
    ['/Server/DeletePlayer', { PlayFabId: D.id }],
    ['/Admin/DeletePlayer', { PlayFabId: E.id }],
    ['/Admin/RemoveVirtualCurrencyTypes', { VirtualCurrencies: [{ CurrencyCode: 'GE' }] }],
    // Other sign-in kinds: link, look up, unlink.
    ['/Client/LinkApple', { IdentityToken: jwt({ sub: 'smoke-apple' }) }],
    ['/Client/UnlinkApple', {}],
    ['/Client/LinkApple', { IdentityToken: jwt({ sub: 'smoke-apple' }) }],
    ['/Server/UnlinkApple', { PlayFabId: A.id }],
    ['/Client/LinkGameCenterAccount', { GameCenterId: 'smoke-gc' }],
    ['/Client/UnlinkGameCenterAccount', {}],
    ['/Client/LinkKongregate', { KongregateId: 'smoke-kong', AuthTicket: 't' }],
    ['/Client/UnlinkKongregate', {}],
    ['/Server/LinkNintendoSwitchDeviceId', { PlayFabId: A.id, NintendoSwitchDeviceId: 'smoke-switch' }],
    ['/Client/GetPlayFabIDsFromNintendoSwitchDeviceIds', { NintendoSwitchDeviceIds: ['smoke-switch'] }],
    ['/Client/UnlinkNintendoSwitchDeviceId', {}],
    ['/Client/LinkNintendoSwitchDeviceId', { NintendoSwitchDeviceId: 'smoke-switch' }],
    ['/Server/UnlinkNintendoSwitchDeviceId', { PlayFabId: A.id }],
    ['/Server/LinkNintendoServiceAccount', { PlayFabId: A.id, IdentityToken: jwt({ sub: 'smoke-na' }) }],
    ['/Client/GetPlayFabIDsFromNintendoServiceAccountIds', { NintendoAccountIds: ['smoke-na'] }],
    ['/Client/UnlinkNintendoServiceAccount', {}],
    ['/Server/LoginWithNintendoServiceAccount', { IdentityToken: jwt({ sub: 'smoke-na-2' }), CreateAccount: true }],
    ['/Client/LinkFacebookInstantGamesId', { FacebookInstantGamesSignature: `s.${Buffer.from('{"player_id":"smoke-fb"}').toString('base64url')}` }],
    ['/Client/GetPlayFabIDsFromFacebookInstantGamesIds', { FacebookInstantGamesIds: ['smoke-fb'] }],
    ['/Client/UnlinkFacebookInstantGamesId', {}],
    ['/Client/LinkFacebookInstantGamesId', { FacebookInstantGamesSignature: `s.${Buffer.from('{"player_id":"smoke-fb"}').toString('base64url')}` }],
    ['/Server/UnlinkFacebookInstantGamesId', { PlayFabId: A.id }],
    ['/Server/LinkBattleNetAccount', { PlayFabId: A.id, IdentityToken: jwt({ sub: 'smoke-bnet' }) }],
    ['/Client/GetPlayFabIDsFromBattleNetAccountIds', { BattleNetAccountIds: ['smoke-bnet'] }],
    ['/Client/UnlinkBattleNetAccount', {}],
    ['/Client/LinkBattleNetAccount', { IdentityToken: jwt({ sub: 'smoke-bnet' }) }],
    ['/Server/UnlinkBattleNetAccount', { PlayFabId: A.id }],
    ['/Client/GetPlayFabIDsFromOpenIdSubjectIdentifiers', { OpenIdSubjectIdentifiers: [{ Issuer: 'https://x', Subject: 'y' }] }],
    ['/Server/AddGenericID', { PlayFabId: A.id, GenericId: { ServiceName: 'Smoke', UserId: 'u1' } }],
    ['/Client/GetPlayFabIDsFromGenericIDs', { GenericIDs: [{ ServiceName: 'Smoke', UserId: 'u1' }] }],
    ['/Server/RemoveGenericID', { PlayFabId: A.id, GenericId: { ServiceName: 'Smoke', UserId: 'u1' } }],
    // Custom properties and segments, from every side.
    ['/Server/UpdatePlayerCustomProperties', { PlayFabId: A.id, Properties: [{ Name: 'a', Value: 'x' }] }],
    ['/Admin/UpdatePlayerCustomProperties', { PlayFabId: A.id, Properties: [{ Name: 'b', Value: true }] }],
    ['/Server/GetPlayerCustomProperty', { PlayFabId: A.id, PropertyName: 'a' }],
    ['/Admin/GetPlayerCustomProperty', { PlayFabId: A.id, PropertyName: 'b' }],
    ['/Client/ListPlayerCustomProperties', {}],
    ['/Admin/ListPlayerCustomProperties', { PlayFabId: A.id }],
    ['/Client/DeletePlayerCustomProperties', { PropertyNames: ['a'] }],
    ['/Server/DeletePlayerCustomProperties', { PlayFabId: A.id, PropertyNames: ['b'] }],
    ['/Server/GetPlayerSegments', { PlayFabId: A.id }],
    ['/Admin/GetPlayerSegments', { PlayFabId: A.id }],
  ];
  // The user data calls, every kind, for Server and Admin.
  for (const api of ['Server', 'Admin']) {
    for (const kind of ['UserData', 'UserReadOnlyData', 'UserInternalData', 'UserPublisherData', 'UserPublisherReadOnlyData', 'UserPublisherInternalData']) {
      steps.push([`/${api}/Update${kind}`, { PlayFabId: A.id, Data: { [kind]: api } }]);
      steps.push([`/${api}/Get${kind}`, { PlayFabId: A.id, Keys: [kind] }]);
    }
  }

  const authFor = (url) => {
    const auth = spec.call(url).auth;
    if (auth === 'SessionTicket') return A.auth;
    if (auth === 'SecretKey') return t.secret;
    if (auth === 'EntityToken') return A.entity;
    return {};
  };
  for (const [url, body, expectError, headers] of steps) {
    if (expectError) await t.err(url, body, headers || authFor(url), expectError);
    else await t.ok(url, body, headers || authFor(url));
  }
  assert.equal(t.app.players.byId(D.id), null);
  assert.equal(t.app.title().currencies.length, 1);
  await t.stop();
});

test('players can\'t touch other players\' things by naming them', async () => {
  const t = await start();
  const a = await t.player('mal');
  const b = await t.player('nell');
  const [potion] = (await t.ok('/Server/GrantItemsToUser', { PlayFabId: b.id, ItemIds: ['potion'] }, t.secret)).ItemGrantResults;
  // PlayFabId isn't part of ConsumeItem for players, so it's ignored: a's own inventory is used.
  await t.err('/Client/ConsumeItem', { PlayFabId: b.id, ItemInstanceId: potion.ItemInstanceId, ConsumeCount: 1 }, a.auth, 'ItemNotFound');
  const inv = await t.ok('/Client/GetUserInventory', { PlayFabId: b.id }, a.auth);
  assert.equal(inv.Inventory.length, 0);
  await t.ok('/Client/UpdateUserData', { PlayFabId: b.id, Data: { hacked: 'yes' } }, a.auth);
  const bData = await t.ok('/Server/GetUserData', { PlayFabId: b.id }, t.secret);
  assert.deepEqual(bData.Data, {});
  // Reading someone else's combined info only shows what's public.
  await t.ok('/Server/UpdateUserData', { PlayFabId: b.id, Data: { bio: 'hi', diary: 'private' }, Permission: 'Private' }, t.secret);
  await t.ok('/Server/UpdateUserData', { PlayFabId: b.id, Data: { bio: 'hi' }, Permission: 'Public' }, t.secret);
  await t.ok('/Client/AddOrUpdateContactEmail', { EmailAddress: 'nell@example.com' }, b.auth);
  const info = await t.ok('/Client/GetPlayerCombinedInfo', {
    PlayFabId: b.id,
    InfoRequestParameters: { GetUserAccountInfo: true, GetUserData: true, GetUserInventory: true, GetUserVirtualCurrency: true },
  }, a.auth);
  assert.equal(info.PlayFabId, b.id);
  assert.equal(info.InfoResultPayload.AccountInfo.PrivateInfo, undefined);
  assert.equal(info.InfoResultPayload.AccountInfo.CustomIdInfo, undefined);
  assert.deepEqual(Object.keys(info.InfoResultPayload.UserData), ['bio']);
  assert.equal(info.InfoResultPayload.UserInventory, undefined);
  assert.equal(info.InfoResultPayload.UserVirtualCurrency, undefined);
  await t.stop();
});

test('"__proto__" keys are refused, and made-up addresses aren\'t counted', async () => {
  const t = await start();
  const p = await t.player('otto');
  await t.err('/Client/UpdateUserData', JSON.parse('{"Data":{"__proto__":"x"}}'), p.auth, 'InvalidParams');
  await t.err('/Object/SetObjects', JSON.parse(`{"Entity":${JSON.stringify(p.entityKey)},"Objects":[{"ObjectName":"a","DataObject":{"__proto__":{"admin":true}}}]}`), p.entity, 'InvalidParams');
  await t.err('/Object/SetObjects', { Entity: p.entityKey, Objects: [{ ObjectName: '__proto__', DataObject: { admin: true } }] }, p.entity, 'InvalidParams');
  await t.err('/Client/UpdatePlayerStatistics', { Statistics: [{ StatisticName: '__proto__', Value: 1 }] }, p.auth, 'InvalidParams');
  for (let i = 0; i < 5; i++) await t.raw('POST', `/Client/Nope${i}`, { body: {} });
  const status = await t.raw('GET', '/status');
  assert.equal(Object.keys(status.json.seen).some((u) => u.includes('Nope')), false);
  await t.stop();
});

test('names every object has built in, like "constructor", are just names', async () => {
  const t = await start();
  const p = await t.player('nina');
  await t.err('/Client/GetStoreItems', { StoreId: 'constructor' }, p.auth, 'StoreNotFound');
  await t.err('/Admin/DeleteStore', { StoreId: 'toString' }, t.secret, 'StoreNotFound');
  assert.deepEqual((await t.ok('/Client/GetCatalogItems', { CatalogVersion: 'hasOwnProperty' }, p.auth)).Catalog, []);
  await t.err('/Client/GetCharacterData', { CharacterId: 'constructor' }, p.auth, 'CharacterNotFound');
  await t.err('/Client/ConsumeItem', { CharacterId: 'valueOf', ItemInstanceId: 'x', ConsumeCount: 1 }, p.auth, 'CharacterNotFound');
  await t.err('/Admin/IncrementPlayerStatisticVersion', { StatisticName: 'constructor' }, t.secret, 'StatisticNotFound');
  await t.err('/Admin/UpdatePlayerStatisticDefinition', { StatisticName: 'toString', AggregationMethod: 'Max' }, t.secret, 'StatisticNotFound');
  await t.ok('/Client/UpdatePlayerStatistics', { Statistics: [{ StatisticName: 'constructor', Value: 7 }] }, p.auth);
  const stats = await t.ok('/Client/GetPlayerStatistics', { StatisticNames: ['constructor'] }, p.auth);
  assert.deepEqual(stats.Statistics.map((s) => [s.StatisticName, s.Value]), [['constructor', 7]]);
  const lb = await t.ok('/Client/GetLeaderboard', { StatisticName: 'constructor', StartPosition: 0, MaxResultsCount: 5 }, p.auth);
  assert.deepEqual(lb.Leaderboard.map((e) => e.StatValue), [7]);
  await t.ok('/Client/UpdateUserData', { Data: { toString: 'fine' } }, p.auth);
  assert.equal((await t.ok('/Client/GetUserData', { Keys: ['toString', 'valueOf'] }, p.auth)).Data.toString.Value, 'fine');
  assert.equal(typeof Object.version, 'undefined');
  await t.stop();
});

// ---------------------------------------------------------------- saving to disk

test('players are saved to disk and survive a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-playing-'));
  try {
    let t = await start({ dataDir: dir });
    const p = await t.player('ida');
    await t.ok('/Client/UpdateUserData', { Data: { saved: 'yes' } }, p.auth);
    await t.ok('/Server/SetTitleData', { Key: 'motd', Value: 'kept' }, t.secret);
    await t.ok('/Group/CreateGroup', { GroupName: 'Kept Clan' }, p.entity);
    const up = await t.ok('/File/InitiateFileUploads', { Entity: p.entityKey, FileNames: ['ida.sav'] }, p.entity);
    await fetch(up.UploadDetails[0].UploadUrl, { method: 'PUT', body: 'level 3' });
    await t.ok('/File/FinalizeFileUploads', { Entity: p.entityKey, FileNames: ['ida.sav'], ProfileVersion: up.ProfileVersion }, p.entity);
    const secret = t.app.keys.secretKey;
    await t.stop();

    t = await start({ dataDir: dir, titleDir: null });
    assert.equal(t.app.keys.secretKey, secret);
    const again = await t.ok('/Client/LoginWithCustomID', { TitleId: '1A2B3', CustomId: 'ida' });
    assert.equal(again.PlayFabId, p.id);
    const d = await t.ok('/Client/GetUserData', {}, { 'X-Authorization': again.SessionTicket });
    assert.equal(d.Data.saved.Value, 'yes');
    const td = await t.ok('/Client/GetTitleData', { Keys: ['motd'] }, { 'X-Authorization': again.SessionTicket });
    assert.equal(td.Data.motd, 'kept');
    // An old session ticket still works after a restart (same signing key).
    await t.ok('/Client/GetAccountInfo', {}, p.auth);
    const files = await t.ok('/File/GetFiles', { Entity: p.entityKey }, p.entity);
    const groups = await t.ok('/Group/ListMembership', {}, p.entity);
    assert.deepEqual(groups.Groups.map((g) => g.GroupName), ['Kept Clan']);
    assert.equal(await (await fetch(files.Metadata['ida.sav'].DownloadUrl)).text(), 'level 3');
    await t.stop();

    // A half-written last line (a crash mid-write) is skipped.
    fs.appendFileSync(path.join(dir, 'journal.jsonl'), '{"c":"players","k":"BROKEN');
    t = await start({ dataDir: dir, titleDir: null });
    assert.ok(t.app.players.byId(p.id));
    await t.stop();
    const mode = fs.statSync(path.join(dir, 'keys.json')).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restarting with the title folder keeps what changed while running', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-playing-'));
  try {
    let t = await start({ dataDir: dir });
    const p = await t.player('rhea');
    await t.ok('/Server/SetTitleData', { Key: 'event', Value: 'on' }, t.secret);
    await t.ok('/Server/SetTitleData', { Key: 'motd', Value: 'changed' }, t.secret);
    await t.ok('/Client/UpdatePlayerStatistics', { Statistics: [{ StatisticName: 'WeeklyKills', Value: 3 }] }, p.auth);
    t.clock.now = new Date('2026-11-30T01:00:00Z'); // a new week: version 1
    await t.ok('/Client/GetLeaderboard', { StatisticName: 'WeeklyKills', StartPosition: 0 }, (await t.player('rhea')).auth);
    await t.ok('/Admin/UpdateCloudScript', { Files: [{ Filename: 'x.js', FileContents: 'handlers.x = function () { return 1; };' }], Publish: true }, t.secret);
    await t.stop();

    for (let round = 0; round < 2; round++) {
      t = await start({ dataDir: dir });
      t.clock.now = new Date('2026-11-30T02:00:00Z');
      const title = t.app.title();
      assert.equal(title.titleData.event, 'on');
      assert.equal(title.titleData.motd, 'Welcome back! Double gold this weekend.');
      assert.equal(title.statistics.WeeklyKills.version, 1);
      assert.equal(title.statistics.WeeklyKills.versions.length, 2);
      assert.deepEqual(title.cloudScript.revisions.map((r) => r.Revision), [1, 2, 3]);
      assert.equal(title.cloudScript.live, 3);
      const again = await t.player('rhea');
      const hello = await t.ok('/Client/ExecuteCloudScript', { FunctionName: 'helloWorld' }, again.auth);
      assert.equal(hello.Revision, 3);
      await t.stop();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a title can be saved to a folder and brought back unchanged', async () => {
  const { exportTitle, safeFileName } = require('../tools/export-title');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-playing-export-'));
  const out = path.join(dir, 'my-game');
  try {
    const source = await start();
    await source.ok('/Admin/AddNews', { Title: 'Last day', Body: 'Thanks for playing.' }, source.secret);
    await source.ok('/Admin/SetTitleInternalData', { Key: 'serverOnly', Value: 'yes' }, source.secret);
    const summary = await exportTitle({
      titleId: '1A2B3', secretKey: source.app.keys.secretKey, out, server: source.base, stores: ['weekend_sale', 'missing_store'],
    });
    assert.equal(summary.skipped.length, 1); // the store that doesn't exist
    assert.ok(fs.existsSync(path.join(out, 'cloudscript', 'cloudscript.js')));
    await assert.rejects(exportTitle({ titleId: '1A2B3', secretKey: source.app.keys.secretKey, out, server: source.base }), /isn't empty/);
    await assert.rejects(exportTitle({ titleId: '1A2B3', secretKey: 'wrong', out: path.join(dir, 'other'), server: source.base }), /NotAuthenticated/);

    const copy = await start({ titleDir: out });
    const same = async (url, body = {}) => {
      const a = await source.ok(url, body, source.secret);
      const b = await copy.ok(url, body, copy.secret);
      assert.deepEqual(b, a, `${url} differs after the round trip`);
    };
    await same('/Admin/GetTitleData');
    await same('/Admin/GetTitleInternalData');
    await same('/Admin/GetCatalogItems');
    await same('/Admin/GetStoreItems', { StoreId: 'weekend_sale' });
    await same('/Admin/ListVirtualCurrencyTypes');
    await same('/Admin/GetPlayerStatisticDefinitions');
    await same('/Server/GetTitleNews', { Count: 100 });
    const p = await copy.player('saved');
    const hello = await copy.ok('/Client/ExecuteCloudScript', { FunctionName: 'helloWorld' }, p.auth);
    assert.equal(hello.FunctionResult.messageValue, `Hello ${p.id}!`);
    await source.stop();
    await copy.stop();

    // CloudScript file names can't escape the folder.
    const used = new Set();
    assert.equal(safeFileName('../../etc/passwd', used), 'passwd.js');
    assert.equal(safeFileName('a b/c?.js', used), 'c_.js');
    assert.equal(safeFileName('c_.js', used), 'c_-2.js');
    assert.equal(safeFileName('...', used), 'cloudscript.js');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('OVERKILL\'s The Walking Dead: the calls the game makes all work', async () => {
  const t = await start({ titleDir: path.join(ROOT, 'games', 'otwd') });
  // The game signs in with the player's Steam ID, an empty title ID and no CreateAccount.
  const login = await t.ok('/Client/LoginWithCustomID', { TitleId: '', CustomId: '76561198000000001' });
  const auth = { 'X-Authorization': login.SessionTicket };
  const run = async (name, a = auth) => {
    const r = await t.ok('/Client/ExecuteCloudScript', { FunctionName: name }, a);
    assert.equal(r.Error, undefined, `${name}: ${JSON.stringify(r.Error)}`);
    return r.FunctionResult;
  };

  assert.equal(typeof (await run('GetSeed')).date, 'number');
  let quest = await run('GetWeeklyQuest');
  assert.equal(quest.status, 'Expired');
  assert.ok(quest.quest.WeeklyQuestIndex >= 1 && quest.quest.WeeklyQuestIndex <= 14);
  assert.ok([3000, 4000, 5000].includes(quest.quest.WeeklyXPReward));
  assert.equal(quest.quest['WeeklyScrap/Prov/Equip/Med/Gold'].length, 5);
  assert.equal(quest.quest.WeeklyWeaponRewardsIndices.length, 3);

  // Everyone gets the same quest in a week.
  const other = await t.ok('/Client/LoginWithCustomID', { TitleId: '', CustomId: '76561198000000002' });
  const theirs = await run('GetWeeklyQuest', { 'X-Authorization': other.SessionTicket });
  assert.deepEqual(theirs.quest, quest.quest);

  assert.deepEqual(await run('ActivateWeeklyQuest'), { status: 'InProgress' });
  assert.equal((await run('GetWeeklyQuest')).status, 'InProgress');
  t.clock.now = new Date(t.clock.now.getTime() + 20 * 60 * 1000); // twenty minutes of zombies later
  await t.ok('/Client/UpdateUserData', { Data: { WeeklyQuestDone: 'true' } }, auth);
  assert.equal((await run('GetWeeklyQuest')).status, 'Completed');
  // The other player hasn't done anything this week.
  assert.equal((await run('GetWeeklyQuest', { 'X-Authorization': other.SessionTicket })).status, 'Expired');

  const npc = await run('GetWeeklyNPC');
  assert.equal(npc.npc.Inventory.length, 3);
  assert.match(npc.npc.Inventory[0].Asset, /^SBZWeaponData'/);
  assert.match(npc.npc.Inventory[2].Asset, /^SBZWeaponPartSchematic'/);
  assert.match(npc.npc.Map.Asset, /^SBZLevelSchematic'\/Game\/Schematics\/Levels\/MainQuests\//);
  assert.deepEqual(await run('ActivateWeeklyNPC'), { status: 'InProgress' });
  assert.equal(await run('GetBounties'), 'Expired');

  // The game never sees Keep Playing's own bookkeeping.
  const ro = await t.ok('/Client/GetUserReadOnlyData', {}, auth);
  assert.deepEqual(ro.Data, {});
  await t.ok('/Client/GetTitleData', {}, auth);
  await t.ok('/Client/WritePlayerEvent', { EventName: 'player_logged_in' }, auth);
  // The game's server call works without the old key; the Admin calls stay locked.
  await t.ok('/Server/WritePlayerEvent', { PlayFabId: login.PlayFabId, EventName: 'mission_end' }, { 'X-SecretKey': 'a key nobody has' });
  await t.err('/Admin/GetTitleData', {}, { 'X-SecretKey': 'a key nobody has' }, 'NotAuthenticated');

  // A week later the quest is new and nobody has started it.
  t.clock.now = new Date(t.clock.now.getTime() + 7 * 24 * 3600 * 1000);
  const later = await t.ok('/Client/LoginWithCustomID', { TitleId: '', CustomId: '76561198000000001' });
  assert.equal(later.PlayFabId, login.PlayFabId);
  assert.equal((await run('GetWeeklyQuest', { 'X-Authorization': later.SessionTicket })).status, 'Expired');
  await t.stop();
});

// ---------------------------------------------------------------- run

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join('\n     ')}`);
    }
  }
  const untested = handled.filter((u) => !answered.has(u));
  console.log(`\n${tests.length - failed} of ${tests.length} tests passed; ${checkedAnswers} answers matched Microsoft's description.`);
  console.log(`${handled.length - untested.length} of the ${handled.length} calls Keep Playing answers were tried.`);
  if (process.argv.includes('--untested')) console.log(untested.join('\n'));
  process.exit(failed ? 1 : 0);
})();
