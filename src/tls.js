'use strict';
// HTTPS for games that won't talk plain http (most Unreal games, for one).
//
// Keep Playing makes its own certificate, with nothing but Node's crypto, and
// keeps it in the data folder. It's only for this computer's own addresses
// (localhost, 127.0.0.1 and ::1), and it says it can't vouch for anything else
// (it isn't a certificate authority), so telling Windows or a game to trust it
// can't be used against any other website.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VALID_DAYS = 397; // the longest browsers accept for a server certificate
const RENEW_DAYS = 30;

// ---- just enough DER (the binary format certificates are written in)

function length(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), length(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const octets = (buf) => tlv(0x04, buf);
const bits = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const explicit = (n, body) => tlv(0xa0 + n, body);

function integer(buf) {
  let b = buf;
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

function oid(dotted) {
  const parts = dotted.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const p of parts.slice(2)) {
    const groups = [p % 128];
    for (let v = Math.floor(p / 128); v > 0; v = Math.floor(v / 128)) groups.unshift((v % 128) | 0x80);
    out.push(...groups);
  }
  return tlv(0x06, Buffer.from(out));
}

// UTCTime up to 2049, GeneralizedTime from 2050 (RFC 5280).
function time(d) {
  const digits = d.toISOString().slice(0, 19).replace(/[-T:]/g, '');
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${digits.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${digits}Z`));
}

const OID = {
  ecdsaWithSHA256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  subjectKeyId: '2.5.29.14',
  keyUsage: '2.5.29.15',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
};

const extension = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
const name = (cn) => seq(set(seq(oid(OID.organization), utf8('Keep Playing'))), set(seq(oid(OID.commonName), utf8(cn))));

/** Makes a new key and self-signed certificate. Returns { cert, key } as PEM text. */
function makeCertificate(now = new Date()) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  const algorithm = seq(oid(OID.ecdsaWithSHA256));
  const altNames = seq(
    tlv(0x82, Buffer.from('localhost')),
    tlv(0x87, Buffer.from([127, 0, 0, 1])),
    tlv(0x87, Buffer.from([...new Array(15).fill(0), 1])),
  );
  const tbs = seq(
    explicit(0, integer(Buffer.from([2]))), // version 3
    integer(serial),
    algorithm,
    name('Keep Playing on this computer'),
    seq(time(new Date(now.getTime() - 24 * 60 * 60 * 1000)), time(new Date(now.getTime() + VALID_DAYS * 24 * 60 * 60 * 1000))),
    name('Keep Playing on this computer'),
    spki,
    explicit(3, seq(
      extension(OID.basicConstraints, true, seq()), // not a certificate authority
      extension(OID.keyUsage, true, tlv(0x03, Buffer.from([7, 0x80]))), // digitalSignature only
      extension(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
      extension(OID.subjectAltName, false, altNames),
      extension(OID.subjectKeyId, false, octets(crypto.createHash('sha1').update(spki).digest())),
    )),
  );
  const signature = crypto.sign('sha256', tbs, privateKey); // DER-encoded ECDSA
  const der = seq(tbs, algorithm, bits(signature));
  const lines = der.toString('base64').match(/.{1,64}/g).join('\n');
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/**
 * The certificate in <dir>, made (or renewed, when it has under a month left)
 * if needed. Returns { cert, key, certFile, made }.
 */
function loadOrCreate(dir, now = new Date()) {
  const certFile = path.join(dir, 'keep-playing.crt');
  const keyFile = path.join(dir, 'keep-playing.key');
  try {
    const cert = fs.readFileSync(certFile, 'utf8');
    const key = fs.readFileSync(keyFile, 'utf8');
    const x = new crypto.X509Certificate(cert);
    if (Date.parse(x.validTo) - now.getTime() > RENEW_DAYS * 24 * 60 * 60 * 1000 && x.checkPrivateKey(crypto.createPrivateKey(key))) {
      return { cert, key, certFile, made: false };
    }
  } catch (e) {
    // missing or unreadable: make a new one
  }
  const made = makeCertificate(now);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, made.key, { mode: 0o600 });
  fs.writeFileSync(certFile, made.cert);
  return { ...made, certFile, made: true };
}

module.exports = { makeCertificate, loadOrCreate };
