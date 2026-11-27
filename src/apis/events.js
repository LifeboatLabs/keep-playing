'use strict';
// Analytics events. Games send lots of these and some stop working if they
// fail, so they're accepted and counted. Nothing is sent anywhere.

const crypto = require('node:crypto');

const eventId = () => crypto.randomBytes(16).toString('hex');

module.exports = function register(on, app) {
  app.events = { count: 0, byName: {} };
  const record = (name) => {
    app.events.count++;
    const key = String(name || 'unnamed');
    app.events.byName[key] = (app.events.byName[key] || 0) + 1;
  };

  const writeOne = (body) => {
    record(body.EventName);
    return { EventId: eventId() };
  };
  for (const api of ['Client', 'Server']) {
    on(`/${api}/WritePlayerEvent`, writeOne);
    on(`/${api}/WriteTitleEvent`, writeOne);
    on(`/${api}/WriteCharacterEvent`, writeOne);
  }

  const writeMany = (body) => {
    const ids = [];
    for (const e of body.Events || []) {
      record(e && e.Name);
      ids.push(eventId());
    }
    return { AssignedEventIds: ids };
  };
  on('/Event/WriteEvents', writeMany);
  on('/Event/WriteTelemetryEvents', writeMany);

  on('/Client/ReportDeviceInfo', () => ({}));
  on('/Client/AttributeInstall', () => ({}));
};
