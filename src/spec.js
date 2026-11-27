'use strict';
// Microsoft's published description of every PlayFab call (see spec/NOTICE),
// and a checker that compares a request or an answer with it.

const spec = require('../spec/calls.json');

function call(url) {
  return Object.prototype.hasOwnProperty.call(spec.calls, url) ? spec.calls[url] : null;
}

function allCalls() {
  return Object.entries(spec.calls).map(([url, c]) => ({ url, ...c }));
}

function errorCode(name) {
  return Object.prototype.hasOwnProperty.call(spec.errors, name) ? spec.errors[name] : 1000;
}

function type(api, name) {
  const types = spec.types[api];
  return types && Object.prototype.hasOwnProperty.call(types, name) ? types[name] : null;
}

// Property tuple: [name, jsontype, actualtype, optional, collection, isclass, isenum]
const NAME = 0, JSONTYPE = 1, ACTUAL = 2, OPTIONAL = 3, COLLECTION = 4, ISCLASS = 5, ISENUM = 6;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const INTEGER_TYPES = new Set(['int32', 'uint32', 'int64', 'uint64', 'Int32', 'UInt32', 'Int64', 'UInt64']);

// Checks one value against one property description. Pushes problems into `out`.
function checkValue(api, prop, value, where, out, opts) {
  if (prop[COLLECTION] === 'array') {
    if (!Array.isArray(value)) return out.push(`${where} should be a list`);
    value.forEach((v, i) => checkSingle(api, prop, v, `${where}[${i}]`, out, opts));
    return;
  }
  if (prop[COLLECTION] === 'map') {
    if (!isPlainObject(value)) return out.push(`${where} should be an object of named values`);
    for (const [k, v] of Object.entries(value)) checkSingle(api, prop, v, `${where}.${k}`, out, opts);
    return;
  }
  checkSingle(api, prop, value, where, out, opts);
}

function checkSingle(api, prop, value, where, out, opts) {
  if (value === null || value === undefined) return; // PlayFab leaves out empty values
  const actual = prop[ACTUAL];
  if (prop[ISENUM]) {
    const t = type(api, actual);
    if (typeof value !== 'string') return out.push(`${where} should be one of the ${actual} names`);
    if (t && t.e && !t.e.includes(value)) out.push(`${where} is "${value}", which isn't a ${actual}`);
    return;
  }
  if (prop[ISCLASS]) {
    if (!isPlainObject(value)) return out.push(`${where} should be an object (${actual})`);
    checkObject(api, actual, value, where, out, opts);
    return;
  }
  switch (prop[JSONTYPE]) {
    case 'String':
      // PlayFab turns numbers and true/false into text when a field wants text
      // (Microsoft's own SDK tests rely on it), so requests may send them.
      if (opts.lenient && (typeof value === 'number' || typeof value === 'boolean')) return;
      if (typeof value !== 'string') return out.push(`${where} should be text`);
      if (actual === 'DateTime' && Number.isNaN(Date.parse(value))) out.push(`${where} should be a date`);
      return;
    case 'Number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return out.push(`${where} should be a number`);
      if (INTEGER_TYPES.has(actual) && !Number.isInteger(value)) out.push(`${where} should be a whole number`);
      if ((actual === 'uint32' || actual === 'uint64') && value < 0) out.push(`${where} can't be negative`);
      return;
    case 'Boolean':
      if (typeof value !== 'boolean') out.push(`${where} should be true or false`);
      return;
    case 'Object':
      // actualtype "object" means any JSON value.
      return;
    default:
      return;
  }
}

// opts.strict: report properties that the description doesn't know about.
// opts.required: report required properties that are missing.
function checkObject(api, typeName, value, where, out, opts) {
  const t = type(api, typeName);
  if (!t || !t.p) return;
  const known = new Set();
  for (const prop of t.p) {
    known.add(prop[NAME]);
    const v = value[prop[NAME]];
    if (v === undefined || v === null) {
      if (opts.required && !prop[OPTIONAL]) out.push(`${where ? where + '.' : ''}${prop[NAME]} is required`);
      continue;
    }
    checkValue(api, prop, v, `${where ? where + '.' : ''}${prop[NAME]}`, out, opts);
  }
  if (opts.strict) {
    for (const k of Object.keys(value)) {
      if (!known.has(k)) out.push(`${where ? where + '.' : ''}${k} isn't in ${typeName}`);
    }
  }
}

// Returns a list of problems (empty when the value matches the description).
function check(api, typeName, value, opts = {}) {
  const out = [];
  if (!isPlainObject(value)) return [`${typeName} should be an object`];
  checkObject(api, typeName, value, '', out, { strict: !!opts.strict, required: opts.required !== false });
  return out;
}

// For requests: the field-by-field details PlayFab puts in errorDetails.
function requestProblems(api, typeName, body) {
  const t = type(api, typeName);
  if (!t || !t.p) return null;
  const details = {};
  for (const prop of t.p) {
    const v = body[prop[NAME]];
    // Numbers and true/false values can't be missing on PlayFab's side (they
    // become 0 and false), so only text, lists and objects are really required.
    const valueType = !prop[COLLECTION] && !prop[ISCLASS] && !prop[ISENUM] &&
      (prop[JSONTYPE] === 'Number' || prop[JSONTYPE] === 'Boolean');
    if ((v === undefined || v === null) && !prop[OPTIONAL] && !valueType) {
      details[prop[NAME]] = [`The ${prop[NAME]} field is required.`];
      continue;
    }
    if (v === undefined || v === null) continue;
    const problems = [];
    checkValue(api, prop, v, prop[NAME], problems, { strict: false, required: false, lenient: true });
    if (problems.length) details[prop[NAME]] = problems;
  }
  return Object.keys(details).length ? details : null;
}

module.exports = { call, allCalls, errorCode, type, check, requestProblems, source: spec.source };
