'use strict';
// Player accounts: creating them, finding them by any of their sign-in IDs,
// and the account shapes PlayFab returns.

const { hexId } = require('./tokens');
const { fail } = require('./errors');

// Sign-in kinds we can link to an account, and how PlayFab names their origin.
const KINDS = {
  CustomId: 'CustomId',
  AndroidDeviceId: 'Android',
  IOSDeviceId: 'IOS',
  Steam: 'Steam',
  ServerCustomId: 'ServerCustomId',
  Apple: 'Apple',
  GameCenter: 'GameCenter',
  Kongregate: 'Kongregate',
  NintendoSwitchDeviceId: 'NintendoSwitchDeviceId',
  NintendoServiceAccount: 'NintendoSwitchAccount',
  FacebookInstantGames: 'FacebookInstantGamesId',
  BattleNet: 'BattleNet',
  Username: 'Organic',
};

// OpenID Connect links are kept per connection: kind "OpenId:<ConnectionId>",
// value "<issuer>\n<subject>".
const originOf = (kind) => KINDS[kind] || (kind && kind.startsWith('OpenId:') ? 'OpenIdConnect' : 'Organic');

// A player is banned while any ban is active and hasn't run out.
function isBanned(p, now = new Date()) {
  return (p.bans || []).some((b) => b.Active && (!b.Expires || new Date(b.Expires) > now));
}

const DATA_KINDS = [
  'UserData', 'UserReadOnlyData', 'UserInternalData',
  'UserPublisherData', 'UserPublisherReadOnlyData', 'UserPublisherInternalData',
];

class Players {
  constructor(store) {
    this.store = store;
    this.links = new Map(); // "CustomId:abc" -> PlayFabId
    this.usernames = new Map(); // lower-case username -> PlayFabId
    this.emails = new Map(); // lower-case email -> PlayFabId
    this.entities = new Map(); // title player account id -> PlayFabId
    for (const p of store.values('players')) this.index(p);
  }

  index(p) {
    for (const [kind, value] of Object.entries(p.links)) this.links.set(`${kind}:${value}`, p.id);
    if (p.username) this.usernames.set(p.username.toLowerCase(), p.id);
    if (p.email) this.emails.set(p.email.toLowerCase(), p.id);
    this.entities.set(p.entityId, p.id);
  }

  byId(id) {
    return typeof id === 'string' ? this.store.get('players', id.toUpperCase()) || null : null;
  }

  byEntity(entityId) {
    const id = typeof entityId === 'string' ? this.entities.get(entityId.toUpperCase()) : null;
    return id ? this.byId(id) : null;
  }

  byLink(kind, value) {
    const id = this.links.get(`${kind}:${value}`);
    return id ? this.byId(id) : null;
  }

  byUsername(name) {
    const id = typeof name === 'string' ? this.usernames.get(name.toLowerCase()) : null;
    return id ? this.byId(id) : null;
  }

  byEmail(email) {
    const id = typeof email === 'string' ? this.emails.get(email.toLowerCase()) : null;
    return id ? this.byId(id) : null;
  }

  all() {
    return this.store.values('players');
  }

  freshId(taken) {
    for (;;) {
      const id = hexId(8);
      if (!taken(id)) return id;
    }
  }

  create({ kind, value, now, title }) {
    const id = this.freshId((x) => this.store.has('players', x));
    const entityId = this.freshId((x) => this.entities.has(x));
    const at = now.toISOString();
    const vc = {};
    for (const c of title.currencies) vc[c.CurrencyCode] = c.InitialDeposit || 0;
    const p = {
      id,
      entityId,
      created: at,
      firstLogin: at,
      lastLogin: null,
      origination: originOf(kind),
      displayName: null,
      username: null,
      email: null,
      password: null,
      contactEmail: null,
      avatarUrl: null,
      links: {},
      data: Object.fromEntries(DATA_KINDS.map((k) => [k, {}])),
      dataVersion: 0,
      readOnlyDataVersion: 0,
      stats: {},
      vc,
      inventory: [],
      friends: [],
      objects: {},
      profileVersion: 0,
      tags: [],
      bans: [],
    };
    if (kind && value !== undefined && kind !== 'Username') p.links[kind] = String(value);
    this.save(p);
    return p;
  }

