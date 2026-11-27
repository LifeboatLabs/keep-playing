'use strict';
// Where everything is kept. Records live in memory and every change is written
// straight to a journal file, so nothing is lost if the server stops. On start
// the journal is replayed; when it gets long it is folded into a snapshot.
//
//   data/snapshot.json   every record, as of the last fold
//   data/journal.jsonl   one line per change since then

const fs = require('node:fs');
const path = require('node:path');

const FOLD_AFTER = 5000; // journal lines

class Store {
  // dir: folder to keep data in, or null to keep everything in memory (tests).
  constructor(dir) {
    this.dir = dir;
    this.collections = new Map();
    this.fd = null;
    this.lines = 0;
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    this.load();
    this.fd = fs.openSync(this.journalPath, 'a');
    if (this.lines > FOLD_AFTER) this.fold();
  }

  get snapshotPath() { return path.join(this.dir, 'snapshot.json'); }
  get journalPath() { return path.join(this.dir, 'journal.jsonl'); }

  coll(name) {
    let c = this.collections.get(name);
    if (!c) {
      c = new Map();
      this.collections.set(name, c);
    }
    return c;
  }

  load() {
    if (fs.existsSync(this.snapshotPath)) {
      const snap = JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8'));
      for (const [name, records] of Object.entries(snap.collections || {})) {
        const c = this.coll(name);
        for (const [k, v] of Object.entries(records)) c.set(k, v);
      }
    }
    if (fs.existsSync(this.journalPath)) {
      const text = fs.readFileSync(this.journalPath, 'utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch (e) {
          continue; // a half-written last line after a crash
        }
        if (entry.d) this.coll(entry.c).delete(entry.k);
        else this.coll(entry.c).set(entry.k, entry.v);
        this.lines++;
      }
    }
  }

  write(entry) {
    if (this.fd === null) return;
    fs.writeSync(this.fd, JSON.stringify(entry) + '\n');
    this.lines++;
    // A server that runs for weeks folds as it goes, so the journal stays small.
    if (this.lines >= FOLD_AFTER * 4) this.fold();
  }

  get(name, key) {
    return this.coll(name).get(key);
  }

  has(name, key) {
    return this.coll(name).has(key);
  }

  // Saves a record. Pass the same object you got from get() after changing it.
  put(name, key, value) {
    this.coll(name).set(key, value);
    this.write({ c: name, k: key, v: value });
    return value;
  }

  delete(name, key) {
    if (!this.coll(name).delete(key)) return false;
    this.write({ c: name, k: key, d: 1 });
    return true;
  }

  values(name) {
    return this.coll(name).values();
  }

  size(name) {
    return this.coll(name).size;
  }

  // Writes a fresh snapshot and empties the journal.
  fold() {
    if (!this.dir) return;
    const collections = {};
    for (const [name, c] of this.collections) collections[name] = Object.fromEntries(c);
    const tmp = this.snapshotPath + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, JSON.stringify({ savedAt: new Date().toISOString(), collections }));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, this.snapshotPath);
    if (this.fd !== null) fs.closeSync(this.fd);
    this.fd = fs.openSync(this.journalPath, 'w');
    this.lines = 0;
  }

  close() {
    if (this.fd === null) return;
    if (this.lines > 0) this.fold();
    fs.closeSync(this.fd);
    this.fd = null;
  }
}

module.exports = { Store };
