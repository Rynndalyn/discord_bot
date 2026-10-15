// Minimal Airtable REST client with a request queue (Airtable allows 5 req/sec per base)
// and retry on 429 / 5xx.
import { BASE_ID } from './schema.js';

const API = 'https://api.airtable.com/v0';
const TOKEN = process.env.AIRTABLE_TOKEN;

let chain = Promise.resolve();
const MIN_GAP_MS = 220;

function queued(fn) {
  const run = chain.then(async () => {
    const out = await fn();
    await sleep(MIN_GAP_MS);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(method, path, body, attempt = 0) {
  const res = await fetch(`${API}/${BASE_ID}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await sleep(1000 * 2 ** attempt + 500);
    return request(method, path, body, attempt + 1);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Airtable ${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

/** Escape a value for use inside a double-quoted Airtable formula string. */
export function q(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** List all records matching a formula. Returns records whose `fields` are keyed by field ID. */
export async function list(table, { formula, fields, maxRecords } = {}) {
  const out = [];
  let offset;
  do {
    const params = new URLSearchParams();
    params.set('returnFieldsByFieldId', 'true');
    if (formula) params.set('filterByFormula', formula);
    if (maxRecords) params.set('maxRecords', String(maxRecords));
    if (offset) params.set('offset', offset);
    for (const f of fields || []) params.append('fields[]', f);
    const page = await queued(() => request('GET', `${table}?${params}`));
    out.push(...page.records);
    offset = page.offset;
  } while (offset && (!maxRecords || out.length < maxRecords));
  return out;
}

export async function first(table, opts) {
  const recs = await list(table, { ...opts, maxRecords: 1 });
  return recs[0] || null;
}

export function create(table, fields) {
  return queued(() =>
    request('POST', table, { records: [{ fields }], typecast: true, returnFieldsByFieldId: true })
  ).then((r) => r.records[0]);
}

export function update(table, id, fields) {
  return queued(() =>
    request('PATCH', table, { records: [{ id, fields }], typecast: true, returnFieldsByFieldId: true })
  ).then((r) => r.records[0]);
}
