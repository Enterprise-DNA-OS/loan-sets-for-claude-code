#!/usr/bin/env node
// The one CLI for Loan Sets for Claude Code.
//
//   npm run sets -- help
//   npm run sets -- attention
//   npm run sets -- readiness
//   npm run sets -- case C-1101
//   npm run sets -- unbilled --json
//
// Human tables by default, --json for machines. Records match on their code, then a
// case-insensitive part of the name; an ambiguous match lists the candidates and exits 1.
// Nothing here sends. Letters and emails are written to drafts/ for a person to send.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table as textTable } from './lib/format.mjs';

// ---------------------------------------------------------------- reads

export const reads = {
  cases: {
    about: 'Live cases, filtered by --hospital or --rep, nearest first',
    sql: `select code, surgery_on, hospital, surgeon, rep, procedure, status, po_number from live_cases
          where ($1::text is null or lower(hospital) = lower($1)) and ($2::text is null or lower(rep) like '%' || lower($2) || '%')
          order by surgery_on, code`,
    params: (o) => [o.hospital ?? null, o.rep ?? null],
  },
  readiness: { about: 'Cases in the next 14 days: sets booked, delivered, short, expiring or clashing', sql: 'select code, surgery_on, days_to_go, hospital, surgeon, rep, sets, delivered, issue from case_readiness order by surgery_on, code' },
  clashes: { about: 'Sets booked on two cases too close together to turn around', sql: 'select set_code, case_code, surgery_on, hospital, clashes_with from case_set_checks where clashes_with is not null order by set_code, surgery_on' },
  sets: { about: 'Every loan set: where it is, next case, last used, items short', sql: 'select * from set_board order by code' },
  shortfalls: { about: 'Sets short of their kit list, item by item', sql: 'select * from set_shortfalls order by set_code, sku' },
  returns: { about: 'Sets still at a hospital past its return days', sql: 'select * from overdue_returns order by days_out desc' },
  unbilled: { about: 'Surgery done, not invoiced: missing charge sheets, missing purchase orders, ready to bill', sql: 'select * from unbilled_cases order by days_since desc' },
  consignment: {
    about: 'Consignment stock against par, with what to replenish (--location)',
    sql: `select * from consignment_check where ($1::text is null or lower(location) = lower($1)) order by to_replenish desc, location, sku`,
    params: (o) => [o.location ?? null],
  },
  'slow-stock': { about: 'Field stock that has not moved in 180 days, with its value', sql: 'select * from slow_stock order by value_cents desc' },
  expiring: { about: 'Lots expiring within 90 days, in stock or in a set', sql: 'select * from expiring order by expires_on, place' },
  'recall-trace': { about: 'Every unit of an open recall: stock, loan sets and patients\' cases', sql: 'select * from recall_trace order by action, held_in, place' },
  utilisation: { about: 'Cases per set in 90 days, booked ahead, last used', sql: 'select * from set_utilisation order by cases_90_days, booked_ahead, set_code' },
  'surgeon-usage': { about: 'What each surgeon used in the last year, by product and value', sql: 'select * from surgeon_usage order by surgeon, value_cents desc' },
  'rep-load': { about: 'Cases, problems, overdue returns and unbilled cases per rep', sql: 'select * from rep_load order by cases_with_issues desc, code' },
  compliance: { about: 'Records checked against the rules in docs/compliance.md', sql: 'select * from compliance_findings order by days_left nulls last, rule, record' },
  attention: {
    about: 'Everything late, short, clashing, unbilled or out of rule, one list',
    sql: `select * from (
            select 'case' as kind, code as record, hospital || ' ' || surgery_on || ': ' || issue as detail, surgery_on as due_on, days_to_go as days_left
              from case_readiness where issue <> 'ok'
            union all
            select 'return', set_code, hospital || ': out ' || days_out || ' days since ' || case_code, null::date, null::int from overdue_returns
            union all
            select 'billing', code, hospital || ': ' || issue || case when value_cents > 0 then ' ($' || to_char(value_cents / 100.0, 'FM999999990.00') || ')' else '' end, null::date, null::int from unbilled_cases
            union all
            select 'replenish', location, sku || ': ' || on_hand || ' on hand, par ' || par, null::date, null::int from consignment_check where to_replenish > 0
            union all
            select 'rule ' || rule, record, detail, due_on, days_left from compliance_findings where rule not in ('H01', 'H02')
          ) a order by days_left nulls last, kind, record`,
  },
  hospitals: { about: 'Hospitals with lead hours, return days and contacts', sql: 'select code, name, country, sector, loan_lead_hours, return_days, theatre_contact, theatre_email, accounts_email from hospitals order by code' },
  products: { about: 'Products with tracking, card, ARTG, billing code and WAND dates', sql: 'select sku, description, kind, track, card_required, price_cents, artg_no, billing_code, first_supplied_nz_on, wand_notified_on from products where active order by sku' },
  stock: {
    about: 'Stock on hand by location and lot (--location, --sku)',
    sql: `select l.code as location, l.kind, p.sku, lo.lot_no, lo.expires_on, st.qty, st.last_moved_on
          from stock st join locations l on l.id = st.location_id join products p on p.id = st.product_id left join lots lo on lo.id = st.lot_id
          where st.qty > 0 and ($1::text is null or lower(l.code) = lower($1)) and ($2::text is null or lower(p.sku) = lower($2))
          order by l.code, p.sku, lo.expires_on nulls last`,
    params: (o) => [o.location ?? null, o.sku ?? null],
  },
  audit: { about: 'Every change made through this CLI, newest first', sql: 'select entity, record_id, operation, actor, detail, created_at from audit_log order by id desc limit 200' },
  imports: { about: 'Imported files with fingerprint and row count', sql: 'select source, filename, row_count, actor, created_at from import_batches order by created_at desc' },
};

// ---------------------------------------------------------------- helpers

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (const a of argv) {
    if (a === '--help' || a === '-h') { pos.unshift('help'); continue; }
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq < 0) opts[a.slice(2)] = true;
    else opts[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return { pos, opts };
}

export class UsageError extends Error {}
const need = (o, ...keys) => {
  const missing = keys.filter((k) => o[k] === undefined || o[k] === true || o[k] === '');
  if (missing.length) throw new UsageError(`missing ${missing.map((k) => '--' + k).join(', ')}`);
};
const today = () => new Date().toISOString().slice(0, 10);
const isoDate = (v, name) => {
  if (v === undefined || v === null || v === '' || v === true) return null;
  if (v === 'today') return today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) throw new UsageError(`--${name} must be a date like 2026-11-16`);
  return String(v);
};
const isoTime = (v, name) => {
  if (v === undefined || v === true || v === 'now') return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?$/.test(String(v))) throw new UsageError(`--${name} must be like 2026-11-16T14:30`);
  return String(v).replace(' ', 'T');
};
const cents = (v, name) => {
  if (v === undefined || v === '' || v === true) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`--${name} must be an amount in dollars, like 950.00`);
  return Math.round(n * 100);
};
const whole = (v, name, min = 0) => {
  if (v === undefined || v === '' || v === true) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new UsageError(`--${name} must be a whole number of ${min} or more`);
  return n;
};
const oneOf = (v, allowed, name) => {
  if (v === undefined || v === true) return undefined;
  const s = String(v).toLowerCase().replace(/[\s-]+/g, '_');
  if (!allowed.includes(s)) throw new UsageError(`--${name} must be one of: ${allowed.join(', ')}`);
  return s;
};
const actorOf = (o) => (typeof o.actor === 'string' && o.actor) || process.env.SETS_ACTOR || process.env.USER || process.env.USERNAME || 'operator';

async function audit(db, entity, recordId, operation, actor, detail) {
  await db.query('insert into audit_log (entity, record_id, operation, actor, detail) values ($1, $2, $3, $4, $5)', [entity, String(recordId), operation, actor, JSON.stringify(detail ?? {})]);
}

