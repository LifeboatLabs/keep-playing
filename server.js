#!/usr/bin/env node
'use strict';
// Starts Keep Playing.
//
//   node server.js                      players saved in ./data, port 8080
//   node server.js --title ./my-game    load the game's settings from a folder
//   node server.js --port 9000 --data ./saves --verbose
//   node server.js --https              for games that only use https (port 8443)
//   node server.js --title-id 1A2B3     answer at 1a2b3.playfabapi.com (https, port 443)

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { createApp } = require('./src/app');
const tls = require('./src/tls');
const { importFile, importFolder, describe } = require('./src/import');

function args(argv) {
  const out = { port: null, host: '127.0.0.1', data: 'data', title: null, verbose: false, https: false, cert: null, key: null, addresses: [], imports: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value after it`);
      return argv[++i];
    };
    if (a === '--port') out.port = Number(next());
    else if (a === '--host') out.host = next();
    else if (a === '--data') out.data = next();
    else if (a === '--title') out.title = next();
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--https') out.https = true;
    else if (a === '--cert') out.cert = next();
    else if (a === '--key') out.key = next();
    else if (a === '--import') out.imports.push(next());
    else if (a === '--title-id') out.addresses.push(...next().split(',').map((id) => tls.playfabAddress(id.trim())));
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`I don't know the option ${a}. Try --help.`);
  }
  if (!out.cert !== !out.key) throw new Error('--cert and --key go together: give both, or neither.');
  if (out.cert || out.addresses.length) out.https = true;
  // A game that's sent here by name expects the usual https port.
  if (out.port === null) out.port = out.addresses.length ? 443 : out.https ? 8443 : 8080;
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) throw new Error('--port should be a number from 1 to 65535');
  return out;
}

const HELP = `Keep Playing: a free server that answers PlayFab calls.

  node server.js [--title FOLDER] [--data FOLDER] [--port 8080] [--host 127.0.0.1] [--https] [--title-id 1A2B3] [--import FILE] [--verbose]

  --title    the game's settings (title data, catalog, CloudScript...). See title-example/.
  --data     where players are saved. Default: ./data
  --port     the port to listen on. Default: 8080, or 8443 with --https
  --host     who can connect. 127.0.0.1 means only this computer (the default).
             Use 0.0.0.0 to let other computers on your network connect.
  --https    use https, for games that won't use plain http (most Unreal games).
             Keep Playing makes a certificate for this computer and keeps it in
             the data folder. See "Games that need https" in README.md.
  --cert, --key   use your own certificate and key (PEM files) for https instead.
  --import FILE   bring back a player from a player file (what PlayFab's
             GetPlayerCombinedInfo answered for them). Files put in the
             import folder inside the data folder are brought back too.
  --title-id 1A2B3   answer the game's calls to 1a2b3.playfabapi.com: https on
             port 443, with a certificate that covers that address too. The hosts
             file has to send the address here, and Windows has to trust the
             certificate; connect-game.cmd does both. See "Games you can't
             change" in README.md.
  --verbose  show every call as it happens.
`;

function main() {
  let opts;
  try {
    opts = args(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const log = (message, level) => {
    if (level === 'debug' && !opts.verbose) return;
    const stamp = new Date().toISOString().slice(11, 19);
    (level === 'error' ? console.error : console.log)(`${stamp} ${message}`);
  };

  let app;
  try {
    app = createApp({
      dataDir: path.resolve(opts.data),
      titleDir: opts.title ? path.resolve(opts.title) : null,
      log,
    });
  } catch (e) {
    console.error(`Keep Playing couldn't start: ${e.message}`);
    process.exit(1);
  }

  // Players to bring back: files named with --import, and files in data/import.
  const importDir = path.join(path.resolve(opts.data), 'import');
  const found = { results: [], errors: [] };
  for (const f of opts.imports) {
    try {
      found.results.push(importFile(app, path.resolve(f)));
    } catch (e) {
      found.errors.push(e.message);
    }
  }
  try {
    fs.mkdirSync(importDir, { recursive: true });
    const inFolder = importFolder(app, importDir);
    found.results.push(...inFolder.results);
    found.errors.push(...inFolder.errors);
  } catch (e) {
    found.errors.push(`couldn't look in ${importDir}: ${e.message}`);
  }
  for (const r of found.results) console.log(describe(r));
  for (const e of found.errors) console.error(`Couldn't bring back a player: ${e}`);

  let certificate = null;
  if (opts.https) {
    try {
      certificate = opts.cert
        ? { cert: fs.readFileSync(opts.cert, 'utf8'), key: fs.readFileSync(opts.key, 'utf8'), certFile: path.resolve(opts.cert), own: true }
        : tls.loadOrCreate(path.join(path.resolve(opts.data), 'tls'), new Date(), opts.addresses);
    } catch (e) {
      console.error(`Keep Playing couldn't set up https: ${e.message}`);
      process.exit(1);
    }
  }
  const handler = (req, res) => {
    app.handle(req, res).catch((e) => {
      log(`Unexpected problem: ${e.stack || e}`, 'error');
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  };
  const server = certificate ? https.createServer({ cert: certificate.cert, key: certificate.key }, handler) : http.createServer(handler);
  const scheme = certificate ? 'https' : 'http';
  server.keepAliveTimeout = 65000;

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`Port ${opts.port} is already in use. ${opts.addresses.length ? 'Another program is using it (a web server, or Keep Playing running in another window). Close it and try again.' : 'Try another one with --port.'}`);
    else if (e.code === 'EACCES') console.error(`This computer won't let Keep Playing use port ${opts.port}.${opts.port < 1024 ? ' On Linux, ports under 1024 need sudo.' : ''}`);
    else console.error(`Keep Playing stopped: ${e.message}`);
    process.exit(1);
  });

  server.listen(opts.port, opts.host, () => {
    // For addresses made where there's no request to go by (inside CloudScript).
    const local = opts.host === '0.0.0.0' || opts.host === '::' ? '127.0.0.1' : opts.host.includes(':') ? `[${opts.host}]` : opts.host;
    app.publicUrl = `${scheme}://${local}:${opts.port}`;
    const s = app.status();
    const t = app.title();
    console.log(`Keep Playing ${app.version} is running at ${scheme}://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${opts.port}`);
    console.log(`  Game: ${t.name || '(no name)'}, title ID ${t.titleId || '(set by the first sign-in)'}`);
    console.log(`  Players saved in ${path.resolve(opts.data)} (${s.players} so far)`);
    console.log(`  Answers ${s.calls.working} of ${s.calls.total} PlayFab calls`);
    console.log(`  Secret key for Server and Admin calls is in ${path.join(path.resolve(opts.data), 'keys.json')}`);
    if (opts.host === '0.0.0.0') console.log('  Other computers on your network can connect.');
    for (const a of opts.addresses) console.log(`  Answers for https://${a} too, when this computer sends that address here`);
    if (certificate && !certificate.own) {
      console.log(`  Certificate: ${certificate.certFile}${certificate.made ? ' (just made)' : ''}`);
      if (!opts.addresses.length) console.log('  Games will only accept it once you trust it. See "Games that need https" in README.md.');
    }
    console.log('Press Ctrl+C to stop.');
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('Saving and stopping...');
    server.close();
    app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) main();
module.exports = { args };
