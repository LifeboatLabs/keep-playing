#!/usr/bin/env node
'use strict';
// Sends a game's PlayFab calls to Keep Playing on this computer, without
// changing any of the game's files. For Windows: double-click connect-game.cmd
// to connect a game, and disconnect-game.cmd to take it all back.
//
//   node tools/connect.js                     find the game's title ID, connect it, start Keep Playing
//   node tools/connect.js 1A2B3               connect the game whose PlayFab title ID is 1A2B3
//   node tools/connect.js --title games/otwd  use a folder of the game's settings too
//   node tools/connect.js --undo              take it all back
//
// A game that uses PlayFab calls https://<title ID>.playfabapi.com. To send
// those calls here, this:
//  1. adds a line to Windows' hosts file saying that address is this computer.
//     Windows asks first, because it's a system file. The line ends in
//     "# Keep Playing", and --undo removes every line that does.
//  2. asks Windows to trust Keep Playing's certificate, for this Windows user
//     only. Windows shows a warning first. The certificate isn't a certificate
//     authority: it only covers this computer's own addresses and the game's
//     PlayFab address, so it can't be used against any other website.
//  3. starts Keep Playing on port 443, the port the game uses.
//
// While it's connected, the game can't reach PlayFab at all, so only use it for
// games whose servers are gone.

const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const readline = require('node:readline');
const tls = require('../src/tls');

const ROOT = path.join(__dirname, '..');
const MARK = '# Keep Playing';
const CERT_NAME = 'Keep Playing on this computer';
const HOSTS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
const ADDRESS = /^[a-z0-9]{1,16}\.playfabapi\.com$/;

// ---- the parts that don't need Windows (the tests try these)

/** PlayFab title IDs in text that mentions <id>.playfabapi.com, like `ipconfig /displaydns` prints. */
function findTitleIds(text) {
  const out = [];
  // Title IDs are hexadecimal, which leaves out PlayFab's other addresses (www, api...).
  for (const m of String(text).matchAll(/(?<![0-9a-z.-])([0-9a-f]{4,8})\.playfabapi\.com(?![0-9a-z-])/gi)) {
    const id = m[1].toUpperCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Keep Playing's lines in a hosts file. */
function ours(text) {
  return String(text).split(/\r?\n/).filter((l) => l.trimEnd().endsWith(MARK));
}

/** The hosts file with Keep Playing's lines replaced by ones sending each address in `names` here. */
function editHosts(text, names) {
  const s = String(text);
  const eol = s.includes('\r\n') || !s.includes('\n') ? '\r\n' : '\n';
  const lines = s.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  const kept = lines.filter((l) => !l.trimEnd().endsWith(MARK));
  for (const n of names) kept.push(`127.0.0.1 ${n} ${MARK}`);
  return kept.length ? kept.join(eol) + eol : '';
}

/** Whether Keep Playing's lines in the hosts file send exactly these addresses here. */
function hostsSend(text, names) {
  const want = names.map((n) => `127.0.0.1 ${n} ${MARK}`).sort().join('\n');
  return ours(text).map((l) => l.trim()).sort().join('\n') === want;
}

/** Thumbprint of a certificate, the way Windows shows it. */
function thumbprint(pem) {
  return new crypto.X509Certificate(pem).fingerprint.replace(/:/g, '');
}

// ---- Windows

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

function readHosts() {
  try {
    return fs.readFileSync(HOSTS, 'latin1');
  } catch (e) {
    return '';
  }
}

// Runs (or, elevated, writes) the hosts file change. Only ever PlayFab addresses.
function changeHosts(names) {
  for (const n of names) if (!ADDRESS.test(n)) throw new Error(`${n} isn't a PlayFab address`);
  const before = readHosts();
  const after = editHosts(before, names);
  if (after !== before) fs.writeFileSync(HOSTS, after, 'latin1');
  spawnSync('ipconfig', ['/flushdns'], { stdio: 'ignore', windowsHide: true }); // forget the old address now
}

const psString = (s) => `'${String(s).replace(/'/g, "''")}'`;

function powershell(script, options = {}) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, ...options });
}

// Runs this script again as administrator, with `args`. Windows asks first.
function asAdministrator(args) {
  const line = [__filename, ...args].map((a) => `"${a}"`).join(' ');
  powershell(`try { $p = Start-Process -FilePath ${psString(process.execPath)} -ArgumentList ${psString(line)} -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode } catch { exit 1223 }`, { stdio: 'ignore' });
}