  save(p) {
    this.store.put('players', p.id, p);
    this.index(p);
    return p;
  }

  remove(p) {
    for (const [kind, value] of Object.entries(p.links)) this.links.delete(`${kind}:${value}`);
    if (p.username) this.usernames.delete(p.username.toLowerCase());
    if (p.email) this.emails.delete(p.email.toLowerCase());
    this.entities.delete(p.entityId);
    this.store.delete('players', p.id);
  }

  link(p, kind, value, forceLink) {
    const key = `${kind}:${value}`;
    const owner = this.links.get(key);
    if (owner && owner !== p.id) {
      if (!forceLink) throw fail('LinkedAccountAlreadyClaimed', `That ${kind} is already linked to another account.`);
      const other = this.byId(owner);
      if (other) {
        delete other.links[kind];
        this.save(other);
      }
    }
    if (p.links[kind] && p.links[kind] !== String(value)) {
      if (!forceLink) throw fail('AccountAlreadyLinked', `This account already has a ${kind} linked.`);
      this.links.delete(`${kind}:${p.links[kind]}`);
    }
    p.links[kind] = String(value);
    this.save(p);
  }

  unlink(p, kind) {
    const value = p.links[kind];
    if (value === undefined) throw fail('AccountNotLinked', `This account has no ${kind} linked.`);
    this.links.delete(`${kind}:${value}`);
    delete p.links[kind];
    this.save(p);
  }

  setUsername(p, username) {
    if (p.username) this.usernames.delete(p.username.toLowerCase());
    p.username = username;
  }

  setEmail(p, email) {
    if (p.email) this.emails.delete(p.email.toLowerCase());
    p.email = email;
  }
}

const titleAccount = (p) => ({ Id: p.entityId, Type: 'title_player_account', TypeString: 'title_player_account' });

function accountInfo(p) {
  const info = {
    PlayFabId: p.id,
    Created: p.created,
    Username: p.username || undefined,
    TitleInfo: {
      DisplayName: p.displayName || undefined,
      Origination: p.origination,
      Created: p.created,
      LastLogin: p.lastLogin || undefined,
      FirstLogin: p.firstLogin,
      isBanned: isBanned(p),
      AvatarUrl: p.avatarUrl || undefined,
      TitlePlayerAccount: titleAccount(p),
    },
    PrivateInfo: { Email: p.email || undefined },
  };
  if (p.links.CustomId !== undefined) info.CustomIdInfo = { CustomId: p.links.CustomId };
  if (p.links.AndroidDeviceId !== undefined) info.AndroidDeviceInfo = { AndroidDeviceId: p.links.AndroidDeviceId };
  if (p.links.IOSDeviceId !== undefined) info.IosDeviceInfo = { IosDeviceId: p.links.IOSDeviceId };
  if (p.links.Steam !== undefined) info.SteamInfo = { SteamId: p.links.Steam };
  if (p.links.Apple !== undefined) info.AppleAccountInfo = { AppleSubjectId: p.links.Apple };
  if (p.links.GameCenter !== undefined) info.GameCenterInfo = { GameCenterId: p.links.GameCenter };
  if (p.links.Kongregate !== undefined) info.KongregateInfo = { KongregateId: p.links.Kongregate };
  if (p.links.NintendoSwitchDeviceId !== undefined) info.NintendoSwitchDeviceIdInfo = { NintendoSwitchDeviceId: p.links.NintendoSwitchDeviceId };
  if (p.links.NintendoServiceAccount !== undefined) info.NintendoSwitchAccountInfo = { NintendoSwitchAccountSubjectId: p.links.NintendoServiceAccount };
  if (p.links.FacebookInstantGames !== undefined) info.FacebookInstantGamesIdInfo = { FacebookInstantGamesId: p.links.FacebookInstantGames };
  if (p.links.BattleNet !== undefined) info.BattleNetAccountInfo = { BattleNetAccountId: p.links.BattleNet };
  const openIds = Object.entries(p.links).filter(([k]) => k.startsWith('OpenId:'));
  if (openIds.length) {
    info.OpenIdInfo = openIds.map(([k, v]) => {
      const [Issuer, Subject] = v.split('\n');
      return { ConnectionId: k.slice('OpenId:'.length), Issuer, Subject };
    });
  }
  return info;
}

