'use strict';
// Sign-in with Apple, Game Center, Nintendo, Battle.net, Kongregate, Facebook
// Instant Games and OpenID Connect; generic service IDs; custom properties;
// and a few small calls (segments, reports, ads, push registration).
//
// PlayFab checks these sign-ins with Apple, Nintendo and the rest. Keep Playing
// can't reach them, so it reads the player's ID from what the game sends (the
// "sub" of an identity token, or the ID field) without checking signatures,
// like Steam sign-in. That's fine on your own computer; the README says so.
// Sign-ins whose tokens can't be read offline (Google, Facebook, Xbox, PSN,
// Twitch) aren't supported.

const { fail } = require('../errors');
const { targetPlayer } = require('./common');

// The "sub" (and "iss") of a JSON Web Token, without checking its signature.
function readJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!claims || typeof claims.sub !== 'string' || !claims.sub) return null;
    return { sub: claims.sub, iss: typeof claims.iss === 'string' ? claims.iss : '' };
  } catch (e) {
    return null;
  }
}

// Facebook Instant Games signatures are "signature.payload", where the payload
// is base64url JSON with the player's ID.
function readFacebookInstantGames(signature) {
  if (typeof signature !== 'string') return null;
  const dot = signature.indexOf('.');
  if (dot < 0) return null;
  try {
    const payload = JSON.parse(Buffer.from(signature.slice(dot + 1), 'base64url').toString('utf8'));
    return payload && payload.player_id ? String(payload.player_id) : null;
  } catch (e) {
    return null;
  }
}

