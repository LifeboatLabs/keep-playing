#!/usr/bin/env node
'use strict';
// Starts Keep Playing.
//
//   node server.js                      players saved in ./data, port 8080
//   node server.js --title ./my-game    load the game's settings from a folder
//   node server.js --port 9000 --data ./saves --verbose

const http = require('node:http');
const path = require('node:path');
const { createApp } = require('./src/app');

function args(argv) {
  const out = { port: 8080, host: '127.0.0.1', data: 'data', title: null, verbose: false };
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
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`I don't know the option ${a}. Try --help.`);
  }
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) throw new Error('--port should be a number from 1 to 65535');
  return out;
}

const HELP = `Keep Playing: a free server that answers PlayFab calls.

  node server.js [--title FOLDER] [--data FOLDER] [--port 8080] [--host 127.0.0.1] [--verbose]

  --title    the game's settings (title data, catalog, CloudScript...). See title-example/.
  --data     where players are saved. Default: ./data
  --port     the port to listen on. Default: 8080
  --host     who can connect. 127.0.0.1 means only this computer (the default).
             Use 0.0.0.0 to let other computers on your network connect.
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

  const server = http.createServer((req, res) => {
    app.handle(req, res).catch((e) => {
      log(`Unexpected problem: ${e.stack || e}`, 'error');
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.keepAliveTimeout = 65000;

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`Port ${opts.port} is already in use. Try another one with --port.`);
    else console.error(`Keep Playing stopped: ${e.message}`);
    process.exit(1);
  });

  server.listen(opts.port, opts.host, () => {
    // For addresses made where there's no request to go by (inside CloudScript).
    const local = opts.host === '0.0.0.0' || opts.host === '::' ? '127.0.0.1' : opts.host.includes(':') ? `[${opts.host}]` : opts.host;
    app.publicUrl = `http://${local}:${opts.port}`;
    const s = app.status();
    const t = app.title();
    console.log(`Keep Playing ${app.version} is running at http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${opts.port}`);
    console.log(`  Game: ${t.name || '(no name)'}, title ID ${t.titleId || '(set by the first sign-in)'}`);
    console.log(`  Players saved in ${path.resolve(opts.data)} (${s.players} so far)`);
    console.log(`  Answers ${s.calls.working} of ${s.calls.total} PlayFab calls`);
    console.log(`  Secret key for Server and Admin calls is in ${path.join(path.resolve(opts.data), 'keys.json')}`);
    if (opts.host === '0.0.0.0') console.log('  Other computers on your network can connect.');
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

main();
