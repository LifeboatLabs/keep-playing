'use strict';
// Groups: clans, guilds and teams. A group has roles, starting with "admins"
// and "members", and a player belongs to the group while they're in at least
// one role. Players join by applying (an admin accepts) or by being invited
// (they accept), and the game's server can add them directly. A group is an
// entity too, so it can have its own objects and files.
//
// PlayFab lets each title change what each role may do. Keep Playing uses the
// usual starting rules: the group's admins (and the game's server) may do
// everything; a member may always leave; anyone may look at a group and its
// members. Where PlayFab's documentation doesn't say, a comment says so.

const { fail } = require('../errors');
const { hexId } = require('../tokens');
const { own } = require('./common');

const OFFER_MS = 7 * 24 * 60 * 60 * 1000; // invitations and applications last a week: our guess
const ROLE_ID = /^[A-Za-z0-9()_.-]{1,64}$/;
const lower = (s) => String(s).toLowerCase();

module.exports = function register(on, app) {
  const store = app.store;
  const save = (g) => store.put('groups', g.id, g);
  const groupKey = (g) => ({ Id: g.id, Type: 'group', TypeString: 'group' });

  // ---- who's who

  // Members are players (title_player_account entities), kept by entity ID.
  function memberId(key) {
    if (!key || typeof key.Id !== 'string') {
      throw fail('InvalidParams', 'Invalid input parameters', 400, { Entity: ['The Entity field is required.'] });
    }
    const type = key.Type || key.TypeString;
    if (type === 'character') throw fail('NotImplemented', "Keep Playing can't put characters in groups yet.", 501);
    if (type !== 'title_player_account') {
      throw fail('InvalidEntityType', 'Only players (title_player_account) and characters can be in groups.');
    }
    const p = app.players.byEntity(key.Id);
    if (!p) throw fail('ProfileDoesNotExist', `There is no title_player_account ${key.Id}.`);
    return p.entityId;
  }
  // The entity a call is about: the one named, or else the caller.
  function subject(key, ctx) {
    if (key) return memberId(key);
    if (ctx.player) return ctx.player.entityId;
    throw fail('InvalidParams', 'Invalid input parameters', 400, { Entity: ['The Entity field is required.'] });
  }
  const callerId = (ctx) => (ctx.player ? ctx.player.entityId : null);
  // The entity itself, or a parent of it (its master account or the title).
  const selfOrTitle = (eid, ctx) => !!ctx.server || callerId(ctx) === eid;

  // As PlayFab shows them: the key, plus the master account in its lineage.
  function withLineage(eid) {
    const p = app.players.byEntity(eid);
    const Lineage = p ? { master_player_account: { Id: p.id, Type: 'master_player_account', TypeString: 'master_player_account' } } : {};
    return { Key: { Id: eid, Type: 'title_player_account', TypeString: 'title_player_account' }, Lineage };
  }
  function byWhom(id) {
    if (id !== 'title') return withLineage(id);
    return { Key: { Id: app.title().titleId || '', Type: 'title', TypeString: 'title' }, Lineage: {} };
  }

  // ---- groups and roles

  // Drops invitations and applications that have run out.
  function prune(g, nowMs) {
    const live = (o) => Date.parse(o.expires) > nowMs;
    g.invitations = g.invitations.filter(live);
    g.applications = g.applications.filter(live);
  }
  // We don't know which error PlayFab gives for a group that doesn't exist.
  function find(key, ctx) {
    const id = key && typeof key.Id === 'string' ? key.Id : null;
    const g = id ? store.get('groups', id) : null;
    if (!g) throw fail('ProfileDoesNotExist', `There is no group ${id}.`);
    prune(g, ((ctx && ctx.now) || app.now()).getTime());
    return g;
  }
  const all = (ctx) => [...store.values('groups')].map((g) => (prune(g, ctx.now.getTime()), g));
  const nameTaken = (name, except) => all({ now: app.now() }).some((g) => g !== except && lower(g.name) === lower(name));

  const role = (g, roleId) => own(g.roles, roleId);
  function needRole(g, roleId) {
    const r = role(g, roleId);
    if (!r) throw fail('RoleDoesNotExist', `The group has no role called ${roleId === undefined ? '(none given)' : roleId}.`);
    return r;
  }
  const rolesOf = (g, eid) => Object.keys(g.roles).filter((id) => g.roles[id].members.includes(eid));
  const isMember = (g, eid) => rolesOf(g, eid).length > 0;
  const isBlocked = (g, eid) => g.blocks.includes(eid);
  const isAdmin = (g, ctx) => {
    if (ctx.server) return true;
    const admins = role(g, g.adminRoleId);
    return !!(admins && callerId(ctx) && admins.members.includes(callerId(ctx)));
  };
  function mustManage(g, ctx) {
    if (!isAdmin(g, ctx)) throw fail('NotAuthorized', "Only the group's admins (or the game's server) can do that.", 403);
  }

  // Puts a player in a role, and clears their invitations and applications.
  function join(g, eid, roleId) {
    const r = needRole(g, roleId);
    if (!r.members.includes(eid)) r.members.push(eid);
    g.invitations = g.invitations.filter((i) => i.entity !== eid);
    g.applications = g.applications.filter((a) => a.entity !== eid);
  }
  function leave(g, eid, roleId) {
    for (const id of roleId === undefined ? Object.keys(g.roles) : [roleId]) {
      const r = g.roles[id];
      r.members = r.members.filter((m) => m !== eid);
    }
  }

  const info = (g) => ({
    AdminRoleId: g.adminRoleId,
    Created: g.created,
    Group: groupKey(g),
    GroupName: g.name,
    MemberRoleId: g.memberRoleId,
    ProfileVersion: g.profileVersion,
    Roles: Object.fromEntries(Object.entries(g.roles).map(([id, r]) => [id, r.name])),
  });
  const invitation = (g, i) => ({
    Expires: i.expires, Group: groupKey(g), InvitedByEntity: byWhom(i.invitedBy), InvitedEntity: withLineage(i.entity), RoleId: i.roleId,
  });
  const application = (g, a) => ({ Entity: withLineage(a.entity), Expires: a.expires, Group: groupKey(g) });

  // The group's profile version counts changes to the group itself (its name,
  // roles, objects and files), not to who's in it: our reading.
  const changed = (g) => {
    g.profileVersion += 1;
    save(g);
  };
  const tooOld = (g, expected) => typeof expected === 'number' && expected !== g.profileVersion;
  const unchanged = (g, reason) => ({ OperationReason: reason, ProfileVersion: g.profileVersion, SetResult: 'None' });

  // ---- the group itself

  on('/Group/CreateGroup', (body, ctx) => {
    const name = String(body.GroupName);
    if (!name.trim()) throw fail('InvalidParams', 'Invalid input parameters', 400, { GroupName: ['The GroupName field is required.'] });
    // Names are unique in the title. We also count different capitals as the same name.
    if (nameTaken(name)) throw fail('GroupNameNotAvailable', `There's already a group called ${name}.`);
    const named = body.Entity && (body.Entity.Type || body.Entity.TypeString) !== 'title';
    const creator = named ? memberId(body.Entity) : callerId(ctx);
    if (creator && !selfOrTitle(creator, ctx)) throw fail('NotAuthorized', 'Players can only create groups for themselves.', 403);
    let id = hexId(8);
    while (store.has('groups', id)) id = hexId(8);
    // The creator goes into the admin role, as in PlayFab's default group template.
    const g = {
      id,
      name,
      created: ctx.now.toISOString(),
      adminRoleId: 'admins',
      memberRoleId: 'members',
      roles: { admins: { name: 'Administrators', members: creator ? [creator] : [] }, members: { name: 'Members', members: [] } },
      invitations: [],
      applications: [],
      blocks: [],
      profileVersion: 0,
    };
    save(g);
    return info(g);
  });

  on('/Group/GetGroup', (body, ctx) => {
    if (body.Group) return info(find(body.Group, ctx));
    if (typeof body.GroupName !== 'string') {
      throw fail('InvalidParams', 'Invalid input parameters', 400, { Group: ['Give the Group or its GroupName.'] });
    }
    const g = all(ctx).find((x) => x.name === body.GroupName) || all(ctx).find((x) => lower(x.name) === lower(body.GroupName));
    if (!g) throw fail('ProfileDoesNotExist', `There is no group called ${body.GroupName}.`);
    return info(g);
  });

  // Deleting a group deletes its roles, invitations, applications, blocks, objects and files.
  on('/Group/DeleteGroup', (body, ctx) => {
    const g = find(body.Group, ctx);
    mustManage(g, ctx);
    store.delete('groups', g.id);
    app.files.removeAll(g);
    return {};
  });

  // Only the game's server may change which role is the admin role.
  // A version that's out of date isn't an error: nothing changes and SetResult is None.
  on('/Group/UpdateGroup', (body, ctx) => {
    const g = find(body.Group, ctx);
    mustManage(g, ctx);
    if (body.AdminRoleId !== undefined && !ctx.server) {
      throw fail('NotAuthorized', "Only the game's server can change a group's admin role.", 403);
    }
    if (tooOld(g, body.ExpectedProfileVersion)) return unchanged(g, 'The group has changed since that version.');
    if (body.AdminRoleId !== undefined) needRole(g, body.AdminRoleId);
    if (body.MemberRoleId !== undefined) needRole(g, body.MemberRoleId);
    if (body.GroupName !== undefined && nameTaken(body.GroupName, g)) {
      throw fail('GroupNameNotAvailable', `There's already a group called ${body.GroupName}.`);
    }
    const next = {
      name: body.GroupName !== undefined ? String(body.GroupName) : g.name,
      adminRoleId: body.AdminRoleId !== undefined ? body.AdminRoleId : g.adminRoleId,
      memberRoleId: body.MemberRoleId !== undefined ? body.MemberRoleId : g.memberRoleId,
    };
    if (next.name === g.name && next.adminRoleId === g.adminRoleId && next.memberRoleId === g.memberRoleId) {
      return unchanged(g, 'Nothing was different.');
    }
    Object.assign(g, next);
    changed(g);
    return { ProfileVersion: g.profileVersion, SetResult: 'Updated' };
  });

  // ---- roles

  const roleNameTaken = (g, name, except) => Object.entries(g.roles).some(([id, r]) => id !== except && lower(r.name) === lower(name));

  on('/Group/CreateRole', (body, ctx) => {
    const g = find(body.Group, ctx);
    mustManage(g, ctx);
    const id = String(body.RoleId);
    const name = String(body.RoleName);
    if (!ROLE_ID.test(id)) {
      throw fail('InvalidParams', 'Invalid input parameters', 400, { RoleId: ["A role ID is 1 to 64 letters, digits, or ( ) _ - ."] });
    }
    if (name.length < 1 || name.length > 100) {
      throw fail('InvalidParams', 'Invalid input parameters', 400, { RoleName: ['A role name is 1 to 100 characters.'] });
    }
    if (role(g, id)) throw fail('DuplicateRoleId', `The group already has a role called ${id}.`);
    if (roleNameTaken(g, name)) throw fail('RoleNameNotAvailable', `Another role is already called ${name}.`);
    g.roles[id] = { name, members: [] };
    changed(g);
    return { ProfileVersion: g.profileVersion, RoleId: id, RoleName: name };
  });

  on('/Group/UpdateRole', (body, ctx) => {
    const g = find(body.Group, ctx);
    mustManage(g, ctx);
    const r = needRole(g, body.RoleId);
    if (tooOld(g, body.ExpectedProfileVersion)) return unchanged(g, 'The group has changed since that version.');
    const name = String(body.RoleName);
    if (name.length < 1 || name.length > 100) {
      throw fail('InvalidParams', 'Invalid input parameters', 400, { RoleName: ['A role name is 1 to 100 characters.'] });
    }
    if (name === r.name) return unchanged(g, 'Nothing was different.');
    if (roleNameTaken(g, name, body.RoleId)) throw fail('RoleNameNotAvailable', `Another role is already called ${name}.`);
    r.name = name;
    changed(g);
    return { ProfileVersion: g.profileVersion, SetResult: 'Updated' };
  });

  // Anyone only in the deleted role is no longer in the group: our reading.
  on('/Group/DeleteRole', (body, ctx) => {
    const g = find(body.Group, ctx);
    mustManage(g, ctx);
    needRole(g, body.RoleId);
    if (body.RoleId === g.adminRoleId) throw fail('RoleIsGroupAdmin', "The admin role can't be deleted.");
    if (body.RoleId === g.memberRoleId) throw fail('RoleIsGroupDefaultMember', "The default member role can't be deleted.");
    delete g.roles[body.RoleId];
    changed(g);
    return {};
  });

  // ---- members

  // Existing members can be put in more roles by admins; only the game's
  // server can add someone who isn't in the group yet.
  on('/Group/AddMembers', (body, ctx) => {
    const g = find(body.Group, ctx);
    const roleId = body.RoleId !== undefined ? body.RoleId : g.memberRoleId;
    needRole(g, roleId);
    const ids = (body.Members || []).map(memberId);
    for (const eid of ids) {
      if (!isMember(g, eid) && !ctx.server) {
        throw fail('NotAuthorized', "Only the game's server can add new members. Players join by applying or being invited.", 403);
      }
    }
    mustManage(g, ctx);
    for (const eid of ids) join(g, eid, roleId);
    save(g);
    return {};
  });

  // Anyone may remove themselves; removing others is for admins.
  on('/Group/RemoveMembers', (body, ctx) => {
    const g = find(body.Group, ctx);
    if (body.RoleId !== undefined) needRole(g, body.RoleId);
    const ids = (body.Members || []).map(memberId);
    if (ids.some((eid) => eid !== callerId(ctx))) mustManage(g, ctx);
    for (const eid of ids) leave(g, eid, body.RoleId);
    save(g);
    return {};
  });

  on('/Group/ChangeMemberRole', (body, ctx) => {
    const g = find(body.Group, ctx);
    mustManage(g, ctx);
    const from = needRole(g, body.OriginRoleId);
    const toId = body.DestinationRoleId !== undefined ? body.DestinationRoleId : g.memberRoleId;
    needRole(g, toId);
    const ids = (body.Members || []).map(memberId);
    // The error for someone not in the origin role is our guess.
    for (const eid of ids) {
      if (!from.members.includes(eid)) throw fail('EntityIsNotAMember', `${eid} isn't in the role ${body.OriginRoleId}.`);
    }
    if (toId !== body.OriginRoleId) {
      for (const eid of ids) {
        join(g, eid, toId);
        leave(g, eid, body.OriginRoleId);
      }
    }
    save(g);
    return {};
  });

  // PlayFab checks whether the caller may see each role; with the usual
  // starting rules everyone can, so we show all of them.
  on('/Group/ListGroupMembers', (body, ctx) => {
    const g = find(body.Group, ctx);
    return {
      Members: Object.entries(g.roles).map(([id, r]) => ({
        Members: r.members.filter((eid) => app.players.byEntity(eid)).map(withLineage),
        RoleId: id,
        RoleName: r.name,
      })),
    };
  });

  on('/Group/IsMember', (body, ctx) => {
    const g = find(body.Group, ctx);
    const eid = memberId(body.Entity);
    if (body.RoleId !== undefined) return { IsMember: needRole(g, body.RoleId).members.includes(eid) };
    return { IsMember: isMember(g, eid) };
  });

  on('/Group/ListMembership', (body, ctx) => {
    const eid = subject(body.Entity, ctx);
    const Groups = all(ctx)
      .filter((g) => isMember(g, eid))
      .map((g) => ({
        Group: groupKey(g),
        GroupName: g.name,
        ProfileVersion: g.profileVersion,
        Roles: rolesOf(g, eid).map((id) => ({ RoleId: id, RoleName: g.roles[id].name })),
      }));
    return { Groups };
  });

  // ---- invitations and applications

  // If the player has already applied, inviting them accepts the application
  // instead and answers with an error that says so, as PlayFab does. Inviting
  // someone already invited gives back the same invitation (our reading).
  on('/Group/InviteToGroup', (body, ctx) => {
    const g = find(body.Group, ctx);
    mustManage(g, ctx);
    const eid = memberId(body.Entity);
    const roleId = body.RoleId !== undefined ? body.RoleId : g.memberRoleId;
    needRole(g, roleId);
    if (isBlocked(g, eid)) throw fail('EntityBlockedByGroup', 'That player is blocked from this group.');
    if (isMember(g, eid)) throw fail('EntityIsAlreadyMember', 'That player is already in the group.');
    if (body.AutoAcceptOutstandingApplication !== false && g.applications.some((a) => a.entity === eid)) {
      join(g, eid, roleId);
      save(g);
      throw fail('OutstandingApplicationAcceptedInstead', 'The player had already applied, so they have joined the group instead.');
    }
    let inv = g.invitations.find((i) => i.entity === eid);
    if (!inv) {
      inv = { entity: eid, roleId, invitedBy: callerId(ctx) || 'title', expires: new Date(ctx.now.getTime() + OFFER_MS).toISOString() };
      g.invitations.push(inv);
      save(g);
    }
    return invitation(g, inv);
  });

  on('/Group/AcceptGroupInvitation', (body, ctx) => {
    const g = find(body.Group, ctx);
    const eid = subject(body.Entity, ctx);
    if (!selfOrTitle(eid, ctx)) throw fail('NotAuthorized', 'Only the invited player can accept an invitation.', 403);
    const inv = g.invitations.find((i) => i.entity === eid);
    if (!inv) throw fail('GroupInvitationNotFound', "There's no invitation to this group for that player.");
    if (isBlocked(g, eid)) throw fail('EntityBlockedByGroup', 'That player is blocked from this group.');
    if (isMember(g, eid)) throw fail('EntityIsAlreadyMember', 'That player is already in the group.');
    join(g, eid, inv.roleId);
    save(g);
    return {};
  });

  // Applying again gives back the same application, without more time. If the
  // player was invited, applying accepts the invitation instead and answers
  // with an error that says so.
  on('/Group/ApplyToGroup', (body, ctx) => {
    const g = find(body.Group, ctx);
    const eid = subject(body.Entity, ctx);
    if (!selfOrTitle(eid, ctx)) throw fail('NotAuthorized', 'Players can only apply for themselves.', 403);
    if (isBlocked(g, eid)) throw fail('EntityBlockedByGroup', 'That player is blocked from this group.');
    if (isMember(g, eid)) throw fail('EntityIsAlreadyMember', 'That player is already in the group.');
    const inv = g.invitations.find((i) => i.entity === eid);
    if (inv && body.AutoAcceptOutstandingInvite !== false) {
      join(g, eid, inv.roleId);
      save(g);
      throw fail('OutstandingInvitationAcceptedInstead', 'The player had been invited, so they have joined the group instead.');
    }
    let a = g.applications.find((x) => x.entity === eid);
    if (!a) {
      a = { entity: eid, expires: new Date(ctx.now.getTime() + OFFER_MS).toISOString() };
      g.applications.push(a);
      save(g);
    }
    return application(g, a);
  });

  on('/Group/AcceptGroupApplication', (body, ctx) => {
    const g = find(body.Group, ctx);
    mustManage(g, ctx);
    const eid = memberId(body.Entity);
    if (!g.applications.some((a) => a.entity === eid)) throw fail('GroupApplicationNotFound', "That player hasn't applied to this group.");
    if (isBlocked(g, eid)) throw fail('EntityBlockedByGroup', 'That player is blocked from this group.');
    if (isMember(g, eid)) throw fail('EntityIsAlreadyMember', 'That player is already in the group.');
    join(g, eid, g.memberRoleId);
    save(g);
    return {};
  });

  // Both of these are for saying no: by the player, or by the group's admins.
  on('/Group/RemoveGroupApplication', (body, ctx) => {
    const g = find(body.Group, ctx);
    const eid = memberId(body.Entity);
    if (!selfOrTitle(eid, ctx)) mustManage(g, ctx);
    if (!g.applications.some((a) => a.entity === eid)) throw fail('GroupApplicationNotFound', "That player hasn't applied to this group.");
    g.applications = g.applications.filter((a) => a.entity !== eid);
    save(g);
    return {};
  });

  on('/Group/RemoveGroupInvitation', (body, ctx) => {
    const g = find(body.Group, ctx);
    const eid = memberId(body.Entity);
    if (!selfOrTitle(eid, ctx)) mustManage(g, ctx);
    if (!g.invitations.some((i) => i.entity === eid)) throw fail('GroupInvitationNotFound', "There's no invitation to this group for that player.");
    g.invitations = g.invitations.filter((i) => i.entity !== eid);
    save(g);
    return {};
  });

  on('/Group/ListGroupApplications', (body, ctx) => {
    const g = find(body.Group, ctx);
    mustManage(g, ctx);
    return { Applications: g.applications.map((a) => application(g, a)) };
  });

  on('/Group/ListGroupInvitations', (body, ctx) => {
    const g = find(body.Group, ctx);
    mustManage(g, ctx);
    return { Invitations: g.invitations.map((i) => invitation(g, i)) };
  });

  // Anyone may ask, but only the player (or the game's server) gets an answer.
  on('/Group/ListMembershipOpportunities', (body, ctx) => {
    const eid = subject(body.Entity, ctx);
    if (!selfOrTitle(eid, ctx)) return { Applications: [], Invitations: [] };
    const Applications = [];
    const Invitations = [];
    for (const g of all(ctx)) {
      for (const a of g.applications) if (a.entity === eid) Applications.push(application(g, a));
      for (const i of g.invitations) if (i.entity === eid) Invitations.push(invitation(g, i));
    }
    return { Applications, Invitations };
  });

  // ---- blocks

  // Blocking stops new applications and invitations, and stops old ones being
  // accepted. It doesn't remove a player who's already in the group: our reading.
  on('/Group/BlockEntity', (body, ctx) => {
    const g = find(body.Group, ctx);
    mustManage(g, ctx);
    const eid = memberId(body.Entity);
    if (!g.blocks.includes(eid)) g.blocks.push(eid);
    save(g);
    return {};
  });

  on('/Group/UnblockEntity', (body, ctx) => {
    const g = find(body.Group, ctx);
    mustManage(g, ctx);
    const eid = memberId(body.Entity);
    g.blocks = g.blocks.filter((b) => b !== eid);
    save(g);
    return {};
  });

  on('/Group/ListGroupBlocks', (body, ctx) => {
    const g = find(body.Group, ctx);
    mustManage(g, ctx);
    return { BlockedEntities: g.blocks.map((eid) => ({ Entity: withLineage(eid), Group: groupKey(g) })) };
  });

  // When a player is deleted, they leave every group.
  function removePlayer(p) {
    for (const g of [...store.values('groups')]) {
      const touched = rolesOf(g, p.entityId).length || g.blocks.includes(p.entityId)
        || g.invitations.some((i) => i.entity === p.entityId) || g.applications.some((a) => a.entity === p.entityId);
      if (!touched) continue;
      leave(g, p.entityId);
      g.blocks = g.blocks.filter((b) => b !== p.entityId);
      g.invitations = g.invitations.filter((i) => i.entity !== p.entityId);
      g.applications = g.applications.filter((a) => a.entity !== p.entityId);
      save(g);
    }
  }

  // For entity objects and files on a group.
  app.groups = { find, canManage: isAdmin, save, removePlayer };
};