// Thumbprints of the Keep Playing certificates this Windows user trusts.
function trusted() {
  const r = powershell(`Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { $_.Subject -like ${psString(`*CN=${CERT_NAME}*`)} } | ForEach-Object { $_.Thumbprint }`);
  if (r.status !== 0) fail(`I couldn't look at the certificates Windows trusts. ${(r.stderr || '').trim()}`);
  return r.stdout.split(/\r?\n/).map((l) => l.trim().toUpperCase()).filter((l) => /^[0-9A-F]{40}$/.test(l));
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(`${question} `, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

// Waits for the game's PlayFab address to reach Keep Playing, through the hosts file,
// the way the game will. Resolves true, or with what went wrong.
function reaches(address, ca, isRunning) {
  return new Promise((resolve) => {
    const attempt = (left) => {
      if (!isRunning()) return resolve('stopped');
      const req = https.get({ host: address, port: 443, path: '/status', ca, timeout: 5000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200 || `answer ${res.statusCode}`);
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('no answer'), { code: 'TIMEOUT' })));
      req.on('error', (e) => {
        if (left > 0 && e.code === 'ECONNREFUSED') setTimeout(() => attempt(left - 1), 500);
        else resolve(e.code || e.message);
      });
    };
    attempt(40); // up to 20 seconds for Keep Playing to start
  });
}