// Resolve one record by exact code, then a case-insensitive part of its name.
const lookups = {
  case: { sql: 'select id, code, procedure as name, hospital_id, status, surgery_on from cases', code: 'code', name: "procedure || ' ' || patient_ref || ' ' || coalesce((select s.name from surgeons s where s.id = surgeon_id), '')" },
  set: { sql: 'select id, code, code as name, status, home_location_id, hospital_id from sets', code: 'code', name: 'code' },
  hospital: { sql: 'select id, code, name, country, sector, theatre_contact, theatre_email, accounts_email from hospitals', code: 'code', name: 'name' },
  location: { sql: 'select id, code, name, kind, country from locations', code: 'code', name: 'name' },
  product: { sql: 'select id, sku as code, description as name, track, kind, price_cents from products', code: 'sku', name: 'description' },
  surgeon: { sql: 'select id, code, name from surgeons', code: 'code', name: 'name' },
  rep: { sql: 'select id, code, name from reps', code: 'code', name: 'name' },
  action: { sql: 'select id, code, reason as name, product_id, lot_id, status from market_actions', code: 'code', name: 'reason' },
};
export async function resolve(db, kind, key) {
  if (!key || key === true) throw new UsageError(`name the ${kind}`);
  const l = lookups[kind];
  const exact = await db.query(`${l.sql} where lower(${l.code}) = lower($1)`, [String(key)]);
  if (exact.length === 1) return exact[0];
  const hits = await db.query(`${l.sql} where lower(${l.name}) like '%' || lower($1) || '%' or lower(${l.code}) like lower($1) || '%' order by 2 limit 20`, [String(key)]);
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new UsageError(`no ${kind} matches "${key}"`);
  throw new UsageError(`Ambiguous ${kind} "${key}": ${hits.map((h) => `${h.code} (${h.name})`).join(', ')}`);
}

async function lotFor(db, productId, lotNo, { create = false, expires = null } = {}) {
  if (!lotNo || lotNo === true) return null;
  const [l] = await db.query('select id, expires_on from lots where product_id = $1 and lower(lot_no) = lower($2)', [productId, String(lotNo)]);
  if (l) return l.id;
  if (!create) throw new UsageError(`no lot "${lotNo}" for that product; add it with add-lot`);
  const [n] = await db.query('insert into lots (product_id, lot_no, expires_on) values ($1, $2, $3) returning id', [productId, String(lotNo), expires]);
  return n.id;
}

// Add (or take, with a negative qty) stock at a location; refuses to go below zero.
async function adjustStock(db, locationId, productId, lotId, delta) {
  const [row] = await db.query('select id, qty from stock where location_id = $1 and product_id = $2 and coalesce(lot_id::text, \'\') = coalesce($3::text, \'\')', [locationId, productId, lotId]);
  if (!row) {
    if (delta < 0) throw new UsageError('not enough stock at that location for that product and lot');
    await db.query('insert into stock (location_id, product_id, lot_id, qty) values ($1, $2, $3, $4)', [locationId, productId, lotId, delta]);
    return;
  }
  if (row.qty + delta < 0) throw new UsageError(`only ${row.qty} on hand at that location for that product and lot`);
  await db.query('update stock set qty = qty + $2, last_moved_on = current_date where id = $1', [row.id, delta]);
}

