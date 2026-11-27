'use strict';
// Signing in, registering, linking sign-in IDs, and entity tokens.

const { fail } = require('../errors');
const tokens = require('../tokens');
const { titleAccount, isBanned } = require('../players');
const { combinedInfo } = require('./combined');

const SETTINGS_FOR_USER = { NeedsAttribution: false, GatherDeviceInfo: true, GatherFocusInfo: true };

const required = (field) => fail('InvalidParams', 'Invalid input parameters', 400, { [field]: [`The ${field} field is required.`] });

// Reads the Steam ID out of a hex Steam auth ticket. The ID sits at a known
// place in the ticket. Valve's signature is not checked yet (see README).
function steamIdFromTicket(hex) {
  if (typeof hex !== 'string' || hex.length < 40 || hex.length % 2 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const buf = Buffer.from(hex, 'hex');
  const individual = (id) => (id >> 32n) === 0x01100001n; // public universe, individual account
  if (buf.length >= 20 && buf.readUInt32LE(0) === 20) {
    const id = buf.readBigUInt64LE(12);
    if (individual(id)) return id.toString();
  }
  if (buf.length >= 16) {
    const id = buf.readBigUInt64LE(8);
    if (individual(id)) return id.toString();
  }
  return null;
}

module.exports = function register(on, app) {
  function checkTitle(body, ctx) {
    if (!body.TitleId) return;
    const t = app.title();
    if (!t.titleId) {
      t.titleId = String(body.TitleId);
      app.saveTitle(t);
      app.log(`Title ID set to ${t.titleId} by the first sign-in.`);
      return;
    }
    if (String(body.TitleId).toUpperCase() !== String(t.titleId).toUpperCase()) {
      throw fail('InvalidTitleId', `This server is for title ${t.titleId}, not ${body.TitleId}.`);
    }
  }

  function entityTokenFor(entity, now) {
    const t = tokens.entityToken(app.keys.serverKey, entity, now);
    return { EntityToken: t.token, TokenExpiration: t.expires.toISOString(), Entity: { ...entity, TypeString: entity.Type } };
  }

  function signIn(p, ctx, { created, info }) {
    const previous = p.lastLogin;
    p.lastLogin = ctx.now.toISOString();
    app.players.save(p);
    const result = {
      SessionTicket: tokens.sessionTicket(app.keys.serverKey, p.id, p.entityId, ctx.now),
      PlayFabId: p.id,
      NewlyCreated: !!created,
      SettingsForUser: { ...SETTINGS_FOR_USER },
      LastLoginTime: created ? undefined : previous || undefined,
      EntityToken: entityTokenFor({ Id: p.entityId, Type: 'title_player_account' }, ctx.now),
      TreatmentAssignment: { Variants: [], Variables: [] },
    };
    if (info) result.InfoResultPayload = combinedInfo(app, p, info, ctx, true);
    return result;
  }

  // Sign-in with an ID the game makes up (custom ID, device IDs, Steam).
  function signInWith(kind, readId) {
    return (body, ctx) => {
      checkTitle(body, ctx);
      const id = readId(body);
      let p = app.players.byLink(kind, id);
      let created = false;
      if (!p) {
        // Old games often sign in without CreateAccount, because their players
        // already had accounts. createAccountsOnLogin makes those accounts.
        if (!body.CreateAccount && !ctx.title.settings.createAccountsOnLogin) throw fail('AccountNotFound', 'User not found');
        p = app.players.create({ kind, value: id, now: ctx.now, title: ctx.title });
        created = true;
      }
      if (isBanned(p, ctx.now)) throw fail('AccountBanned', 'This account is banned.', 403);
      return signIn(p, ctx, { created, info: body.InfoRequestParameters });
    };
  }

  const field = (name) => (body) => {
    const v = body[name];
    if (v === undefined || v === null || v === '') throw required(name);
    return String(v);
  };

  // Shared with platforms.js, which adds the other sign-in kinds.
  app.auth = { signInWith, field, entityTokenFor };

  const steamTicket = (body) => {
    const id = steamIdFromTicket(body.SteamTicket);
    if (!id) throw fail('InvalidSteamTicket', 'That Steam ticket could not be read.');
    app.warnOnce('steam', "Steam tickets aren't checked with Valve yet. That's fine on your own computer, but don't run a public server with Steam sign-in until it is.");
    return id;
  };

  on('/Client/LoginWithCustomID', signInWith('CustomId', field('CustomId')));
  on('/Client/LoginWithAndroidDeviceID', signInWith('AndroidDeviceId', field('AndroidDeviceId')));
  on('/Client/LoginWithIOSDeviceID', signInWith('IOSDeviceId', field('DeviceId')));
  on('/Client/LoginWithSteam', signInWith('Steam', steamTicket));

  on('/Client/LoginWithEmailAddress', (body, ctx) => {
    checkTitle(body, ctx);
    const p = app.players.byEmail(body.Email);
    if (!p || !tokens.checkPassword(p.password, body.Password)) throw fail('InvalidEmailOrPassword', 'Invalid email address or password');
    if (isBanned(p, ctx.now)) throw fail('AccountBanned', 'This account is banned.', 403);
    return signIn(p, ctx, { created: false, info: body.InfoRequestParameters });
  });

  on('/Client/LoginWithPlayFab', (body, ctx) => {
    checkTitle(body, ctx);
    const p = app.players.byUsername(body.Username);
    if (!p || !tokens.checkPassword(p.password, body.Password)) throw fail('InvalidUsernameOrPassword', 'Invalid username or password');
    if (isBanned(p, ctx.now)) throw fail('AccountBanned', 'This account is banned.', 403);
    return signIn(p, ctx, { created: false, info: body.InfoRequestParameters });
  });

  // PlayFab's rules for usernames, emails and passwords.
  function checkCredentials(body, needBoth) {
    const details = {};
    const { Username, Email, Password } = body;
    if (Username !== undefined && Username !== null && !/^[A-Za-z0-9]{3,20}$/.test(String(Username))) {
      details.Username = ['Username must be between 3 and 20 letters or digits.'];
    }
    if (Email !== undefined && Email !== null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(Email))) {
      details.Email = ['Email address is not valid.'];
    }
    if (typeof Password !== 'string' || Password.length < 6 || Password.length > 100) {
      details.Password = ['Password must be between 6 and 100 characters.'];
    }
    if (needBoth && !Username) details.Username = ['The Username field is required.'];
    if (needBoth && !Email) details.Email = ['The Email field is required.'];
    if (!needBoth && !Username && !Email) details.Username = ['Either Username or Email is required.'];
    if (Object.keys(details).length) throw fail('InvalidParams', 'Invalid input parameters', 400, details);
    if (Username && app.players.byUsername(String(Username))) throw fail('UsernameNotAvailable', 'Username not available');
    if (Email && app.players.byEmail(String(Email))) throw fail('EmailAddressNotAvailable', 'Email address not available');
  }

  on('/Client/RegisterPlayFabUser', (body, ctx) => {
    checkTitle(body, ctx);
    checkCredentials(body, body.RequireBothUsernameAndEmail !== false);
    const p = app.players.create({ kind: 'Username', now: ctx.now, title: ctx.title });
    if (body.Username) app.players.setUsername(p, String(body.Username));
    if (body.Email) app.players.setEmail(p, String(body.Email));
    p.password = tokens.hashPassword(body.Password);
    if (body.DisplayName) p.displayName = String(body.DisplayName);
    const r = signIn(p, ctx, { created: true, info: body.InfoRequestParameters });
    return {
      PlayFabId: r.PlayFabId,
      SessionTicket: r.SessionTicket,
      Username: p.username || undefined,
      SettingsForUser: r.SettingsForUser,
      EntityToken: r.EntityToken,
    };
  });

  on('/Client/AddUsernamePassword', (body, ctx) => {
    const p = ctx.player;
    if (p.username || p.email) throw fail('AccountAlreadyLinked', 'This account already has a username and password.');
    checkCredentials(body, true);
    app.players.setUsername(p, String(body.Username));
    app.players.setEmail(p, String(body.Email));
    p.password = tokens.hashPassword(body.Password);
    app.players.save(p);
    return { Username: p.username };
  });

  // Link and unlink pairs.
  const links = [
    ['CustomID', 'CustomId', 'CustomId'],
    ['AndroidDeviceID', 'AndroidDeviceId', 'AndroidDeviceId'],
    ['IOSDeviceID', 'IOSDeviceId', 'DeviceId'],
  ];
  for (const [name, kind, idField] of links) {
    on(`/Client/Link${name}`, (body, ctx) => {
      app.players.link(ctx.player, kind, field(idField)(body), !!body.ForceLink);
      return {};
    });
    on(`/Client/Unlink${name}`, (body, ctx) => {
      app.players.unlink(ctx.player, kind);
      return {};
    });
  }
  on('/Client/LinkSteamAccount', (body, ctx) => {
    app.players.link(ctx.player, 'Steam', steamTicket(body), !!body.ForceLink);
    return {};
  });
  on('/Client/UnlinkSteamAccount', (body, ctx) => {
    app.players.unlink(ctx.player, 'Steam');
    return {};
  });

  // Game servers signing players in with an ID only the server knows.
  on('/Server/LoginWithServerCustomId', signInWith('ServerCustomId', field('ServerCustomId')));
  on('/Server/LinkServerCustomId', (body) => {
    const p = app.players.byId(body.PlayFabId);
    if (!p) throw fail('AccountNotFound', 'User not found');
    app.players.link(p, 'ServerCustomId', field('ServerCustomId')(body), !!body.ForceLink);
    return {};
  });
  on('/Server/UnlinkServerCustomId', (body) => {
    const p = app.players.byId(body.PlayFabId);
    if (!p) throw fail('AccountNotFound', 'User not found');
    app.players.unlink(p, 'ServerCustomId');
    return {};
  });
  on('/Server/GetPlayFabIDsFromServerCustomIDs', (body) => ({
    Data: (body.ServerCustomIds || []).map((id) => {
      const p = app.players.byLink('ServerCustomId', String(id));
      return { ServerCustomId: String(id), PlayFabId: p ? p.id : undefined };
    }),
  }));
  on('/Server/GetServerCustomIDsFromPlayFabIDs', (body) => ({
    Data: (body.PlayFabIDs || []).map((id) => {
      const p = app.players.byId(id);
      return { PlayFabId: String(id), ServerCustomId: p && p.links.ServerCustomId !== undefined ? p.links.ServerCustomId : undefined };
    }),
  }));

  // Entity tokens.
  on('/Authentication/GetEntityToken', (body, ctx) => {
    const t = ctx.title;
    let entity;
    if (ctx.entity) {
      entity = ctx.entity;
    } else if (ctx.player) {
      const wanted = body.Entity;
      if (wanted && wanted.Type === 'master_player_account') entity = { Id: ctx.player.id, Type: 'master_player_account' };
      else entity = { Id: ctx.player.entityId, Type: 'title_player_account' };
    } else if (ctx.server) {
      if (!t.titleId) throw fail('InvalidTitleId', 'This server has no title ID yet. Put one in title.json, or sign in a player first.');
      entity = { Id: t.titleId, Type: 'title' };
    }
    return entityTokenFor(entity, ctx.now);
  });

  on('/Authentication/ValidateEntityToken', (body, ctx) => {
    const e = tokens.readEntityToken(app.keys.serverKey, body.EntityToken, ctx.now);
    if (!e) throw fail('EntityTokenInvalid', 'That entity token is not valid.', 400);
    if (e.expired) throw fail('EntityTokenExpired', 'That entity token has expired.', 400);
    const titleId = ctx.title.titleId || undefined;
    const lineage = { TitleId: titleId, NamespaceId: titleId };
    if (e.Type === 'title_player_account' || e.Type === 'master_player_account') {
      const p = e.Type === 'title_player_account' ? app.players.byEntity(e.Id) : app.players.byId(e.Id);
      if (!p) throw fail('AccountNotFound', 'The account for that entity token no longer exists.');
      lineage.MasterPlayerAccountId = p.id;
      if (e.Type === 'title_player_account') lineage.TitlePlayerAccountId = p.entityId;
    }
    return {
      Entity: { Id: e.Id, Type: e.Type, TypeString: e.Type },
      IdentifiedDeviceType: 'Unknown',
      Lineage: lineage,
    };
  });
};

module.exports.steamIdFromTicket = steamIdFromTicket;
module.exports.titleAccount = titleAccount;