module.exports = function register(on, app) {
  const { signInWith, field } = app.auth;
  const unverified = (what) => app.warnOnce(`unverified:${what}`, `${what} sign-in isn't checked with ${what} itself. That's fine on your own computer, but don't run a public server with it.`);

  const fromToken = (name, what) => (body) => {
    const claims = readJwt(body[name]);
    if (!claims) throw fail('InvalidParams', 'Invalid input parameters', 400, { [name]: [`That ${what} identity token could not be read.`] });
    unverified(what);
    return claims.sub;
  };
  const fromField = (name, what) => (body) => {
    const id = field(name)(body);
    unverified(what);
    return id;
  };
  const fromOpenId = (body) => {
    const claims = readJwt(body.IdToken);
    if (!claims) throw fail('InvalidParams', 'Invalid input parameters', 400, { IdToken: ['That OpenID Connect token could not be read.'] });
    unverified('OpenID Connect');
    return `${claims.iss}\n${claims.sub}`;
  };
  const fromFacebookInstantGames = (body) => {
    const id = readFacebookInstantGames(body.FacebookInstantGamesSignature);
    if (!id) throw fail('InvalidFacebookInstantGamesSignature', 'That Facebook Instant Games signature could not be read.');
    unverified('Facebook Instant Games');
    return id;
  };

  // [kind, sign-in call, link call, unlink call, how to read the ID, lookup call, lookup list field, pair ID field]
  const kinds = [
    ['Apple', 'LoginWithApple', 'LinkApple', 'UnlinkApple', fromToken('IdentityToken', 'Apple')],
    ['GameCenter', 'LoginWithGameCenter', 'LinkGameCenterAccount', 'UnlinkGameCenterAccount', null, 'GetPlayFabIDsFromGameCenterIDs', 'GameCenterIDs', 'GameCenterId'],
    ['Kongregate', 'LoginWithKongregate', 'LinkKongregate', 'UnlinkKongregate', fromField('KongregateId', 'Kongregate'), 'GetPlayFabIDsFromKongregateIDs', 'KongregateIDs', 'KongregateId'],
    ['NintendoSwitchDeviceId', 'LoginWithNintendoSwitchDeviceId', 'LinkNintendoSwitchDeviceId', 'UnlinkNintendoSwitchDeviceId', fromField('NintendoSwitchDeviceId', 'Nintendo Switch'), 'GetPlayFabIDsFromNintendoSwitchDeviceIds', 'NintendoSwitchDeviceIds', 'NintendoSwitchDeviceId'],
    ['NintendoServiceAccount', 'LoginWithNintendoServiceAccount', 'LinkNintendoServiceAccount', 'UnlinkNintendoServiceAccount', fromToken('IdentityToken', 'Nintendo'), 'GetPlayFabIDsFromNintendoServiceAccountIds', 'NintendoAccountIds', 'NintendoServiceAccountId'],
    ['FacebookInstantGames', 'LoginWithFacebookInstantGamesId', 'LinkFacebookInstantGamesId', 'UnlinkFacebookInstantGamesId', fromFacebookInstantGames, 'GetPlayFabIDsFromFacebookInstantGamesIds', 'FacebookInstantGamesIds', 'FacebookInstantGamesId'],
    ['BattleNet', 'LoginWithBattleNet', 'LinkBattleNetAccount', 'UnlinkBattleNetAccount', fromToken('IdentityToken', 'Battle.net'), 'GetPlayFabIDsFromBattleNetAccountIds', 'BattleNetAccountIds', 'BattleNetAccountId'],
  ];
  // Game Center sends the ID as PlayerId to sign in and GameCenterId to link.
  const gameCenterLogin = fromField('PlayerId', 'Game Center');
  const gameCenterLink = fromField('GameCenterId', 'Game Center');

  const serverTarget = (body) => {
    const p = app.players.byId(body.PlayFabId);
    if (!p) throw fail('AccountNotFound', 'User not found');
    return p;
  };
  const has = (url) => !!require('../spec').call(url);

  for (const [kind, login, link, unlink, read, lookup, listField, pairField] of kinds) {
    const readLogin = kind === 'GameCenter' ? gameCenterLogin : read;
    const readLink = kind === 'GameCenter' ? gameCenterLink : read;
    on(`/Client/${login}`, signInWith(kind, readLogin));
    if (has(`/Server/${login}`)) on(`/Server/${login}`, signInWith(kind, readLogin));

    on(`/Client/${link}`, (body, ctx) => {
      app.players.link(ctx.player, kind, readLink(body), !!body.ForceLink);
      return {};
    });
    if (has(`/Server/${link}`)) {
      on(`/Server/${link}`, (body) => {
        app.players.link(serverTarget(body), kind, readLink(body), !!body.ForceLink);
        return {};
      });
    }
    on(`/Client/${unlink}`, (body, ctx) => {
      app.players.unlink(ctx.player, kind);
      return {};
    });
    if (has(`/Server/${unlink}`)) {
      on(`/Server/${unlink}`, (body) => {
        app.players.unlink(serverTarget(body), kind);
        return {};
      });
    }
    if (lookup) {
      const answer = (body) => ({
        Data: (body[listField] || []).map((id) => {
          const p = app.players.byLink(kind, String(id));
          return { [pairField]: String(id), PlayFabId: p ? p.id : undefined };
        }),
      });
      on(`/Client/${lookup}`, answer);
      if (has(`/Server/${lookup}`)) on(`/Server/${lookup}`, answer);
    }
  }

  // Nintendo: a game server can link the account ID (subject) directly.
  on('/Server/LinkNintendoServiceAccountSubject', (body) => {
    app.players.link(serverTarget(body), 'NintendoServiceAccount', field('Subject')(body), !!body.ForceLink);
    return {};
  });

  // OpenID Connect: one link per connection.
  on('/Client/LoginWithOpenIdConnect', (body, ctx) => signInWith(`OpenId:${field('ConnectionId')(body)}`, fromOpenId)(body, ctx));
  on('/Client/LinkOpenIdConnect', (body, ctx) => {
    app.players.link(ctx.player, `OpenId:${field('ConnectionId')(body)}`, fromOpenId(body), !!body.ForceLink);
    return {};
  });
  on('/Client/UnlinkOpenIdConnect', (body, ctx) => {
    app.players.unlink(ctx.player, `OpenId:${field('ConnectionId')(body)}`);
    return {};
  });
  const openIdLookup = (body) => ({
    Data: (body.OpenIdSubjectIdentifiers || []).map((ident) => {
      const value = `${ident.Issuer}\n${ident.Subject}`;
      const p = [...app.players.all()].find((x) => Object.entries(x.links).some(([k, v]) => k.startsWith('OpenId:') && v === value));
      return { OpenIdSubjectIdentifier: { Issuer: ident.Issuer, Subject: ident.Subject }, PlayFabId: p ? p.id : undefined };
    }),
  });
  on('/Client/GetPlayFabIDsFromOpenIdSubjectIdentifiers', openIdLookup);
  on('/Server/GetPlayFabIDsFromOpenIdSubjectIdentifiers', openIdLookup);

  // Generic IDs: the game's own name for a player on some other service.
  const genericKind = (g) => {
    if (!g || typeof g.ServiceName !== 'string' || !g.ServiceName || typeof g.UserId !== 'string' || !g.UserId) {
      throw fail('InvalidParams', 'Invalid input parameters', 400, { GenericId: ['GenericId needs a ServiceName and a UserId.'] });
    }
    return `Generic:${g.ServiceName}`;
  };
  const addGeneric = (body, ctx) => {
    app.players.link(targetPlayer(app, body, ctx), genericKind(body.GenericId), body.GenericId.UserId, false);
    return {};
  };
  const removeGeneric = (body, ctx) => {
    const p = targetPlayer(app, body, ctx);
    const kind = genericKind(body.GenericId);
    if (p.links[kind] !== body.GenericId.UserId) throw fail('AccountNotLinked', 'That generic ID isn\'t linked to this player.');
    app.players.unlink(p, kind);
    return {};
  };
  const genericLookup = (body) => ({
    Data: (body.GenericIDs || []).map((g) => {
      const p = g && g.ServiceName ? app.players.byLink(`Generic:${g.ServiceName}`, String(g.UserId)) : null;
      return { GenericId: { ServiceName: g.ServiceName, UserId: g.UserId }, PlayFabId: p ? p.id : undefined };
    }),
  });
  for (const api of ['Client', 'Server']) {
    on(`/${api}/AddGenericID`, addGeneric);
    on(`/${api}/RemoveGenericID`, removeGeneric);
    on(`/${api}/GetPlayFabIDsFromGenericIDs`, genericLookup);
  }

  // Player custom properties: named values with one version number per player.
  const MAX_PROPERTIES = 100;
  const props = (p) => (p.customProps = p.customProps || {});
  const propsVersion = (p) => p.customPropsVersion || 0;
  const checkVersion = (p, expected) => {
    if (typeof expected === 'number' && expected !== propsVersion(p)) {
      throw fail('PlayerCustomPropertiesVersionMismatch', `Expected version ${expected}, but it's ${propsVersion(p)}.`);
    }
  };
  const getProperty = (body, ctx) => {
    const p = targetPlayer(app, body, ctx);
    const all = props(p);
    const out = { PropertiesVersion: propsVersion(p) };
    if (Object.prototype.hasOwnProperty.call(all, body.PropertyName)) out.Property = { Name: body.PropertyName, Value: all[body.PropertyName] };
    else throw fail('PlayerCustomPropertiesPropertyDoesNotExist', `There's no property called ${body.PropertyName}.`);
    return out;
  };
  const listProperties = (body, ctx) => {
    const p = targetPlayer(app, body, ctx);
    return { Properties: Object.entries(props(p)).map(([Name, Value]) => ({ Name, Value })), PropertiesVersion: propsVersion(p) };
  };
  const updateProperties = (body, ctx) => {
    const p = targetPlayer(app, body, ctx);
    checkVersion(p, body.ExpectedPropertiesVersion);
    const all = props(p);
    const names = new Set();
    for (const prop of body.Properties) {
      // The limits here (32-character names, 256-character text, 100 properties)
      // are our best reading of PlayFab's documentation; tell us if a game disagrees.
      const name = prop && prop.Name;
      if (typeof name === 'string' && name.length > 32) throw fail('PlayerCustomPropertiesPropertyNameTooLong', `${name.slice(0, 32)}... is longer than 32 characters.`);
      if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(name)) {
        throw fail('PlayerCustomPropertiesPropertyNameIsInvalid', `"${name}" isn't a valid property name.`);
      }
      if (names.has(name)) throw fail('PlayerCustomPropertiesDuplicatePropertyName', `${name} appears twice.`);
      names.add(name);
      const v = prop.Value;
      if (!['string', 'number', 'boolean'].includes(typeof v)) throw fail('PlayerCustomPropertiesValueIsInvalidType', `${name} should be text, a number or true/false.`);
      if (typeof v === 'string' && v.length > 256) throw fail('PlayerCustomPropertiesStringPropertyValueTooLong', `${name} is longer than 256 characters.`);
    }
    for (const prop of body.Properties) all[prop.Name] = prop.Value;
    if (Object.keys(all).length > MAX_PROPERTIES) throw fail('PlayerCustomPropertiesPropertyCountTooHigh', `A player can have at most ${MAX_PROPERTIES} properties.`);
    p.customPropsVersion = propsVersion(p) + 1;
    app.players.save(p);
    return { PropertiesVersion: p.customPropsVersion };
  };
  const deleteProperties = (body, ctx) => {
    const p = targetPlayer(app, body, ctx);
    checkVersion(p, body.ExpectedPropertiesVersion);
    const all = props(p);
    const deleted = body.PropertyNames.map((Name) => {
      const was = Object.prototype.hasOwnProperty.call(all, Name);
      delete all[Name];
      return { Name, WasDeleted: was };
    });
    if (deleted.some((d) => d.WasDeleted)) p.customPropsVersion = propsVersion(p) + 1;
    app.players.save(p);
    return { DeletedProperties: deleted, PropertiesVersion: propsVersion(p) };
  };
  for (const api of ['Client', 'Server', 'Admin']) {
    on(`/${api}/GetPlayerCustomProperty`, getProperty);
    on(`/${api}/ListPlayerCustomProperties`, listProperties);
    on(`/${api}/UpdatePlayerCustomProperties`, updateProperties);
    on(`/${api}/DeletePlayerCustomProperties`, deleteProperties);
  }

  // Segments are built in PlayFab's Game Manager; there are none here.
  for (const api of ['Client', 'Server', 'Admin']) {
    on(`/${api}/GetPlayerSegments`, (body, ctx) => {
      if (api !== 'Client') targetPlayer(app, body, ctx);
      return { Segments: [] };
    });
  }

  // Reports about other players are counted (5 a day each), not sent anywhere.
  const REPORTS_PER_DAY = 5;
  const report = (reporter, reporteeId, ctx) => {
    if (!app.players.byId(reporteeId)) throw fail('AccountNotFound', `User ${reporteeId} not found`);
    const day = ctx.now.toISOString().slice(0, 10);
    reporter.reports = reporter.reports && reporter.reports.day === day ? reporter.reports : { day, count: 0 };
    if (reporter.reports.count >= REPORTS_PER_DAY) return { SubmissionsRemaining: 0, Updated: false };
    reporter.reports.count += 1;
    app.players.save(reporter);
    return { SubmissionsRemaining: REPORTS_PER_DAY - reporter.reports.count, Updated: true };
  };
  on('/Client/ReportPlayer', (body, ctx) => report(ctx.player, body.ReporteeId, ctx));
  on('/Server/ReportPlayer', (body, ctx) => {
    const reporter = app.players.byId(body.ReporterId);
    if (!reporter) throw fail('AccountNotFound', `User ${body.ReporterId} not found`);
    return report(reporter, body.ReporteeId, ctx);
  });

  // No ads and no push notifications: the calls succeed and do nothing.
  on('/Client/GetAdPlacements', () => ({ AdPlacements: [] }));
  on('/Client/AndroidDevicePushNotificationRegistration', () => ({}));
  on('/Client/RegisterForIOSPushNotification', () => ({}));
};

module.exports.readJwt = readJwt;
module.exports.readFacebookInstantGames = readFacebookInstantGames;