function writeDraft(name, body) {
  const dir = path.resolve(REPO_ROOT, process.env.DRAFTS_DIR || 'drafts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${today()}-${name}.md`);
  fs.writeFileSync(file, body);
  return file;
}
const dollars = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;

export function printRows(rows) {
  if (!rows.length) return '  (none)';
  const columns = Object.keys(rows[0])
    .filter((k) => k !== 'id')
    .map((key) => ({
      key,
      label: key.replace(/_cents$/, '').replace(/_/g, ' '),
      align: typeof rows[0][key] === 'number' ? 'right' : 'left',
      width: 100,
      format: key.endsWith('_cents') ? (v) => (v === null ? '' : (Number(v) / 100).toFixed(2)) : (v) => (v === true ? 'yes' : v === false ? 'no' : v instanceof Date ? v.toISOString().slice(0, 16).replace('T', ' ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : v),
    }));
  return textTable(rows, columns);
}

// ---------------------------------------------------------------- writes and documents

const CASE_STATUS = ['booked', 'confirmed', 'done', 'cancelled'];
const KIND = ['implant', 'instrument', 'consumable'];
const TRACK = ['lot', 'serial', 'none'];
const SOURCE = ['set', 'consignment', 'trunk'];
const ACTION_KIND = ['recall', 'product_alert', 'product_correction', 'hazard_alert'];
const NOTE_KIND = ['call', 'email', 'visit', 'meeting', 'note'];

export const commands = {
  case: {
    about: 'One case: details, readiness, sets, usage, billing and notes',
    usage: 'case <case code>',
    async run(db, [key]) {
      const c = await resolve(db, 'case', key);
      const [detail] = await db.query(
        `select c.code, c.status, c.surgery_on, h.name as hospital, h.country, h.sector, sg.name as surgeon, r.name as rep, c.procedure, c.patient_ref,
                c.po_number, c.charge_sheet_on, c.billed_on, c.invoice_no, v.value_cents
         from cases c join hospitals h on h.id = c.hospital_id left join surgeons sg on sg.id = c.surgeon_id left join reps r on r.id = c.rep_id
         join case_value v on v.id = c.id where c.id = $1`, [c.id]);
      return {
        case: detail,
        readiness: await db.query('select issue from case_readiness where code = $1', [c.code]),
        sets: await db.query('select s.code as set_code, cs.shipped_on, cs.delivered_at, cs.returned_on, s.status from case_sets cs join sets s on s.id = cs.set_id where cs.case_id = $1 order by s.code', [c.id]),
        usage: await db.query('select p.sku, p.description, lo.lot_no, u.serial_no, u.qty, u.source, u.implant_card_given, u.price_cents from usage u join products p on p.id = u.product_id left join lots lo on lo.id = u.lot_id where u.case_id = $1 order by p.sku', [c.id]),
        notes: await db.query('select noted_on, kind, body, actor from notes where case_id = $1 order by noted_on desc', [c.id]),
      };
    },
  },
  set: {
    about: 'One loan set: where it is, contents against the kit list, case history',
    usage: 'set <set code>',
    async run(db, [key]) {
      const s = await resolve(db, 'set', key);
      const [board] = await db.query('select * from set_board where code = $1', [s.code]);
      return {
        set: board,
        contents: await db.query('select p.sku, p.description, lo.lot_no, lo.expires_on, si.qty from set_items si join products p on p.id = si.product_id left join lots lo on lo.id = si.lot_id where si.set_id = $1 and si.qty > 0 order by p.sku', [s.id]),
        short: await db.query('select sku, description, kit_qty, in_set, short from set_shortfalls where set_code = $1', [s.code]),
        cases: await db.query('select c.code, c.surgery_on, c.status, h.code as hospital, cs.shipped_on, cs.delivered_at, cs.returned_on from case_sets cs join cases c on c.id = cs.case_id join hospitals h on h.id = c.hospital_id where cs.set_id = $1 order by c.surgery_on desc limit 10', [s.id]),
      };
    },
  },
  'book-case': {
    about: 'Book a surgical case',
    usage: 'book-case --code=C-1200 --hospital= --on=YYYY-MM-DD [--surgeon=] [--rep=] [--procedure=] [--patient=] [--po=] [--status=booked|confirmed]',
    async run(db, _p, o) {
      need(o, 'code', 'hospital', 'on');
      const h = await resolve(db, 'hospital', o.hospital);
      const sg = o.surgeon ? await resolve(db, 'surgeon', o.surgeon) : null;
      const r = o.rep ? await resolve(db, 'rep', o.rep) : null;
      const [row] = await db.query(
        `insert into cases (code, hospital_id, surgeon_id, rep_id, procedure, surgery_on, status, patient_ref, po_number)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning code, surgery_on, status`,
        [o.code, h.id, sg?.id ?? null, r?.id ?? null, typeof o.procedure === 'string' ? o.procedure : '', isoDate(o.on, 'on'), oneOf(o.status, CASE_STATUS, 'status') || 'booked', typeof o.patient === 'string' ? o.patient : '', typeof o.po === 'string' ? o.po : '']);
      await audit(db, 'case', row.code, 'insert', actorOf(o), { hospital: h.code });
      return [row];
    },
  },
  'update-case': {
    about: 'Move a case: date, status, purchase order, patient reference, charge sheet received',
    usage: 'update-case <case> [--on=YYYY-MM-DD] [--status=booked|confirmed|done|cancelled] [--po=] [--patient=] [--charge-sheet=YYYY-MM-DD]',
    async run(db, [key], o) {
      const c = await resolve(db, 'case', key);
      const [row] = await db.query(
        `update cases set surgery_on = coalesce($2::date, surgery_on), status = coalesce($3, status), po_number = coalesce($4, po_number),
           patient_ref = coalesce($5, patient_ref), charge_sheet_on = coalesce($6::date, charge_sheet_on)
         where id = $1 returning code, surgery_on, status, po_number, charge_sheet_on`,
        [c.id, isoDate(o.on, 'on'), oneOf(o.status, CASE_STATUS, 'status') ?? null, typeof o.po === 'string' ? o.po : null, typeof o.patient === 'string' ? o.patient : null, isoDate(o['charge-sheet'], 'charge-sheet')]);
      await audit(db, 'case', c.code, 'update', actorOf(o), o);
      return [row];
    },
  },
  'assign-set': {
    about: 'Book a loan set to a case, and say if it clashes',
    usage: 'assign-set <case> <set>',
    async run(db, [caseKey, setKey], o) {
      const c = await resolve(db, 'case', caseKey);
      const s = await resolve(db, 'set', setKey);
      if (['quarantine', 'retired'].includes(s.status)) throw new UsageError(`${s.code} is ${s.status} and cannot be booked`);
      await db.query('insert into case_sets (case_id, set_id) values ($1, $2) on conflict (case_id, set_id) do nothing', [c.id, s.id]);
      await audit(db, 'case', c.code, 'assign-set', actorOf(o), { set: s.code });
      const [chk] = await db.query('select set_code, deliver_by, items_short, items_expiring, clashes_with from case_set_checks where case_code = $1 and set_code = $2', [c.code, s.code]);
      return [chk ?? { set_code: s.code, note: 'case is past or not live' }];
    },
  },
  'unassign-set': {
    about: 'Take a set off a case before it ships',
    usage: 'unassign-set <case> <set>',
    async run(db, [caseKey, setKey], o) {
      const c = await resolve(db, 'case', caseKey);
      const s = await resolve(db, 'set', setKey);
      const gone = await db.query('delete from case_sets where case_id = $1 and set_id = $2 and shipped_on is null returning id', [c.id, s.id]);
      if (!gone.length) throw new UsageError(`${s.code} is not booked to ${c.code}, or has already shipped`);
      await audit(db, 'case', c.code, 'unassign-set', actorOf(o), { set: s.code });
      return [{ case: c.code, set: s.code, result: 'unassigned' }];
    },
  },
  'ship-set': {
    about: 'Record a set shipped to the case hospital',
    usage: 'ship-set <case> <set> [--on=YYYY-MM-DD]',
    async run(db, [caseKey, setKey], o) {
      const c = await resolve(db, 'case', caseKey);
      const s = await resolve(db, 'set', setKey);
      const r = await db.query('update case_sets set shipped_on = coalesce($3::date, current_date) where case_id = $1 and set_id = $2 returning shipped_on', [c.id, s.id, isoDate(o.on, 'on')]);
      if (!r.length) throw new UsageError(`${s.code} is not booked to ${c.code}; assign-set first`);
      await db.query("update sets set status = 'in_transit', hospital_id = $2 where id = $1", [s.id, c.hospital_id]);
      await audit(db, 'set', s.code, 'ship', actorOf(o), { case: c.code });
      return [{ set: s.code, case: c.code, shipped_on: r[0].shipped_on }];
    },
  },
  'deliver-set': {
    about: 'Record a set delivered to the hospital (date and time)',
    usage: 'deliver-set <case> <set> [--at=YYYY-MM-DDTHH:MM]',
    async run(db, [caseKey, setKey], o) {
      const c = await resolve(db, 'case', caseKey);
      const s = await resolve(db, 'set', setKey);
      const r = await db.query('update case_sets set delivered_at = coalesce($3::timestamp, localtimestamp), shipped_on = coalesce(shipped_on, current_date) where case_id = $1 and set_id = $2 returning delivered_at', [c.id, s.id, isoTime(o.at, 'at')]);
      if (!r.length) throw new UsageError(`${s.code} is not booked to ${c.code}; assign-set first`);
      await db.query("update sets set status = 'at_hospital', hospital_id = $2 where id = $1", [s.id, c.hospital_id]);
      await audit(db, 'set', s.code, 'deliver', actorOf(o), { case: c.code });
      return [{ set: s.code, case: c.code, delivered_at: r[0].delivered_at }];
    },
  },
  'return-set': {
    about: 'Record a set back from the hospital, waiting for its check',
    usage: 'return-set <set> [--on=YYYY-MM-DD]',
    async run(db, [key], o) {
      const s = await resolve(db, 'set', key);
      const r = await db.query(
        `update case_sets set returned_on = coalesce($2::date, current_date)
         where id = (select cs.id from case_sets cs join cases c on c.id = cs.case_id where cs.set_id = $1 and cs.shipped_on is not null and cs.returned_on is null order by c.surgery_on limit 1)
         returning case_id`, [s.id, isoDate(o.on, 'on')]);
      if (!r.length) throw new UsageError(`${s.code} is not out on a case`);
      await db.query("update sets set status = 'returned', hospital_id = null where id = $1", [s.id]);
      await audit(db, 'set', s.code, 'return', actorOf(o), {});
      return [{ set: s.code, status: 'returned', next: 'check-set once it has been checked and restocked' }];
    },
  },
  'check-set': {
    about: 'Check a returned set against its kit list, restock from its home warehouse, mark it available',
    usage: 'check-set <set> [--restock=SKU:LOT:QTY,SKU::QTY] [--remove=SKU:LOT:QTY]',
    async run(db, [key], o) {
      const s = await resolve(db, 'set', key);
      const parse = (v) => (typeof v === 'string' && v ? v.split(',').map((x) => { const [sku, lot, qty] = x.split(':'); return { sku, lot: lot || null, qty: Number(qty || 1) }; }) : []);
      for (const r of parse(o.remove)) {
        const p = await resolve(db, 'product', r.sku);
        const lotId = await lotFor(db, p.id, r.lot);
        const hit = await db.query('update set_items set qty = qty - $4 where set_id = $1 and product_id = $2 and coalesce(lot_id::text, \'\') = coalesce($3::text, \'\') and qty >= $4 returning id', [s.id, p.id, lotId, r.qty]);
        if (!hit.length) throw new UsageError(`${s.code} does not hold ${r.qty} of ${r.sku}${r.lot ? ' lot ' + r.lot : ''}`);
      }
      for (const r of parse(o.restock)) {
        const p = await resolve(db, 'product', r.sku);
        const lotId = await lotFor(db, p.id, r.lot);
        if (p.track === 'lot' && !lotId) throw new UsageError(`${r.sku} is lot tracked: give the lot, like ${r.sku}:L1234:1`);
        if (s.home_location_id && p.kind !== 'instrument') await adjustStock(db, s.home_location_id, p.id, lotId, -r.qty);
        const up = await db.query('update set_items set qty = qty + $4 where set_id = $1 and product_id = $2 and coalesce(lot_id::text, \'\') = coalesce($3::text, \'\') returning id', [s.id, p.id, lotId, r.qty]);
        if (!up.length) await db.query('insert into set_items (set_id, product_id, lot_id, qty) values ($1, $2, $3, $4)', [s.id, p.id, lotId, r.qty]);
      }
      await db.query('delete from set_items where set_id = $1 and qty = 0', [s.id]);
      const short = await db.query('select sku, short from set_shortfalls where set_code = $1', [s.code]);
      const expired = await db.query('select p.sku, lo.lot_no, lo.expires_on from set_items si join lots lo on lo.id = si.lot_id join products p on p.id = si.product_id where si.set_id = $1 and lo.expires_on < current_date + 30', [s.id]);
      const status = s.status === 'quarantine' ? 'quarantine' : 'available';
      await db.query('update sets set status = $2, hospital_id = null, last_checked_on = current_date where id = $1', [s.id, status]);
      await audit(db, 'set', s.code, 'check', actorOf(o), { restock: o.restock ?? null, remove: o.remove ?? null });
      return [{ set: s.code, status, items_short: short.reduce((n, r) => n + r.short, 0), short: short.map((r) => `${r.sku} x${r.short}`).join(', ') || null, expiring_within_30_days: expired.map((e) => `${e.sku} ${e.lot_no} ${e.expires_on}`).join(', ') || null }];
    },
  },
  'add-usage': {
    about: 'Record what was used on a case, from the charge sheet',
    usage: 'add-usage <case> --sku= [--lot=] [--serial=] [--qty=1] [--from=set|consignment|trunk] [--set=] [--location=] [--card]',
    async run(db, [key], o) {
      need(o, 'sku');
      const c = await resolve(db, 'case', key);
      const p = await resolve(db, 'product', o.sku);
      const qty = whole(o.qty, 'qty', 1) ?? 1;
      const source = oneOf(o.from, SOURCE, 'from') || (o.location ? 'consignment' : 'set');
      const lotId = await lotFor(db, p.id, o.lot);
      let setId = null;
      let locationId = null;
      if (source === 'set') {
        const s = o.set ? await resolve(db, 'set', o.set) : (await db.query('select s.id, s.code from case_sets cs join sets s on s.id = cs.set_id where cs.case_id = $1 order by s.code limit 1', [c.id]))[0];
        if (s) {
          setId = s.id;
          await db.query('update set_items set qty = greatest(qty - $4, 0) where set_id = $1 and product_id = $2 and coalesce(lot_id::text, \'\') = coalesce($3::text, \'\')', [s.id, p.id, lotId, qty]);
        }
      } else {
        const l = o.location ? await resolve(db, 'location', o.location) : (await db.query("select id from locations where hospital_id = $1 and kind = 'consignment' limit 1", [c.hospital_id]))[0];
        if (!l) throw new UsageError('name the --location the stock came from');
        locationId = l.id;
        await adjustStock(db, l.id, p.id, lotId, -qty);
      }
      const [row] = await db.query(
        `insert into usage (case_id, product_id, lot_id, serial_no, qty, source, set_id, location_id, implant_card_given, price_cents)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning qty, source, price_cents`,
        [c.id, p.id, lotId, typeof o.serial === 'string' ? o.serial : '', qty, source, setId, locationId, o.card === true || o.card === 'yes', p.price_cents]);
      await db.query("update cases set status = case when status in ('booked', 'confirmed') then 'done' else status end, charge_sheet_on = coalesce(charge_sheet_on, current_date) where id = $1", [c.id]);
      await audit(db, 'usage', c.code, 'insert', actorOf(o), { sku: p.code, lot: o.lot ?? null, qty });
      return [{ case: c.code, sku: p.code, ...row }];
    },
  },
  'bill-case': {
    about: 'Record a case invoiced',
    usage: 'bill-case <case> --invoice= [--on=YYYY-MM-DD] [--po=]',
    async run(db, [key], o) {
      need(o, 'invoice');
      const c = await resolve(db, 'case', key);
      const [v] = await db.query('select lines from case_value where id = $1', [c.id]);
      if (!v.lines) throw new UsageError(`${c.code} has no usage recorded; add-usage from the charge sheet first`);
      const [row] = await db.query('update cases set invoice_no = $2, billed_on = coalesce($3::date, current_date), po_number = coalesce($4, po_number) where id = $1 returning code, invoice_no, billed_on, po_number', [c.id, o.invoice, isoDate(o.on, 'on'), typeof o.po === 'string' ? o.po : null]);
      await audit(db, 'case', c.code, 'bill', actorOf(o), { invoice: o.invoice });
      return [row];
    },
  },
  'add-product': {
    about: 'Add a product to the catalogue',
    usage: 'add-product --sku= --description= [--kind=implant|instrument|consumable] [--track=lot|serial|none] [--card] [--price=] [--artg=] [--billing-code=] [--nz-first-supplied=YYYY-MM-DD] [--wand=YYYY-MM-DD]',
    async run(db, _p, o) {
      need(o, 'sku', 'description');
      const [row] = await db.query(
        `insert into products (sku, description, kind, track, card_required, price_cents, artg_no, billing_code, first_supplied_nz_on, wand_notified_on)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning sku, kind, track`,
        [o.sku, o.description, oneOf(o.kind, KIND, 'kind') || 'implant', oneOf(o.track, TRACK, 'track') || 'lot', o.card === true, cents(o.price, 'price') ?? 0,
         typeof o.artg === 'string' ? o.artg : '', typeof o['billing-code'] === 'string' ? o['billing-code'] : '', isoDate(o['nz-first-supplied'], 'nz-first-supplied'), isoDate(o.wand, 'wand')]);
      await audit(db, 'product', row.sku, 'insert', actorOf(o), {});
      return [row];
    },
  },
  'update-product': {
    about: 'Record an ARTG number, billing code, WAND notification, price or card rule',
    usage: 'update-product <sku> [--artg=] [--billing-code=] [--wand=YYYY-MM-DD] [--nz-first-supplied=YYYY-MM-DD] [--price=] [--card=yes|no]',
    async run(db, [key], o) {
      const p = await resolve(db, 'product', key);
      const card = o.card === undefined ? null : o.card === true || o.card === 'yes';
      const [row] = await db.query(
        `update products set artg_no = coalesce($2, artg_no), billing_code = coalesce($3, billing_code), wand_notified_on = coalesce($4::date, wand_notified_on),
           first_supplied_nz_on = coalesce($5::date, first_supplied_nz_on), price_cents = coalesce($6, price_cents), card_required = coalesce($7, card_required)
         where id = $1 returning sku, artg_no, billing_code, first_supplied_nz_on, wand_notified_on, price_cents, card_required`,
        [p.id, typeof o.artg === 'string' ? o.artg : null, typeof o['billing-code'] === 'string' ? o['billing-code'] : null, isoDate(o.wand, 'wand'), isoDate(o['nz-first-supplied'], 'nz-first-supplied'), cents(o.price, 'price'), card]);
      await audit(db, 'product', p.code, 'update', actorOf(o), o);
      return [row];
    },
  },
  'add-lot': {
    about: 'Add a lot with its expiry',
    usage: 'add-lot --sku= --lot= [--expires=YYYY-MM-DD]',
    async run(db, _p, o) {
      need(o, 'sku', 'lot');
      const p = await resolve(db, 'product', o.sku);
      const [row] = await db.query('insert into lots (product_id, lot_no, expires_on) values ($1,$2,$3) returning lot_no, expires_on', [p.id, o.lot, isoDate(o.expires, 'expires')]);
      await audit(db, 'lot', `${p.code} ${o.lot}`, 'insert', actorOf(o), {});
      return [{ sku: p.code, ...row }];
    },
  },
  receive: {
    about: 'Receive stock into a location (a lot is created if new)',
    usage: 'receive --location= --sku= --qty= [--lot=] [--expires=YYYY-MM-DD]',
    async run(db, _p, o) {
      need(o, 'location', 'sku', 'qty');
      const l = await resolve(db, 'location', o.location);
      const p = await resolve(db, 'product', o.sku);
      if (p.track === 'lot' && !o.lot) throw new UsageError(`${p.code} is lot tracked: give --lot`);
      const lotId = await lotFor(db, p.id, o.lot, { create: true, expires: isoDate(o.expires, 'expires') });
      await adjustStock(db, l.id, p.id, lotId, whole(o.qty, 'qty', 1));
      await audit(db, 'stock', `${l.code} ${p.code}`, 'receive', actorOf(o), { lot: o.lot ?? null, qty: o.qty });
      return db.query(reads.stock.sql, [l.code, p.code]);
    },
  },
  'move-stock': {
    about: 'Move stock between locations: warehouse, consignment, trunk, quarantine',
    usage: 'move-stock --from= --to= --sku= --qty= [--lot=]',
    async run(db, _p, o) {
      need(o, 'from', 'to', 'sku', 'qty');
      const from = await resolve(db, 'location', o.from);
      const to = await resolve(db, 'location', o.to);
      const p = await resolve(db, 'product', o.sku);
      const lotId = await lotFor(db, p.id, o.lot);
      const qty = whole(o.qty, 'qty', 1);
      await adjustStock(db, from.id, p.id, lotId, -qty);
      await adjustStock(db, to.id, p.id, lotId, qty);
      await audit(db, 'stock', p.code, 'move', actorOf(o), { from: from.code, to: to.code, lot: o.lot ?? null, qty });
      return [{ sku: p.code, lot: o.lot ?? null, qty, from: from.code, to: to.code }];
    },
  },
  'set-par': {
    about: 'Set the par level for a product at a consignment location',
    usage: 'set-par --location= --sku= --par=',
    async run(db, _p, o) {
      need(o, 'location', 'sku', 'par');
      const l = await resolve(db, 'location', o.location);
      const p = await resolve(db, 'product', o.sku);
      await db.query('insert into pars (location_id, product_id, par) values ($1,$2,$3) on conflict (location_id, product_id) do update set par = excluded.par', [l.id, p.id, whole(o.par, 'par')]);
      await audit(db, 'par', `${l.code} ${p.code}`, 'set', actorOf(o), { par: o.par });
      return db.query('select * from consignment_check where location = $1 and sku = $2', [l.code, p.code]);
    },
  },
  recall: {
    about: 'Open a market action (recall, product alert or correction) on a product or one lot',
    usage: 'recall --code= --sku= [--lot=] --country=NZ|AU|both [--kind=recall|product_alert|product_correction|hazard_alert] [--reason=] [--notified=YYYY-MM-DD]',
    async run(db, _p, o) {
      need(o, 'code', 'sku', 'country');
      const p = await resolve(db, 'product', o.sku);
      const lotId = await lotFor(db, p.id, o.lot);
      const country = String(o.country).toUpperCase() === 'BOTH' ? 'both' : String(o.country).toUpperCase();
      if (!['NZ', 'AU', 'both'].includes(country)) throw new UsageError('--country must be NZ, AU or both');
      await db.query('insert into market_actions (code, product_id, lot_id, kind, country, notified_on, reason) values ($1,$2,$3,$4,$5,coalesce($6::date, current_date),$7)',
        [o.code, p.id, lotId, oneOf(o.kind, ACTION_KIND, 'kind') || 'recall', country, isoDate(o.notified, 'notified'), typeof o.reason === 'string' ? o.reason : '']);
      await audit(db, 'market_action', o.code, 'insert', actorOf(o), { sku: p.code, lot: o.lot ?? null });
      return db.query('select * from recall_trace where action = $1 order by held_in, place', [o.code]);
    },
  },
  quarantine: {
    about: 'Pull every affected unit of a market action: stock to quarantine, sets on hold',
    usage: 'quarantine <action> [--to=<quarantine location>]',
    async run(db, [key], o) {
      const a = await resolve(db, 'action', key);
      const q = o.to ? await resolve(db, 'location', o.to) : (await db.query("select id, code from locations where kind = 'quarantine' order by code limit 1"))[0];
      if (!q) throw new UsageError('no quarantine location; add one to locations with kind quarantine');
      const rows = await db.query(
        `select st.location_id, st.product_id, st.lot_id, st.qty, l.code from stock st join locations l on l.id = st.location_id
         where st.product_id = $1 and ($2::uuid is null or st.lot_id = $2) and st.qty > 0 and l.kind <> 'quarantine'`, [a.product_id, a.lot_id]);
      for (const r of rows) {
        await adjustStock(db, r.location_id, r.product_id, r.lot_id, -r.qty);
        await adjustStock(db, q.id, r.product_id, r.lot_id, r.qty);
      }
      const sets = await db.query(
        `update sets set status = 'quarantine' where id in (select si.set_id from set_items si where si.product_id = $1 and ($2::uuid is null or si.lot_id = $2) and si.qty > 0)
           and status not in ('retired') returning code`, [a.product_id, a.lot_id]);
      await audit(db, 'market_action', a.code, 'quarantine', actorOf(o), { stock_rows: rows.length, sets: sets.map((s) => s.code) });
      return [{ action: a.code, stock_moved_from: rows.map((r) => `${r.code} x${r.qty}`).join(', ') || null, sets_on_hold: sets.map((s) => s.code).join(', ') || null, next: 'swap the affected items out of each set with check-set --remove, then check-set to release it' }];
    },
  },
  'close-recall': {
    about: 'Close a market action once every unit is accounted for',
    usage: 'close-recall <action>',
    async run(db, [key], o) {
      const a = await resolve(db, 'action', key);
      const open = await db.query("select held_in, place, qty from recall_trace where action = $1 and held_in in ('stock', 'set')", [a.code]);
      if (open.length && o.force !== true) throw new UsageError(`${a.code} still has ${open.length} location(s) holding affected units; quarantine first, or --force`);
      await db.query("update market_actions set status = 'closed' where id = $1", [a.id]);
      await audit(db, 'market_action', a.code, 'close', actorOf(o), {});
      return [{ action: a.code, status: 'closed' }];
    },
  },
  log: {
    about: 'Log a call, email, visit or note against a case or a hospital',
    usage: 'log <case or hospital> --body= [--kind=call|email|visit|meeting|note]',
    async run(db, [key], o) {
      need(o, 'body');
      let caseId = null;
      let hospitalId = null;
      try {
        const c = await resolve(db, 'case', key);
        caseId = c.id;
        hospitalId = c.hospital_id;
      } catch (e) {
        if (!(e instanceof UsageError) || /Ambiguous/.test(e.message)) throw e;
        hospitalId = (await resolve(db, 'hospital', key)).id;
      }
      await db.query('insert into notes (case_id, hospital_id, kind, body, actor) values ($1,$2,$3,$4,$5)', [caseId, hospitalId, oneOf(o.kind, NOTE_KIND, 'kind') || 'note', o.body, actorOf(o)]);
      await audit(db, 'note', key, 'insert', actorOf(o), {});
      return [{ logged: key, kind: o.kind || 'note' }];
    },
  },
  import: {
    about: 'Import stock on hand, kit lists or case history from a Movemedical (or any) CSV export',
    usage: 'import stock <file.csv> [--mapping=map.json] [--dry-run]\n         import kits <file.csv> [--dry-run]\n         import cases <file.csv> [--dry-run]\n         (import movemedical <file.csv> is the same as import stock)',
    async run(db, [kind, file], o) {
      const k = kind === 'movemedical' ? 'stock' : kind;
      if (!['stock', 'kits', 'cases'].includes(k)) throw new UsageError('import stock|kits|cases <file.csv>');
      if (!file || !fs.existsSync(file)) throw new UsageError(`file not found: ${file}`);
      const bytes = fs.readFileSync(file);
      const fingerprint = createHash('sha256').update(bytes).digest('hex');
      const rows = parseCsv(bytes.toString('utf8'));
      const seen = await db.query('select filename from import_batches where fingerprint = $1', [fingerprint]);
      if (seen.length) return [{ result: 'skipped', reason: `identical file already imported as ${seen[0].filename}`, rows: rows.length }];
      const dry = o['dry-run'] === true;
      await db.exec('BEGIN');
      try {
        const result = k === 'stock' ? await importStock(db, rows, o) : k === 'kits' ? await importKits(db, rows) : await importCases(db, rows);
        if (dry) {
          await db.exec('ROLLBACK');
          return [{ result: 'dry run, nothing saved', rows: rows.length, ...result }];
        }
        await db.query('insert into import_batches (source, filename, fingerprint, row_count, actor) values ($1,$2,$3,$4,$5)', [k, path.basename(file), fingerprint, rows.length, actorOf(o)]);
        await audit(db, 'import', path.basename(file), k, actorOf(o), result);
        await db.exec('COMMIT');
        return [{ result: 'imported', rows: rows.length, ...result }];
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    },
  },
  export: {
    about: 'Write every table to CSV and JSON in a new folder',
    usage: 'export [--out=exports/2026-11-16]',
    async run(db, _p, o) {
      const out = path.resolve(REPO_ROOT, typeof o.out === 'string' ? o.out : path.join('exports', new Date().toISOString().replace(/[:.]/g, '-')));
      if (fs.existsSync(out) && fs.readdirSync(out).length) throw new UsageError(`${out} is not empty`);
      fs.mkdirSync(out, { recursive: true, mode: 0o700 });
      const tables = ['hospitals', 'surgeons', 'reps', 'products', 'lots', 'locations', 'stock', 'pars', 'kits', 'kit_lines', 'sets', 'set_items', 'cases', 'case_sets', 'usage', 'market_actions', 'notes', 'import_batches', 'audit_log'];
      const manifest = [];
      for (const t of tables) {
        const rows = await db.query(`select * from ${t}`);
        fs.writeFileSync(path.join(out, `${t}.json`), JSON.stringify(rows, null, 2));
        fs.writeFileSync(path.join(out, `${t}.csv`), toCsv(rows));
        manifest.push({ table: t, rows: rows.length });
      }
      fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ exported_at: new Date().toISOString(), tables: manifest }, null, 2));
      return manifest.map((m) => ({ ...m, folder: path.relative(REPO_ROOT, out) }));
    },
  },
  'weekly-review': {
    about: 'Write the Monday review: cases at risk, sets, money in the field, rules',
    usage: 'weekly-review',
    async run(db) {
      const q = (name) => db.query(reads[name].sql, reads[name].params ? reads[name].params({}) : []);
      const results = [];
      for (const name of ['readiness', 'returns', 'unbilled', 'consignment', 'slow-stock', 'compliance', 'utilisation', 'rep-load']) results.push(await q(name));
      const [ready, returns, unbilled, cons, slow, findings, util, load] = results;
      const atRisk = ready.filter((r) => r.issue !== 'ok');
      const waiting = unbilled.reduce((s, r) => s + Number(r.value_cents || 0), 0);
      const parked = slow.reduce((s, r) => s + Number(r.value_cents || 0), 0);
      const lines = [
        `# Weekly review, ${today()}`,
        '',
        '## Cases in the next 14 days',
        `- ${ready.length} cases booked, ${atRisk.length} with a problem.`,
        ...atRisk.map((r) => `  - ${r.code} ${r.hospital} ${r.surgery_on} (${r.rep || 'no rep'}): ${r.issue}.`),
        '',
        '## Sets',
        ...(returns.length ? returns.map((r) => `- ${r.set_code} still at ${r.hospital} ${r.days_out} days after ${r.case_code}.`) : ['- Every set is back on time.']),
        ...util.filter((u) => u.cases_90_days === 0 && u.booked_ahead === 0).map((u) => `- ${u.set_code} has not been used in 90 days and nothing is booked: pull it back or move it.`),
        '',
        '## Money',
        `- ${unbilled.length} cases done and not invoiced, ${dollars(waiting)} of recorded usage between them.`,
        ...unbilled.map((u) => `  - ${u.code} ${u.hospital}, ${u.days_since} days: ${u.issue}.`),
        `- ${slow.length} stock lines have sat in the field for 180 days, ${dollars(parked)} at list price.`,
        ...cons.filter((c) => c.to_replenish > 0).map((c) => `- Replenish ${c.location}: ${c.sku} x${c.to_replenish}.`),
        '',
        '## Rules',
        ...(findings.length ? findings.map((f) => `- ${f.rule} ${f.record}: ${f.detail}. ${f.source}.`) : ['- Nothing out of rule.']),
        '',
        '## Reps',
        ...load.map((l) => `- ${l.name}: ${l.cases_next_7_days} cases this week, ${l.cases_with_issues} with problems, ${l.overdue_returns} sets overdue, ${l.unbilled_cases} unbilled.`),
        '',
        'Draft only. Check each case with the hospital before acting on it.',
      ];
      const file = writeDraft('weekly-review', lines.join('\n') + '\n');
      return [{ draft: path.relative(REPO_ROOT, file), cases_at_risk: atRisk.length, overdue_returns: returns.length, unbilled_cases: unbilled.length, findings: findings.length }];
    },
  },
  'draft-case-confirmation': {
    about: 'Draft the email to theatre or sterilising services confirming which sets arrive when',
    usage: 'draft-case-confirmation <case>',
    async run(db, [key]) {
      const c = await resolve(db, 'case', key);
      const [d] = await db.query(
        `select c.code, c.surgery_on, c.procedure, c.patient_ref, h.name as hospital, h.theatre_contact, h.theatre_email, h.loan_lead_hours, sg.name as surgeon, r.name as rep
         from cases c join hospitals h on h.id = c.hospital_id left join surgeons sg on sg.id = c.surgeon_id left join reps r on r.id = c.rep_id where c.id = $1`, [c.id]);
      const sets = await db.query('select set_code, deliver_by, delivered_at, items_short, items_expiring, clashes_with from case_set_checks where case_code = $1 order by set_code', [c.code]);
      if (!sets.length) throw new UsageError(`${c.code} has no set booked; assign-set first`);
      const problems = sets.filter((s) => s.items_short || s.items_expiring || s.clashes_with);
      const fmt = (t) => (t instanceof Date ? t.toISOString().slice(0, 16).replace('T', ' ') : String(t).slice(0, 16));
      const body = [
        ...(problems.length ? [`OFFICE NOTE, delete before sending: ${problems.map((s) => `${s.set_code}${s.items_short ? ` is ${s.items_short} short` : ''}${s.items_expiring ? `, ${s.items_expiring} expiring` : ''}${s.clashes_with ? `, also booked on ${s.clashes_with}` : ''}`).join('; ')}.`, ''] : []),
        `To: ${d.theatre_email}`,
        `Subject: Loan sets for ${d.surgeon || 'theatre'}, ${d.surgery_on}, ${d.procedure}`,
        '',
        `Hi ${d.theatre_contact || 'there'},`,
        '',
        `Confirming the loan sets for ${d.surgeon || 'the surgeon'}'s ${d.procedure} on ${d.surgery_on} (${d.patient_ref || 'patient reference to follow'}).`,
        '',
        ...sets.map((s) => `- ${s.set_code}: ${s.delivered_at ? `delivered ${fmt(s.delivered_at)}` : `arriving by ${fmt(s.deliver_by)}, inside your ${d.loan_lead_hours}-hour lead time`}`),
        '',
        `${d.rep || 'Your rep'} will be in theatre. Reply here if the list moves.`,
        '',
        'Thanks,',
        d.rep || 'Customer service',
      ].join('\n');
      return [{ draft: path.relative(REPO_ROOT, writeDraft(`case-confirmation-${c.code}`, body + '\n')), problems: problems.length }];
    },
  },
  'draft-charge-chase': {
    about: 'Draft the email to the hospital for a missing charge sheet or purchase order',
    usage: 'draft-charge-chase <case>',
    async run(db, [key]) {
      const c = await resolve(db, 'case', key);
      const [u] = await db.query('select * from unbilled_cases where code = $1', [c.code]);
      if (!u) throw new UsageError(`${c.code} is not waiting on billing`);
      if (u.issue === 'ready to invoice') throw new UsageError(`${c.code} is ready to invoice; nothing to chase`);
      const [d] = await db.query('select c.surgery_on, c.procedure, c.patient_ref, h.name as hospital, h.accounts_email, h.theatre_email, sg.name as surgeon from cases c join hospitals h on h.id = c.hospital_id left join surgeons sg on sg.id = c.surgeon_id where c.id = $1', [c.id]);
      const lines = await db.query('select p.sku, p.description, lo.lot_no, u.serial_no, u.qty from usage u join products p on p.id = u.product_id left join lots lo on lo.id = u.lot_id where u.case_id = $1 order by p.sku', [c.id]);
      const noSheet = u.issue.startsWith('no usage');
      const body = [
        `To: ${noSheet ? d.theatre_email : d.accounts_email}`,
        `Subject: ${noSheet ? 'Charge sheet' : 'Purchase order'} for ${d.procedure}, ${d.surgery_on}`,
        '',
        'Hi there,',
        '',
        noSheet
          ? `Could you send the implant charge sheet for ${d.surgeon || 'the'} ${d.procedure} on ${d.surgery_on} (${d.patient_ref || 'our case ' + c.code})? We need it to invoice and to keep the implant records complete.`
          : `Could you send a purchase order for ${d.surgeon || 'the'} ${d.procedure} on ${d.surgery_on} (${d.patient_ref || 'our case ' + c.code})? The items used were:`,
        ...(noSheet ? [] : ['', ...lines.map((l) => `- ${l.sku} ${l.description}${l.lot_no ? `, lot ${l.lot_no}` : ''}${l.serial_no ? `, serial ${l.serial_no}` : ''}, qty ${l.qty}`)]),
        '',
        'Thanks,',
        'Customer service',
      ].join('\n');
      return [{ draft: path.relative(REPO_ROOT, writeDraft(`charge-chase-${c.code}`, body + '\n')), asking_for: noSheet ? 'charge sheet' : 'purchase order' }];
    },
  },
  'draft-replenishment': {
    about: 'Draft the pick list to bring a consignment location back to par, picking shortest expiry first',
    usage: 'draft-replenishment <location> [--from=<warehouse>]',
    async run(db, [key], o) {
      const l = await resolve(db, 'location', key);
      const from = o.from ? await resolve(db, 'location', o.from) : (await db.query("select id, code from locations where kind = 'warehouse' and country = $1 order by code limit 1", [l.country]))[0];
      const need = await db.query('select sku, description, par, on_hand, to_replenish from consignment_check where location = $1 and to_replenish > 0 order by sku', [l.code]);
      if (!need.length) throw new UsageError(`${l.code} is at par`);
      const lines = [`# Pick list: replenish ${l.name} (${l.code}) from ${from?.code || 'the warehouse'}`, '', '| SKU | Description | Par | On hand | Send | Pick from lots |', '|---|---|---|---|---|---|'];
      for (const n of need) {
        const lots = from ? await db.query(
          `select lo.lot_no, lo.expires_on, st.qty from stock st join products p on p.id = st.product_id left join lots lo on lo.id = st.lot_id
           where st.location_id = $1 and p.sku = $2 and st.qty > 0 and (lo.expires_on is null or lo.expires_on > current_date + 90) order by lo.expires_on nulls last`, [from.id, n.sku]) : [];
        lines.push(`| ${n.sku} | ${n.description} | ${n.par} | ${n.on_hand} | ${n.to_replenish} | ${lots.map((x) => `${x.lot_no || 'no lot'} (exp ${x.expires_on ? new Date(x.expires_on).toISOString().slice(0, 10) : 'none'}, ${x.qty} on hand)`).join('; ') || 'none in stock with 90 days of life'} |`);
      }
      lines.push('', 'Lots expiring within 90 days are left out. Record the move with move-stock once it is picked.');
      return [{ draft: path.relative(REPO_ROOT, writeDraft(`replenish-${l.code}`, lines.join('\n') + '\n')), lines: need.length }];
    },
  },
  'draft-recall-notice': {
    about: 'Draft one recall letter per hospital listing the affected units it holds or implanted',
    usage: 'draft-recall-notice <action>',
    async run(db, [key]) {
      const a = await resolve(db, 'action', key);
      const [m] = await db.query('select ma.code, ma.kind, ma.reason, ma.notified_on, ma.country, p.sku, p.description, lo.lot_no from market_actions ma join products p on p.id = ma.product_id left join lots lo on lo.id = ma.lot_id where ma.id = $1', [a.id]);
      const trace = await db.query("select * from recall_trace where action = $1 and hospital is not null order by hospital, held_in", [a.code]);
      const byHospital = new Map();
      for (const t of trace) byHospital.set(t.hospital, [...(byHospital.get(t.hospital) || []), t]);
      const drafts = [];
      for (const [code, rows] of byHospital) {
        const [h] = await db.query('select name, theatre_email, accounts_email from hospitals where code = $1', [code]);
        const body = [
          `To: ${h.theatre_email}`,
          `Subject: ${m.kind.replace('_', ' ')} ${m.code}: ${m.sku} ${m.description}${m.lot_no ? `, lot ${m.lot_no}` : ''}`,
          '',
          `To the theatre and sterilising services team at ${h.name},`,
          '',
          `We have opened a ${m.kind.replace('_', ' ')} for ${m.description} (${m.sku}${m.lot_no ? `, lot ${m.lot_no}` : ', all lots'}). Reason: ${m.reason || '[state the reason as notified to the regulator]'}.`,
          '',
          'Our records show these affected units at or through your hospital:',
          ...rows.map((r) => r.held_in === 'patient' ? `- Implanted: case ${r.case_code}, surgery ${new Date(r.surgery_on).toISOString().slice(0, 10)}, ${r.patient_ref || 'patient reference on file'}, qty ${r.qty}` : `- In ${r.held_in === 'set' ? 'loan set' : 'consignment stock'} ${r.place}: qty ${r.qty}. Please set these aside; we will collect them.`),
          '',
          '[Set out the action the hospital should take, as agreed with the TGA or Medsafe for this market action.]',
          '',
          'Please confirm you have received this notice by replying to this email.',
          '',
          'Regulatory affairs',
        ].join('\n');
        drafts.push({ hospital: code, draft: path.relative(REPO_ROOT, writeDraft(`recall-${m.code}-${code}`, body + '\n')), units: rows.reduce((n, r) => n + r.qty, 0) });
      }
      if (!drafts.length) throw new UsageError(`no affected units at any hospital for ${a.code}`);
      return drafts;
    },
  },
  help: {
    about: 'This list',
    usage: 'help',
    async run() {
      return [...Object.entries(reads).map(([name, r]) => ({ command: name, does: r.about })), ...Object.entries(commands).map(([name, c]) => ({ command: name, does: c.about }))];
    },
  },
};

export const commandNames = [...Object.keys(reads), ...Object.keys(commands)];

// ---------------------------------------------------------------- import helpers

// Column names seen in field inventory and loaner exports. Anything else: --mapping=map.json
// with {"sku": "Your Column", ...}.
const STOCK_MAP = {
  location: ['Location', 'Location Name', 'Inventory Location', 'Site', 'Facility', 'Account', 'location'],
  location_type: ['Location Type', 'Type', 'Inventory Type', 'location_type'],
  sku: ['Item Number', 'Item', 'Part Number', 'Product Code', 'SKU', 'Catalog Number', 'Reference', 'REF', 'sku'],
  description: ['Item Description', 'Description', 'Product Description', 'description'],
  lot: ['Lot', 'Lot Number', 'Lot/Serial', 'Batch', 'lot'],
  serial: ['Serial', 'Serial Number', 'serial'],
  expires: ['Expiration Date', 'Expiry', 'Expiry Date', 'Use By', 'expires'],
  qty: ['Quantity', 'Qty', 'On Hand', 'Qty On Hand', 'qty'],
  country: ['Country', 'country'],
};
function normDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // day first, as NZ and AU write it
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  throw new UsageError(`cannot read the date "${s}"; use YYYY-MM-DD or DD/MM/YYYY`);
}
const slugCode = (s, n = 16) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, n).replace(/-$/, '') || 'UNKNOWN';
async function uniqueCode(db, tableName, base) {
  for (let i = 1; ; i++) {
    const code = i === 1 ? base : `${base}-${i}`;
    if (!(await db.query(`select 1 from ${tableName} where code = $1`, [code])).length) return code;
  }
}
async function productBySku(db, sku, description, counts) {
  let [p] = await db.query('select id, track from products where lower(sku) = lower($1)', [sku]);
  if (!p) {
    [p] = await db.query("insert into products (sku, description) values ($1, $2) returning id, track", [sku, description || sku]);
    counts.products_added++;
  }
  return p;
}