async function findGame() {
  console.log("Start the game, and wait until it says it can't connect (or until it's gone as far as it will).");
  console.log('If other games that sign in online are open, close them first.');
  for (;;) {
    await ask('Then come back to this window and press Enter.');
    const r = spawnSync('ipconfig', ['/displaydns'], { encoding: 'latin1', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    const ids = findTitleIds(r.stdout || '');
    if (ids.length === 1) {
      console.log(`\nThe game asked for ${tls.playfabAddress(ids[0])} (PlayFab title ID ${ids[0]}).`);
      return (await ask('Press Enter to connect it, or type a different title ID and press Enter.')) || ids[0];
    }
    if (ids.length > 1) {
      console.log('\nGames on this computer asked for these PlayFab addresses:');
      ids.forEach((id, i) => console.log(`  ${i + 1}. ${tls.playfabAddress(id)}`));
      const pick = await ask('Type the number of the one to connect (or a title ID) and press Enter. Or just press Enter to look again.');
      if (ids[Number(pick) - 1]) return ids[Number(pick) - 1];
      if (pick) return pick;
      continue;
    }
    const typed = await ask("\nI couldn't see a game asking for PlayFab. If you know the game's PlayFab title ID, type it and press Enter. Or just press Enter to look again.");
    if (typed) return typed;
  }
}

async function connect(opts) {
  console.log('Keep Playing: connect a game\n');
  console.log("This sends a game's PlayFab calls to Keep Playing on this computer, without changing any of the game's files.");
  console.log("Only use it for a game whose servers are gone: while it's connected, the game can't reach PlayFab at all.\n");
  let address;
  const id = opts.titleId || await findGame();
  try {
    address = tls.playfabAddress(id);
  } catch (e) {
    fail(`${e.message}. Run this again and type the title ID the way the game uses it.`);
  }
  const dataDir = path.resolve(ROOT, opts.data || 'data');
  const cert = tls.loadOrCreate(path.join(dataDir, 'tls'), new Date(), [address]);

  console.log(`\n1. The hosts file: sending ${address} to this computer.`);
  if (hostsSend(readHosts(), [address])) console.log('   It already does.');
  else {
    console.log('   Windows will ask "Do you want to allow this app to make changes to your device?" Click Yes.');
    asAdministrator(['--hosts', address]);
    if (!hostsSend(readHosts(), [address])) {
      fail("The hosts file didn't change. If you clicked No, run this again and click Yes. If it still doesn't change, your antivirus may be protecting the hosts file.");
    }
    console.log('   Done.');
  }

  console.log("\n2. Asking Windows to trust Keep Playing's certificate.");
  const mine = thumbprint(cert.cert);
  const had = trusted();
  if (had.includes(mine)) console.log('   It already does.');
  else {
    const old = had.filter((t) => t !== mine);
    if (old.length) {
      console.log(`   First, Windows will ask about deleting Keep Playing's old certificate${old.length > 1 ? 's' : ''}. Click Yes.`);
      for (const t of old) spawnSync('certutil', ['-user', '-delstore', 'Root', t], { stdio: 'ignore' });
    }
    console.log('   Windows will show a security warning about installing a certificate. Click Yes.');
    console.log("   (It's only trusted by you, and it only covers this computer and the game's PlayFab address.)");
    spawnSync('certutil', ['-user', '-addstore', 'Root', cert.certFile], { stdio: 'ignore' });
    if (!trusted().includes(mine)) fail("Windows doesn't trust the certificate. If you clicked No, run this again and click Yes.");
    console.log('   Done.');
  }

  console.log('\n3. Starting Keep Playing.\n');
  const args = [path.join(ROOT, 'server.js'), '--title-id', id, '--data', dataDir];
  if (opts.title) args.push('--title', path.resolve(opts.title));
  const server = spawn(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
  let running = true;
  server.on('exit', (code) => {
    running = false;
    process.exitCode = code || 0;
  });
  const result = await reaches(address, cert.cert, () => running);
  if (result === 'stopped') return;
  if (result === true) {
    console.log(`\nIt works: ${address} now reaches Keep Playing on this computer.`);
    console.log("Start the game again. Keep this window open while you play; Keep Playing stops when it's closed.");
    console.log(`The page that's opening in your browser shows each call the game makes. It's at https://${address}/`);
    console.log('To put everything back the way it was, close this window and double-click disconnect-game.cmd.\n');
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process ${psString(`https://${address}/`)}`], { stdio: 'ignore', windowsHide: true, detached: true }).unref();
  } else {
    console.log(`\nKeep Playing is running, but ${address} doesn't reach it yet (${result}).`);
    console.log('Close this window, wait a minute, and double-click connect-game.cmd again.');
  }
}

async function undo() {
  console.log('Keep Playing: disconnect\n');
  console.log('1. Taking Keep Playing out of the hosts file.');
  if (!ours(readHosts()).length) console.log('   It isn\'t in there.');
  else {
    console.log('   Windows will ask "Do you want to allow this app to make changes to your device?" Click Yes.');
    asAdministrator(['--hosts']);
    if (ours(readHosts()).length) fail("The hosts file didn't change. If you clicked No, run this again and click Yes.");
    console.log('   Done.');
  }
  console.log("\n2. Removing Keep Playing's certificate from the ones Windows trusts.");
  const had = trusted();
  if (!had.length) console.log('   There isn\'t one.');
  else {
    console.log('   Windows will ask "Do you want to DELETE the following certificate from the Root Store?" Click Yes.');
    for (const t of had) spawnSync('certutil', ['-user', '-delstore', 'Root', t], { stdio: 'ignore' });
    if (trusted().length) fail("The certificate is still there. If you clicked No, run this again and click Yes.");
    console.log('   Done.');
  }
  console.log('\nAll done: games reach PlayFab the usual way again. Players and saves stay in the data folder.');
}

function elsewhere(id) {
  const address = id ? tls.playfabAddress(id) : '<title ID>.playfabapi.com';
  console.log(`This helper is for Windows. Elsewhere, you can do the same by hand:
  1. Add this line to /etc/hosts:  127.0.0.1 ${address} ${MARK}
  2. Start Keep Playing:  node server.js --title-id ${id || '<title ID>'}
     (On Linux, port 443 needs sudo.) It makes data/tls/keep-playing.crt.
  3. Trust that certificate for your user, the way your system does it.`);
}

async function main(argv) {
  const opts = { titleId: null, title: null, data: null, undo: false, hosts: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--undo') opts.undo = true;
    else if (a === '--title') opts.title = argv[++i];
    else if (a === '--data') opts.data = argv[++i];
    else if (a === '--hosts') { // the part that runs as administrator
      opts.hosts = argv.slice(i + 1);
      break;
    } else if (!a.startsWith('-') && !opts.titleId) opts.titleId = a;
    else fail(`I don't know the option ${a}.`);
  }
  if (opts.hosts) return changeHosts(opts.hosts);
  if (Number(process.versions.node.split('.')[0]) < 22) fail(`Keep Playing needs Node.js 22 or newer, and this is ${process.version}. Install the LTS version from https://nodejs.org and try again.`);
  if (process.platform !== 'win32') return elsewhere(opts.titleId);
  return opts.undo ? undo() : connect(opts);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => fail(`Something went wrong: ${e.message}`));
}

module.exports = { findTitleIds, editHosts, hostsSend, ours, thumbprint, MARK };
