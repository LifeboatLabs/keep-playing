'use strict';
// Entity files: whole files (often save games) kept on a player or the title.
// On PlayFab a game asks to upload, sends the file straight to an address in
// Azure storage, then finalises it; downloads come from Azure too. Keep Playing
// hands out its own addresses under /files/ instead, signed so they can't be
// made up or changed, and keeps the files in the data folder.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('../errors');
const tokens = require('../tokens');
const { entityHolder, own } = require('./common');

// Our own limits, not PlayFab's (theirs depend on the plan).
const MAX_FILE = 64 * 1024 * 1024;
const UPLOAD_MS = 60 * 60 * 1000; // an upload address works for an hour
const DOWNLOAD_MS = 24 * 60 * 60 * 1000; // a download address for a day
const BLOB_ID = /^[0-9a-f]{32}$/;

module.exports = function register(on, app) {
  const dir = app.store.dir ? path.join(app.store.dir, 'files') : null;
  const memory = new Map(); // without a data folder (tests), files stay in memory
  const blobs = {
    write(id, buf) {
      if (!dir) return memory.set(id, buf);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, id), buf);
    },
    read(id) {
      if (!dir) return memory.get(id) || null;
      try {
        return fs.readFileSync(path.join(dir, id));
      } catch (e) {
        return null;
      }
    },
    remove(id) {
      if (!dir) return memory.delete(id);
      fs.rmSync(path.join(dir, id), { force: true });
    },
  };

  // Signed addresses: what they're for (put or get), which stored file, and
  // until when. Uploads also say whose file it is and its name.
  const sign = (text) => crypto.createHmac('sha256', app.keys.serverKey).update(`files:${text}`).digest('base64url');
  const base = (ctx) => ctx.origin || app.publicUrl || 'http://127.0.0.1:8080';
  function link(ctx, claims, ms) {
    const payload = Buffer.from(JSON.stringify({ ...claims, x: ctx.now.getTime() + ms })).toString('base64url');
    return `${base(ctx)}/files/${payload}.${sign(payload)}`;
  }
  function readLink(token, now) {
    const parts = String(token).split('.');
    if (parts.length !== 2 || !tokens.sameText(sign(parts[0]), parts[1])) return null;
    let claims;
    try {
      claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch (e) {
      return null;
    }
    if (!claims || typeof claims !== 'object' || typeof claims.b !== 'string' || !BLOB_ID.test(claims.b)) return null;
    if (typeof claims.x !== 'number' || claims.x < now.getTime()) return null;
    return claims;
  }

  const holder = (key, ctx, write) => entityHolder(app, key, ctx, write, 'files');
  // Finished files are in `done`, uploads that haven't been finalised in `pending`.
  const filesOf = (h) => {
    const s = h.get();
    s.done = s.done || {};
    s.pending = s.pending || {};
    return s;
  };
  const checkVersion = (h, v) => {
    if (typeof v === 'number' && v !== h.version()) {
      throw fail('EntityProfileVersionMismatch', `Expected version ${v}, but it's ${h.version()}.`, 409);
    }
  };
  const fileNames = (body) => {
    const names = [...new Set((Array.isArray(body.FileNames) ? body.FileNames : []).map(String))];
    if (!names.length || names.some((n) => !n.trim())) {
      throw fail('InvalidParams', 'Invalid input parameters', 400, { FileNames: ['Name at least one file, and no empty names.'] });
    }
    return names;
  };
  const metadata = (s, ctx) => {
    const out = {};
    for (const [name, f] of Object.entries(s.done)) {
      out[name] = { Checksum: f.checksum, DownloadUrl: link(ctx, { o: 'get', b: f.blob }, DOWNLOAD_MS), FileName: name, LastModified: f.at, Size: f.size };
    }
    return out;
  };
  const newBlob = () => crypto.randomBytes(16).toString('hex');

  // Starting an upload while the same file is still being uploaded fails until
  // it's finalised or aborted, like PlayFab. Uploads left over an hour are
  // forgotten, so a game that crashed mid-upload isn't stuck (that's our choice).
  on('/File/InitiateFileUploads', (body, ctx) => {
    const h = holder(body.Entity, ctx, true);
    checkVersion(h, body.ProfileVersion);
    const s = filesOf(h);
    const names = fileNames(body);
    const now = ctx.now.getTime();
    for (const n of names) {
      const p = own(s.pending, n);
      if (p && now - Date.parse(p.started) < UPLOAD_MS) {
        throw fail('EntityFileOperationPending', `${n} is already being uploaded. Finish it with FinalizeFileUploads, or stop it with AbortFileUploads.`);
      }
    }
    const stale = [];
    const details = names.map((n) => {
      const old = own(s.pending, n);
      if (old) stale.push(old.blob);
      const blob = newBlob();
      s.pending[n] = { blob, started: ctx.now.toISOString() };
      return { FileName: n, UploadUrl: link(ctx, { o: 'put', b: blob, t: h.type, i: h.entity.Id, n }, UPLOAD_MS) };
    });
    h.keep();
    stale.forEach((b) => blobs.remove(b));
    return { Entity: h.entity, ProfileVersion: h.version(), UploadDetails: details };
  });

  // FinalizeFileUploads requires a ProfileVersion, but Microsoft's own example
  // leaves it out (so it arrives as 0), so we don't check it here.
  on('/File/FinalizeFileUploads', (body, ctx) => {
    const h = holder(body.Entity, ctx, true);
    const s = filesOf(h);
    const names = fileNames(body);
    for (const n of names) {
      const p = own(s.pending, n);
      if (!p) throw fail('NoEntityFileOperationPending', `${n} isn't being uploaded. Start with InitiateFileUploads.`);
      // PlayFab's documentation doesn't say what happens here; this is our guess.
      if (typeof p.size !== 'number') throw fail('FileNotFound', `${n} hasn't arrived yet. Send it to the upload address first.`);
    }
    const replaced = [];
    for (const n of names) {
      const p = s.pending[n];
      const old = own(s.done, n);
      if (old) replaced.push(old.blob);
      s.done[n] = { blob: p.blob, size: p.size, checksum: p.checksum, at: p.at };
      delete s.pending[n];
    }
    const version = h.save();
    replaced.forEach((b) => blobs.remove(b));
    return { Entity: h.entity, Metadata: metadata(s, ctx), ProfileVersion: version };
  });

  on('/File/GetFiles', (body, ctx) => {
    const h = holder(body.Entity, ctx, false);
    return { Entity: h.entity, Metadata: metadata(filesOf(h), ctx), ProfileVersion: h.version() };
  });

  on('/File/DeleteFiles', (body, ctx) => {
    const h = holder(body.Entity, ctx, true);
    checkVersion(h, body.ProfileVersion);
    const s = filesOf(h);
    const names = fileNames(body);
    for (const n of names) if (!own(s.done, n)) throw fail('FileNotFound', `There is no file called ${n}.`);
    const gone = names.map((n) => s.done[n].blob);
    for (const n of names) delete s.done[n];
    const version = h.save();
    gone.forEach((b) => blobs.remove(b));
    return { Entity: h.entity, ProfileVersion: version };
  });

  on('/File/AbortFileUploads', (body, ctx) => {
    const h = holder(body.Entity, ctx, true);
    checkVersion(h, body.ProfileVersion);
    const s = filesOf(h);
    const names = fileNames(body);
    for (const n of names) if (!own(s.pending, n)) throw fail('NoEntityFileOperationPending', `${n} isn't being uploaded.`);
    const gone = names.map((n) => s.pending[n].blob);
    for (const n of names) delete s.pending[n];
    h.keep();
    gone.forEach((b) => blobs.remove(b));
    return { Entity: h.entity, ProfileVersion: h.version() };
  });

  async function readUpload(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_FILE * 4) req.destroy(); // far too big: stop listening
      if (size <= MAX_FILE) chunks.push(chunk);
    }
    return size > MAX_FILE ? null : Buffer.concat(chunks);
  }

  const answer = (status, text, headers = {}) => ({ status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers }, body: Buffer.from(text) });

  // The upload and download addresses. These answer like Azure storage would:
  // 201 for an upload, the file's bytes for a download. Returns what to send.
  async function http(req, token, query) {
    if (query.has('comp')) {
      app.warnOnce('blockuploads', 'a game tried to upload a file in blocks, which Keep Playing does not support yet.');
      return answer(501, 'Uploading in blocks is not supported yet. Send the whole file in one PUT.');
    }
    const claims = readLink(token, app.now());
    if (!claims) return answer(403, 'This address is not valid, or has run out. Ask the game for a new one.');

    if (req.method === 'GET') {
      if (claims.o !== 'get') return answer(403, 'This address is for uploading, not downloading.');
      const buf = blobs.read(claims.b);
      if (!buf) return answer(404, 'That file is no longer here.');
      const md5 = crypto.createHash('md5').update(buf).digest('base64');
      return { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-MD5': md5 }, body: buf };
    }

    if (claims.o !== 'put') return answer(403, 'This address is for downloading, not uploading.');
    const buf = await readUpload(req);
    if (!buf) return answer(413, `The file is too big. Keep Playing takes files up to ${MAX_FILE / 1024 / 1024} MB.`);
    let h;
    try {
      h = holder({ Id: claims.i, Type: claims.t }, { server: true }, true);
    } catch (e) {
      return answer(404, 'The player or title this file was for is gone.');
    }
    const s = filesOf(h);
    const p = own(s.pending, claims.n);
    if (!p || p.blob !== claims.b) return answer(404, 'This upload was finished or stopped. Ask the game to start again.');
    const md5 = crypto.createHash('md5').update(buf).digest('base64');
    blobs.write(claims.b, buf);
    // We keep an MD5 in base64, the way Azure storage reports one; PlayFab's
    // documentation doesn't say what its Checksum is.
    Object.assign(p, { size: buf.length, checksum: md5, at: app.now().toISOString() });
    h.keep();
    return answer(201, '', { 'Content-MD5': md5 });
  }

  // When a player is deleted, their files go too.
  function removePlayer(p) {
    for (const field of ['files', 'masterFiles']) {
      const s = p[field];
      if (!s) continue;
      for (const f of [...Object.values(s.done || {}), ...Object.values(s.pending || {})]) blobs.remove(f.blob);
    }
  }

  app.files = { http, removePlayer, MAX_FILE };
};