async function importStock(db, rows, o) {
  let map = STOCK_MAP;
  if (typeof o.mapping === 'string') {
    const custom = JSON.parse(fs.readFileSync(o.mapping, 'utf8'));
    map = { ...STOCK_MAP, ...Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])) };
  }
  const get = (row, f) => pick(row, ...map[f]);
  const counts = { products_added: 0, lots_added: 0, locations_added: 0, stock_lines: 0, units: 0 };
  for (const [i, row] of rows.entries()) {
    const sku = get(row, 'sku');
    const locName = get(row, 'location');
    const qty = Number(get(row, 'qty') || 0);
    if (!sku || !locName) throw new UsageError(`row ${i + 2}: item number and location are required`);
    if (!Number.isInteger(qty) || qty < 0) throw new UsageError(`row ${i + 2}: quantity must be a whole number`);
    const p = await productBySku(db, sku, get(row, 'description'), counts);
    let [loc] = await db.query('select id from locations where lower(code) = lower($1) or lower(name) = lower($1)', [locName]);
    if (!loc) {
      const t = get(row, 'location_type').toLowerCase();
      const kind = /consign|hospital|facility|account/.test(t) ? 'consignment' : /trunk|rep|car/.test(t) ? 'trunk' : /quarant|hold/.test(t) ? 'quarantine' : 'warehouse';
      const country = (get(row, 'country') || o.country || 'NZ').toUpperCase().slice(0, 2) === 'AU' ? 'AU' : 'NZ';
      [loc] = await db.query('insert into locations (code, name, kind, country) values ($1, $2, $3, $4) returning id', [await uniqueCode(db, 'locations', slugCode(locName)), locName, kind, country]);
      counts.locations_added++;
    }
    const lotNo = get(row, 'lot') || null;
    let lotId = null;
    if (lotNo) {
      const [l] = await db.query('select id from lots where product_id = $1 and lower(lot_no) = lower($2)', [p.id, lotNo]);
      if (l) lotId = l.id;
      else {
        [{ id: lotId }] = await db.query('insert into lots (product_id, lot_no, expires_on) values ($1, $2, $3) returning id', [p.id, lotNo, normDate(get(row, 'expires'))]);
        counts.lots_added++;
      }
    }
    if (qty > 0) await adjustStock(db, loc.id, p.id, lotId, qty);
    counts.stock_lines++;
    counts.units += qty;
  }
  return counts;
}

