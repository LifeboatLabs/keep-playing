'use strict';
// IDs, session tickets and entity tokens. Tickets and tokens are signed with a
// key that never leaves the server, so they can't be forged or edited.

const crypto = require('node:crypto');

const DAY_MS = 24 * 60 * 60 * 1000;

const hexId = (bytes = 8) => crypto.randomBytes(bytes).toString('hex').toUpperCase();

function mac(key, text) {
  return crypto.createHmac('sha256', key).update(text).digest('hex').slice(0, 32);
}

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Session tickets go in the X-Authorization header of Client calls.
// Shape: PLAYFABID-ENTITYID-ISSUEDHEX-SIGNATURE (PlayFab's are dash-separated too).
function sessionTicket(key, playFabId, entityId, now) {
  const issued = now.getTime().toString(16).toUpperCase();
  const body = `${playFabId}-${entityId}-${issued}`;
  return `${body}-${mac(key, 'ticket:' + body)}`;
}

function readSessionTicket(key, ticket, now) {
  if (typeof ticket !== 'string') return null;
  const parts = ticket.split('-');
  if (parts.length !== 4) return null;
  const [playFabId, entityId, issuedHex, sig] = parts;
  if (!sameText(sig, mac(key, `ticket:${playFabId}-${entityId}-${issuedHex}`))) return null;
  const issued = parseInt(issuedHex, 16);
  if (!Number.isFinite(issued) || now.getTime() - issued > DAY_MS) return { expired: true };
  return { playFabId, entityId, issued: new Date(issued) };
}

// Entity tokens go in the X-EntityToken header of entity calls.
function entityToken(key, entity, now, ttlMs = DAY_MS) {
  const expires = now.getTime() + ttlMs;
  const body = Buffer.from(JSON.stringify({ t: entity.Type, i: entity.Id, x: expires })).toString('base64url');
  return { token: `${body}.${mac(key, 'entity:' + body)}`, expires: new Date(expires) };
}

function readEntityToken(key, token, now) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  if (!sameText(token.slice(dot + 1), mac(key, 'entity:' + body))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!data || typeof data.t !== 'string' || typeof data.i !== 'string') return null;
  if (now.getTime() > data.x) return { expired: true };
  return { Type: data.t, Id: data.i, expires: new Date(data.x) };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return { salt, hash };
}

function checkPassword(stored, password) {
  if (!stored || typeof password !== 'string') return false;
  const hash = crypto.scryptSync(password, stored.salt, 32).toString('hex');
  return sameText(hash, stored.hash);
}

module.exports = {
  hexId, sameText, sessionTicket, readSessionTicket, entityToken, readEntityToken, hashPassword, checkPassword,
};