const LINKED_PLATFORM = {
  CustomId: 'Custom', AndroidDeviceId: 'AndroidDevice', IOSDeviceId: 'IOSDevice', Steam: 'Steam',
  ServerCustomId: 'CustomServer', Apple: 'Apple', GameCenter: 'GameCenter', Kongregate: 'Kongregate',
  NintendoSwitchDeviceId: 'NintendoSwitch', NintendoServiceAccount: 'NintendoSwitchAccount',
  FacebookInstantGames: 'FacebookInstantGames', BattleNet: 'BattleNet',
};
// UserOrigination names (account info) to LoginIdentityProvider names (profiles).
const PROVIDER = {
  Organic: 'PlayFab', CustomId: 'Custom', Android: 'AndroidDevice', IOS: 'IOSDevice', Steam: 'Steam',
  ServerCustomId: 'CustomServer', Apple: 'Apple', GameCenter: 'GameCenter', Kongregate: 'Kongregate',
  NintendoSwitchDeviceId: 'NintendoSwitch', NintendoSwitchAccount: 'NintendoSwitchAccount',
  FacebookInstantGamesId: 'FacebookInstantGames', BattleNet: 'BattleNet', OpenIdConnect: 'OpenIdConnect',
};

// PlayFab returns DisplayName, PlayerId, PublisherId and TitleId unless asked for more.
function profile(p, title, constraints) {
  const c = constraints || { ShowDisplayName: true };
  const out = { PlayerId: p.id, TitleId: title.titleId || undefined, PublisherId: title.publisherId || undefined };
  if (c.ShowDisplayName) out.DisplayName = p.displayName || undefined;
  if (c.ShowCreated) out.Created = p.created;
  if (c.ShowLastLogin) out.LastLogin = p.lastLogin || undefined;
  if (c.ShowOrigination) out.Origination = PROVIDER[p.origination] || 'Unknown';
  if (c.ShowAvatarUrl) out.AvatarUrl = p.avatarUrl || undefined;
  if (c.ShowTags) out.Tags = p.tags.map((t) => ({ TagValue: t }));
  if (c.ShowStatistics) {
    out.Statistics = Object.entries(p.stats).map(([Name, s]) => ({ Name, Value: s.value, Version: s.version }));
  }
  if (c.ShowContactEmailAddresses && p.contactEmail) {
    out.ContactEmailAddresses = [{ EmailAddress: p.contactEmail, Name: 'Primary', VerificationStatus: 'Unverified' }];
  }
  if (c.ShowLinkedAccounts) {
    out.LinkedAccounts = Object.entries(p.links)
      .filter(([kind]) => !kind.startsWith('Generic:'))
      .map(([kind, id]) => (kind.startsWith('OpenId:')
        ? { Platform: 'OpenIdConnect', PlatformUserId: id.split('\n')[1] }
        : { Platform: LINKED_PLATFORM[kind] || 'Custom', PlatformUserId: id }));
    if (p.username || p.email) out.LinkedAccounts.push({ Platform: 'PlayFab', Username: p.username || undefined, Email: p.email || undefined });
  }
  return out;
}

module.exports = { Players, accountInfo, profile, titleAccount, isBanned, DATA_KINDS, KINDS };