async function importKits(db, rows) {
  const counts = { kits_added: 0, products_added: 0, lines: 0 };
  for (const [i, row] of rows.entries()) {
    const kitName = pick(row, 'Kit', 'Kit Name', 'Set', 'Set Name', 'Tray', 'kit');
    const sku = pick(row, 'Item Number', 'Item', 'Part Number', 'SKU', 'Catalog Number', 'sku');
    const qty = Number(pick(row, 'Quantity', 'Qty', 'Par', 'qty') || 1);
    if (!kitName || !sku) throw new UsageError(`row ${i + 2}: kit and item number are required`);
    let [k] = await db.query('select id from kits where lower(code) = lower($1) or lower(name) = lower($1)', [kitName]);
    if (!k) {
      [k] = await db.query('insert into kits (code, name) values ($1, $2) returning id', [await uniqueCode(db, 'kits', slugCode(kitName)), kitName]);
      counts.kits_added++;
    }
    const p = await productBySku(db, sku, pick(row, 'Item Description', 'Description', 'description'), counts);
    await db.query('insert into kit_lines (kit_id, product_id, qty) values ($1, $2, $3) on conflict (kit_id, product_id) do update set qty = excluded.qty', [k.id, p.id, qty]);
    counts.lines++;
  }
  return counts;
}

