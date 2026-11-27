'use strict';
// Accounts, profiles, display names, friends, tags, bans and news.

const { fail } = require('../errors');
const { targetPlayer } = require('./common');
const { hexId } = require('../tokens');
const tokens = require('../tokens');
const { accountInfo, profile } = require('../players');
const { combinedInfo } = require('./combined');

module.exports = function register(on, app) {
  const target = (body, ctx) => targetPlayer(app, body, ctx);

  // What other players may see of an account.
  const publicInfo = (p) => {
    const info = accountInfo(p);
    delete info.PrivateInfo;
    delete info.CustomIdInfo;
    delete info.AndroidDeviceInfo;
    delete info.IosDeviceInfo;
    return info;
  };

  on('/Client/GetAccountInfo', (body, ctx) => {
    let p = ctx.player;
    if (body.PlayFabId) p = app.players.byId(body.PlayFabId);
    else if (body.Username) p = app.players.byUsername(body.Username);
    else if (body.Email) p = app.players.byEmail(body.Email);
    else if (body.TitleDisplayName) p = [...app.players.all()].find((x) => x.displayName === body.TitleDisplayName) || null;
    if (!p) throw fail('AccountNotFound', 'User not found');
    return { AccountInfo: p.id === ctx.player.id ? accountInfo(p) : publicInfo(p) };
  });

  const getUserAccountInfo = (body, ctx) => ({ UserInfo: accountInfo(target(body, ctx)) });
  on('/Server/GetUserAccountInfo', getUserAccountInfo);
  on('/Admin/GetUserAccountInfo', getUserAccountInfo);

  const getProfile = (body, ctx) => ({ PlayerProfile: profile(target(body, ctx), ctx.title, body.ProfileConstraints) });
  for (const api of ['Client', 'Server', 'Admin']) on(`/${api}/GetPlayerProfile`, getProfile);

  const combined = (body, ctx) => {
    const p = target(body, ctx);
    const isSelf = ctx.server || ctx.player.id === p.id;
    return { PlayFabId: p.id, InfoResultPayload: combinedInfo(app, p, body.InfoRequestParameters, ctx, isSelf) };
  };
  on('/Client/GetPlayerCombinedInfo', combined);
  on('/Server/GetPlayerCombinedInfo', combined);

  const setDisplayName = (body, ctx) => {
    const p = target(body, ctx);
    const name = String(body.DisplayName);
    if (name.length < 3 || name.length > 25) {
      throw fail('InvalidParams', 'Invalid input parameters', 400, { DisplayName: ['DisplayName must be between 3 and 25 characters.'] });
    }
    p.displayName = name;
    app.players.save(p);
    return { DisplayName: name };
  };
  on('/Client/UpdateUserTitleDisplayName', (body, ctx) => setDisplayName({ ...body, PlayFabId: undefined }, ctx));
  on('/Admin/UpdateUserTitleDisplayName', setDisplayName);

  const setAvatar = (body, ctx) => {
    const p = target(body, ctx);
    p.avatarUrl = String(body.ImageUrl);
    app.players.save(p);
    return {};
  };
  on('/Client/UpdateAvatarUrl', (body, ctx) => setAvatar({ ...body, PlayFabId: undefined }, ctx));
  on('/Server/UpdateAvatarUrl', setAvatar);

  const setContactEmail = (body, ctx) => {
    const p = target(body, ctx);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.EmailAddress))) {
      throw fail('InvalidEmailAddress', 'That email address is not valid.');
    }
    p.contactEmail = String(body.EmailAddress);
    app.players.save(p);
    return {};
  };
  on('/Client/AddOrUpdateContactEmail', (body, ctx) => setContactEmail({ ...body, PlayFabId: undefined }, ctx));
  on('/Server/AddOrUpdateContactEmail', setContactEmail);
  on('/Client/RemoveContactEmail', (body, ctx) => {
    ctx.player.contactEmail = null;
    app.players.save(ctx.player);
    return {};
  });

  // The clock, which games use to stop players changing their own.
  const time = (body, ctx) => ({ Time: ctx.now.toISOString() });
  on('/Client/GetTime', time);
  on('/Server/GetTime', time);

  // News.
  const news = (body) => {
    const items = [...(app.title().news || [])].sort((a, b) => (a.Timestamp < b.Timestamp ? 1 : -1));
    const count = Number.isInteger(body.Count) && body.Count > 0 ? body.Count : 10;
    return { News: items.slice(0, count).map((n) => ({ NewsId: n.NewsId, Title: n.Title, Body: n.Body, Timestamp: n.Timestamp })) };
  };
  on('/Client/GetTitleNews', news);
  on('/Server/GetTitleNews', news);
  on('/Admin/AddNews', (body, ctx) => {
    const t = app.title();
    const item = { NewsId: hexId(8), Title: body.Title, Body: body.Body, Timestamp: body.Timestamp || ctx.now.toISOString() };
    t.news = [...(t.news || []), item];
    app.saveTitle(t);
    return { NewsId: item.NewsId };
  });

  // Friends.
  function findFriend(body) {
    if (body.FriendPlayFabId) return app.players.byId(body.FriendPlayFabId);
    if (body.FriendUsername) return app.players.byUsername(body.FriendUsername);
    if (body.FriendEmail) return app.players.byEmail(body.FriendEmail);
    if (body.FriendTitleDisplayName) return [...app.players.all()].find((x) => x.displayName === body.FriendTitleDisplayName) || null;
    throw fail('InvalidParams', 'Invalid input parameters', 400, { FriendPlayFabId: ['Say who to add: FriendPlayFabId, FriendUsername, FriendEmail or FriendTitleDisplayName.'] });
  }
  const addFriend = (body, ctx) => {
    const p = target(body, ctx);
    const f = findFriend(body);
    if (!f) throw fail('AccountNotFound', 'User not found');
    if (f.id === p.id) throw fail('InvalidParams', 'Players can\'t add themselves as a friend.', 400);
    if (p.friends.includes(f.id)) throw fail('UsersAlreadyFriends', 'Those players are already friends.');
    p.friends.push(f.id);
    app.players.save(p);
    return { Created: true };
  };
  const removeFriend = (body, ctx) => {
    const p = target(body, ctx);
    if (!p.friends.includes(body.FriendPlayFabId)) throw fail('UserNotFriend', 'Those players aren\'t friends.');
    p.friends = p.friends.filter((id) => id !== body.FriendPlayFabId);
    if (p.friendTags) delete p.friendTags[body.FriendPlayFabId];
    app.players.save(p);
    return {};
  };
  const friendsList = (body, ctx) => {
    const p = target(body, ctx);
    const friends = [];
    for (const id of p.friends) {
      const f = app.players.byId(id);
      if (!f) continue;
      friends.push({
        FriendPlayFabId: f.id,
        Username: f.username || undefined,
        TitleDisplayName: f.displayName || undefined,
        Tags: (p.friendTags && p.friendTags[f.id]) || undefined,
        Profile: profile(f, ctx.title, body.ProfileConstraints),
        SteamInfo: f.links.Steam !== undefined ? { SteamId: f.links.Steam } : undefined,
      });
    }
    return { Friends: friends };
  };
  const friendTags = (body, ctx) => {
    const p = target(body, ctx);
    if (!p.friends.includes(body.FriendPlayFabId)) throw fail('UserNotFriend', 'Those players aren\'t friends.');
    p.friendTags = p.friendTags || {};
    p.friendTags[body.FriendPlayFabId] = (body.Tags || []).map(String);
    app.players.save(p);
    return {};
  };
  on('/Client/AddFriend', (body, ctx) => addFriend({ ...body, PlayFabId: undefined }, ctx));
  on('/Client/RemoveFriend', (body, ctx) => removeFriend({ ...body, PlayFabId: undefined }, ctx));
  on('/Client/GetFriendsList', (body, ctx) => friendsList({ ...body, PlayFabId: undefined }, ctx));
  on('/Client/SetFriendTags', (body, ctx) => friendTags({ ...body, PlayFabId: undefined }, ctx));
  on('/Server/AddFriend', (body, ctx) => {
    addFriend(body, ctx);
    return {}; // the Server version answers with an empty result
  });
  on('/Server/RemoveFriend', removeFriend);
  on('/Server/GetFriendsList', friendsList);
  on('/Server/SetFriendTags', friendTags);

  const steamIds = (body) => {
    const ids = [...(body.SteamStringIDs || []), ...(body.SteamIDs || []).map(String)];
    return {
      Data: ids.map((id) => {
        const p = app.players.byLink('Steam', String(id));
        return { SteamStringId: String(id), PlayFabId: p ? p.id : undefined };
      }),
    };
  };
  on('/Client/GetPlayFabIDsFromSteamIDs', steamIds);
  on('/Server/GetPlayFabIDsFromSteamIDs', steamIds);

  // Tags.
  const getTags = (body, ctx) => {
    const p = target(body, ctx);
    const ns = body.Namespace ? `title.${ctx.title.titleId}.` : '';
    return { PlayFabId: p.id, Tags: p.tags.map((t) => ns + t) };
  };
  const addTag = (body, ctx) => {
    const p = target(body, ctx);
    const tag = String(body.TagName);
    if (!p.tags.includes(tag)) p.tags.push(tag);
    app.players.save(p);
    return {};
  };
  const removeTag = (body, ctx) => {
    const p = target(body, ctx);
    p.tags = p.tags.filter((t) => t !== String(body.TagName));
    app.players.save(p);
    return {};
  };
  on('/Client/GetPlayerTags', getTags);
  for (const api of ['Server', 'Admin']) {
    on(`/${api}/GetPlayerTags`, getTags);
    on(`/${api}/AddPlayerTag`, addTag);
    on(`/${api}/RemovePlayerTag`, removeTag);
  }

  // Bans.
  const banView = (p, b, now) => ({
    BanId: b.BanId,
    PlayFabId: p.id,
    Created: b.Created,
    Expires: b.Expires || undefined,
    Reason: b.Reason || undefined,
    Active: b.Active && (!b.Expires || new Date(b.Expires) > now),
  });
  const banUsers = (body, ctx) => {
    const out = [];
    for (const req of body.Bans) {
      const p = app.players.byId(req.PlayFabId);
      if (!p) throw fail('AccountNotFound', `User ${req.PlayFabId} not found`);
      const ban = {
        BanId: hexId(8),
        Created: ctx.now.toISOString(),
        Expires: req.DurationInHours ? new Date(ctx.now.getTime() + req.DurationInHours * 3600000).toISOString() : null,
        Reason: req.Reason || null,
        Active: true,
      };
      p.bans = [...(p.bans || []), ban];
      app.players.save(p);
      out.push(banView(p, ban, ctx.now));
    }
    return { BanData: out };
  };
  const getBans = (body, ctx) => {
    const p = target(body, ctx);
    return { BanData: (p.bans || []).map((b) => banView(p, b, ctx.now)) };
  };
  const revokeAll = (body, ctx) => {
    const p = target(body, ctx);
    const revoked = [];
    for (const b of p.bans || []) {
      if (b.Active) {
        b.Active = false;
        revoked.push(banView(p, b, ctx.now));
      }
    }
    app.players.save(p);
    return { BanData: revoked };
  };
  for (const api of ['Server', 'Admin']) {
    on(`/${api}/BanUsers`, banUsers);
    on(`/${api}/GetUserBans`, getBans);
    on(`/${api}/RevokeAllBansForUser`, revokeAll);
  }

  // Game servers checking who a player is.
  on('/Server/AuthenticateSessionTicket', (body, ctx) => {
    const t = tokens.readSessionTicket(app.keys.serverKey, body.SessionTicket, ctx.now);
    if (!t) throw fail('InvalidSessionTicket', 'That session ticket is not valid.');
    if (t.expired) return { IsSessionTicketExpired: true };
    const p = app.players.byId(t.playFabId);
    if (!p) throw fail('InvalidSessionTicket', 'The account for that session ticket no longer exists.');
    return { IsSessionTicketExpired: false, UserInfo: accountInfo(p) };
  });

  const deletePlayer = (body, ctx) => {
    const p = target(body, ctx);
    app.files.removePlayer(p);
    app.players.remove(p);
    for (const other of app.players.all()) {
      if (other.friends.includes(p.id)) {
        other.friends = other.friends.filter((id) => id !== p.id);
        app.players.save(other);
      }
    }
    return {};
  };
  on('/Server/DeletePlayer', deletePlayer);
  on('/Admin/DeletePlayer', deletePlayer);
};
