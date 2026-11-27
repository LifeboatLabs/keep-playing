'use strict';
// Entity objects (small JSON saves attached to a player or the title) and
// entity profiles.

const { fail } = require('../errors');

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

module.exports = function register(on, app) {
  // Finds where an entity's objects live, and checks the caller may use them.
  function holder(entityKey, ctx, write) {
    const key = entityKey || ctx.entity;
    if (!key || typeof key.Id !== 'string') throw fail('InvalidParams', 'Invalid input parameters', 400, { Entity: ['The Entity field is required.'] });
    const type = key.Type || key.TypeString;
    if (type === 'title_player_account' || type === 'master_player_account') {
      const p = type === 'title_player_account' ? app.players.byEntity(key.Id) : app.players.byId(key.Id);
      if (!p) throw fail('ProfileDoesNotExist', `There is no ${type} ${key.Id}.`);
      const own = ctx.player && ctx.player.id === p.id;
      if (!own && !ctx.server && write) throw fail('NotAuthorized', 'Players can only change their own objects.', 403);
      const field = type === 'title_player_account' ? 'objects' : 'masterObjects';
      return {
        entity: { Id: type === 'title_player_account' ? p.entityId : p.id, Type: type, TypeString: type },
        get: () => (p[field] = p[field] || {}),
        version: () => p.profileVersion || 0,
        save: () => {
          p.profileVersion = (p.profileVersion || 0) + 1;
          app.players.save(p);
          return p.profileVersion;
        },
        player: p,
        type,
      };
    }
    if (type === 'title') {
      const t = app.title();
      if (write && !ctx.server) throw fail('NotAuthorized', 'Only the game itself can change title objects.', 403);
      return {
        entity: { Id: t.titleId || key.Id, Type: 'title', TypeString: 'title' },
        get: () => (t.objects = t.objects || {}),
        version: () => t.objectsVersion || 0,
        save: () => {
          t.objectsVersion = (t.objectsVersion || 0) + 1;
          app.saveTitle(t);
          return t.objectsVersion;
        },
        type,
      };
    }
    throw fail('NotImplemented', `Keep Playing doesn't support ${type || 'that kind of'} entities yet.`, 501);
  }

  const view = (objects, escape) => {
    const out = {};
    for (const [name, data] of Object.entries(objects)) {
      out[name] = escape ? { ObjectName: name, EscapedDataObject: JSON.stringify(data) } : { ObjectName: name, DataObject: clone(data) };
    }
    return out;
  };

  on('/Object/GetObjects', (body, ctx) => {
    const h = holder(body.Entity, ctx, false);
    return { Entity: h.entity, Objects: view(h.get(), !!body.EscapeObject), ProfileVersion: h.version() };
  });

  on('/Object/SetObjects', (body, ctx) => {
    const h = holder(body.Entity, ctx, true);
    if (typeof body.ExpectedProfileVersion === 'number' && body.ExpectedProfileVersion !== h.version()) {
      throw fail('EntityProfileVersionMismatch', `Expected version ${body.ExpectedProfileVersion}, but it's ${h.version()}.`, 409);
    }
    const objects = h.get();
    const results = [];
    for (const o of body.Objects || []) {
      const name = String(o.ObjectName);
      if (o.DeleteObject) {
        const existed = Object.prototype.hasOwnProperty.call(objects, name);
        delete objects[name];
        results.push({ ObjectName: name, SetResult: existed ? 'Deleted' : 'None' });
        continue;
      }
      let value = o.DataObject;
      if (value === undefined && typeof o.EscapedDataObject === 'string') {
        try {
          value = JSON.parse(o.EscapedDataObject);
        } catch (e) {
          throw fail('InvalidParams', 'Invalid input parameters', 400, { EscapedDataObject: [`${name} isn't valid JSON.`] });
        }
      }
      const existed = Object.prototype.hasOwnProperty.call(objects, name);
      const same = existed && JSON.stringify(objects[name]) === JSON.stringify(value);
      objects[name] = clone(value === undefined ? null : value);
      results.push({ ObjectName: name, SetResult: same ? 'None' : existed ? 'Updated' : 'Created' });
    }
    return { ProfileVersion: h.save(), SetResults: results };
  });

  // Entity profiles.
  function profileBody(h, ctx, asObject) {
    const t = app.title();
    const p = h.player;
    const lineage = { TitleId: t.titleId || undefined, NamespaceId: t.titleId || undefined };
    if (p) {
      lineage.MasterPlayerAccountId = p.id;
      if (h.type === 'title_player_account') lineage.TitlePlayerAccountId = p.entityId;
    }
    const objects = {};
    for (const [name, data] of Object.entries(h.get())) {
      objects[name] = asObject ? { ObjectName: name, DataObject: clone(data) } : { ObjectName: name, EscapedDataObject: JSON.stringify(data) };
    }
    return {
      Entity: h.entity,
      EntityChain: p ? `${h.type}!${h.entity.Id}` : `title!${h.entity.Id}`,
      Created: p ? p.created : new Date(0).toISOString(),
      DisplayName: p ? p.displayName || undefined : undefined,
      AvatarUrl: p ? p.avatarUrl || undefined : undefined,
      Language: p ? p.language || undefined : undefined,
      Lineage: lineage,
      Objects: objects,
      Files: {},
      VersionNumber: h.version(),
    };
  }

  on('/Profile/GetProfile', (body, ctx) => ({ Profile: profileBody(holder(body.Entity, ctx, false), ctx, !!body.DataAsObject) }));
  on('/Profile/GetProfiles', (body, ctx) => ({
    Profiles: (body.Entities || []).map((e) => profileBody(holder(e, ctx, false), ctx, !!body.DataAsObject)),
  }));

  on('/Profile/GetTitlePlayersFromMasterPlayerAccountIds', (body) => {
    const accounts = {};
    for (const id of body.MasterPlayerAccountIds || []) {
      const p = app.players.byId(id);
      if (p) accounts[id] = { Id: p.entityId, Type: 'title_player_account', TypeString: 'title_player_account' };
    }
    return { TitleId: app.title().titleId || body.TitleId || undefined, TitlePlayerAccounts: accounts };
  });

  on('/Profile/SetProfileLanguage', (body, ctx) => {
    const h = holder(body.Entity, ctx, true);
    if (!h.player) throw fail('NotImplemented', 'Only players have a language here.', 501);
    if (typeof body.ExpectedVersion === 'number' && body.ExpectedVersion !== h.version()) {
      throw fail('EntityProfileVersionMismatch', `Expected version ${body.ExpectedVersion}, but it's ${h.version()}.`, 409);
    }
    if ((h.player.language || null) === (body.Language || null)) return { OperationResult: 'None', VersionNumber: h.version() };
    h.player.language = body.Language || null;
    return { OperationResult: 'Updated', VersionNumber: h.save() };
  });

  on('/Profile/SetDisplayName', (body, ctx) => {
    const h = holder(body.Entity, ctx, true);
    if (!h.player) throw fail('NotImplemented', 'Only players have a display name here.', 501);
    const name = String(body.DisplayName || '');
    if (name.length < 3 || name.length > 25) {
      throw fail('InvalidParams', 'Invalid input parameters', 400, { DisplayName: ['DisplayName must be between 3 and 25 characters.'] });
    }
    if (typeof body.ExpectedVersion === 'number' && body.ExpectedVersion !== h.version()) {
      throw fail('EntityProfileVersionMismatch', `Expected version ${body.ExpectedVersion}, but it's ${h.version()}.`, 409);
    }
    h.player.displayName = name;
    return { OperationResult: 'Updated', VersionNumber: h.save() };
  });
};