async function importCases(db, rows) {
  const counts = { cases_added: 0, cases_updated: 0, hospitals_added: 0 };
  for (const [i, row] of rows.entries()) {
    const code = pick(row, 'Case ID', 'Case Number', 'Case', 'code');
    const facility = pick(row, 'Facility', 'Hospital', 'Account', 'hospital');
    const on = normDate(pick(row, 'Surgery Date', 'Procedure Date', 'Case Date', 'Date', 'surgery_on'));
    if (!code || !facility || !on) throw new UsageError(`row ${i + 2}: case ID, facility and surgery date are required`);
    let [h] = await db.query('select id from hospitals where lower(code) = lower($1) or lower(name) = lower($1)', [facility]);
    if (!h) {
      const country = /^AU/i.test(pick(row, 'Country')) ? 'AU' : 'NZ';
      [h] = await db.query('insert into hospitals (code, name, country) values ($1, $2, $3) returning id', [await uniqueCode(db, 'hospitals', slugCode(facility, 10)), facility, country]);
      counts.hospitals_added++;
    }
    const surgeonName = pick(row, 'Surgeon', 'Physician', 'Doctor');
    let surgeonId = null;
    if (surgeonName) {
      let [s] = await db.query('select id from surgeons where lower(name) = lower($1)', [surgeonName]);
      if (!s) [s] = await db.query('insert into surgeons (code, name, hospital_id) values ($1, $2, $3) returning id', [await uniqueCode(db, 'surgeons', slugCode(surgeonName, 10)), surgeonName, h.id]);
      surgeonId = s.id;
    }
    const repName = pick(row, 'Rep', 'Sales Rep', 'Representative');
    let repId = null;
    if (repName) {
      let [r] = await db.query('select id from reps where lower(name) = lower($1)', [repName]);
      if (!r) [r] = await db.query('insert into reps (code, name) values ($1, $2) returning id', [await uniqueCode(db, 'reps', slugCode(repName, 10)), repName]);
      repId = r.id;
    }
    const st = pick(row, 'Status', 'Case Status').toLowerCase();
    const status = /cancel/.test(st) ? 'cancelled' : /complete|closed|done|billed/.test(st) ? 'done' : /confirm/.test(st) ? 'confirmed' : 'booked';
    const [r] = await db.query(
      `insert into cases (code, hospital_id, surgeon_id, rep_id, procedure, surgery_on, status, po_number)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (code) do update set hospital_id = excluded.hospital_id, surgeon_id = coalesce(excluded.surgeon_id, cases.surgeon_id), rep_id = coalesce(excluded.rep_id, cases.rep_id),
         procedure = excluded.procedure, surgery_on = excluded.surgery_on, status = excluded.status, po_number = coalesce(nullif(excluded.po_number, ''), cases.po_number)
       returning (xmax = 0) as inserted`,
      [code, h.id, surgeonId, repId, pick(row, 'Procedure', 'Procedure Type'), on, status, pick(row, 'PO', 'PO Number', 'Purchase Order')]);
    r.inserted ? counts.cases_added++ : counts.cases_updated++;
  }
  return counts;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- run

export async function run(db, argv) {
  const { pos, opts } = parseArgs(argv);
  const [name = 'help', ...rest] = pos;
  if (reads[name]) {
    const r = reads[name];
    return db.query(r.sql, r.params ? r.params(opts) : []);
  }
  if (commands[name]) return commands[name].run(db, rest, opts);
  throw new UsageError(`unknown command "${name}". Try: help`);
}

function render(name, result, asJson) {
  if (asJson) return JSON.stringify(result, null, 2);
  if (name === 'help') {
    return 'Loan Sets for Claude Code\n\n  npm run sets -- <command> [options] [--json]\n\n' + printRows(result) + '\n\nUsage for a command: npm run sets -- usage <command>';
  }
  if (Array.isArray(result)) return printRows(result);
  return Object.entries(result).map(([k, v]) => `${k.toUpperCase()}\n${Array.isArray(v) ? printRows(v) : printRows([v])}`).join('\n\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  if (args[0] === 'usage') {
    const c = commands[args[1]];
    console.log(c ? `npm run sets -- ${c.usage}` : reads[args[1]] ? `npm run sets -- ${args[1]} [--json]   ${reads[args[1]].about}` : 'unknown command');
    process.exit(c || reads[args[1]] ? 0 : 1);
  }
  const db = await getDb();
  try {
    const result = await run(db, args);
    console.log(render(args.find((a) => !a.startsWith('--')) || 'help', result, asJson));
  } catch (error) {
    console.error(error instanceof UsageError ? `sets: ${error.message}` : error.stack || error.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
