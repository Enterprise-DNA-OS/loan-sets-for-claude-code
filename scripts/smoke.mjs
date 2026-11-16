#!/usr/bin/env node
// npm test: a temporary database, migrate twice, seed twice, then every command, with assertions.
// Uses the embedded database unless SETS_TEST_POSTGRES_URL or TEST_DATABASE_URL names a
// disposable Postgres. Never point this at a working database: it seeds demo data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';
import { run, reads, commands, resolve } from './sets.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loansets-test-'));
process.env.DATABASE_URL = process.env.SETS_TEST_POSTGRES_URL || process.env.TEST_DATABASE_URL || '';
process.env.DATA_DIR = path.join(tmp, 'db');
process.env.OUTPUT_DIR = path.join(tmp, 'out');
process.env.DRAFTS_DIR = path.join(tmp, 'drafts');
process.env.SETS_ACTOR = 'Test operator';

const db = await getDb();
let checks = 0;
const ok = (v, msg) => { assert.ok(v, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const rejects = async (args, pattern) => { await assert.rejects(() => run(db, args), pattern); checks++; };
const count = async (args) => (await run(db, args)).length;
const draftText = (r) => fs.readFileSync(path.join(process.env.DRAFTS_DIR, path.basename(r.draft)), 'utf8');
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const rules = async () => (await run(db, ['compliance'])).map((f) => f.rule).sort();
const issueOf = async (code) => (await run(db, ['readiness'])).find((r) => r.code === code)?.issue;

try {
  if (db.mode === 'postgres') {
    await db.exec('drop schema public cascade; create schema public;');
  }
  eq((await migrate(db)).ran.length, 1, 'first migrate applies 0001');
  eq((await migrate(db)).ran.length, 0, 'second migrate is a no-op');
  await seed(db);
  const [{ n: before }] = await db.query('select count(*)::int n from cases');
  await seed(db);
  eq((await db.query('select count(*)::int n from cases'))[0].n, before, 'seed is idempotent');

  // Every read runs.
  for (const name of Object.keys(reads)) ok(Array.isArray(await run(db, [name])), name);

  // The demo's planted problems.
  eq(await count(['readiness']), 6, 'six cases in the next 14 days');
  ok((await issueOf('C-1101')).includes('not delivered, was due'), 'tomorrow\'s set is late inside the lead time');
  ok((await issueOf('C-1101')).includes('1 item(s) short'), 'and short of its kit list');
  eq(await issueOf('C-1106'), 'no set booked');
  eq(await issueOf('C-1102'), 'ok');
  ok((await issueOf('C-1105')).includes('2 item(s) expire before surgery'));
  eq((await run(db, ['clashes'])).map((r) => r.case_code).sort(), ['C-1103', 'C-1104'], 'HP-02 is double-booked');
  eq((await run(db, ['shortfalls'])).map((r) => `${r.set_code} ${r.sku} ${r.short}`), ['KN-01 KN-INS-10 1']);
  eq((await run(db, ['returns'])).map((r) => [r.set_code, r.days_out]), [['KN-02', 6]]);
  const unbilled = await run(db, ['unbilled']);
  eq(unbilled.map((u) => u.code).sort(), ['C-1090', 'C-1091', 'C-1092'], 'cancelled and billed cases drop off');
  eq(unbilled.find((u) => u.code === 'C-1092').issue, 'no usage recorded: chase the charge sheet');
  eq(unbilled.find((u) => u.code === 'C-1091').issue, 'usage in, no purchase order');
  eq(Number(unbilled.find((u) => u.code === 'C-1090').value_cents), 661000);
  eq((await run(db, ['consignment'])).filter((c) => c.to_replenish > 0).map((c) => `${c.location} ${c.sku} ${c.to_replenish}`).sort(), ['BRP-CON HIP-HD-32 2', 'NHP-CON KN-INS-10 3']);
  eq(await count(['consignment', '--location=nhp-con']), 3);
  eq((await run(db, ['slow-stock'])).map((s) => s.location).sort(), ['NHP-CON', 'TRK-JR']);
  eq(await count(['expiring']), 3);
  eq((await run(db, ['recall-trace'])).map((t) => t.held_in).sort(), ['patient', 'set', 'stock']);
  eq(await rules(), ['H01', 'H02', 'R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R06']);
  ok((await run(db, ['compliance'])).filter((f) => f.rule.startsWith('R')).every((f) => /Act|Regulations|Rules|Procedure/.test(f.source)), 'every statutory finding cites its source');
  ok((await run(db, ['attention'])).length >= 15, 'attention gathers everything');
  eq((await run(db, ['utilisation'])).find((u) => u.set_code === 'HP-02').cases_90_days, 0);
  eq((await run(db, ['rep-load'])).find((r) => r.code === 'MT').overdue_returns, 1);
  ok((await run(db, ['surgeon-usage'])).some((s) => s.surgeon === 'Dr Fiona Bell' && s.sku === 'HIP-STM-12'));
  eq(await count(['cases', '--hospital=nhp']), 2);
  eq(await count(['stock', '--location=WH-AKL']), 4);

  // Matching.
  eq((await resolve(db, 'case', 'c-1101')).code, 'C-1101');
  eq((await resolve(db, 'product', 'augment')).code, 'WDG-AUG-5');
  eq((await resolve(db, 'hospital', 'waitaha')).code, 'WGH');
  await assert.rejects(() => resolve(db, 'case', 'walker'), /Ambiguous case/); checks++;
  await assert.rejects(() => resolve(db, 'set', 'ZZ-99'), /no set matches/); checks++;
  const profile = await run(db, ['case', 'C-1091']);
  eq(profile.usage.length, 4);
  eq(Number(profile.case.value_cents), 634000);
  const set = await run(db, ['set', 'KN-01']);
  eq(set.short[0].sku, 'KN-INS-10');

  // The late set: restock it, ship it, deliver it. H01 and the shortfall clear.
  const checked = await run(db, ['check-set', 'KN-01', '--restock=KN-INS-10:L2401:1']);
  eq(checked[0].items_short, 0);
  eq((await run(db, ['stock', '--location=WH-AKL', '--sku=KN-INS-10'])).find((s) => s.lot_no === 'L2401').qty, 11, 'restock comes out of the home warehouse');
  await run(db, ['ship-set', 'C-1101', 'KN-01']);
  eq((await run(db, ['sets'])).find((s) => s.code === 'KN-01').status, 'in_transit');
  await run(db, ['deliver-set', 'C-1101', 'KN-01']);
  eq(await issueOf('C-1101'), 'ok');
  ok(!(await rules()).includes('H01'), 'a delivered set clears H01');
  await rejects(['ship-set', 'C-1102', 'KN-03'], /not booked/);
  await rejects(['check-set', 'KN-02', '--restock=KN-INS-10::1'], /lot tracked/);

  // The clash: move C-1103 to another hip set.
  await run(db, ['unassign-set', 'C-1103', 'HP-02']);
  const assigned = await run(db, ['assign-set', 'C-1103', 'HP-03']);
  eq(assigned[0].clashes_with, null);
  eq(await count(['clashes']), 0);
  await rejects(['unassign-set', 'C-1102', 'HP-01'], /already shipped/);

  // The case with no set, and the set with expiring stock: swap the lot.
  await run(db, ['assign-set', 'C-1106', 'KN-01']);
  ok((await issueOf('C-1106')).includes('also booked on C-1101'), 'a set needs its turnaround days between cases');
  await run(db, ['unassign-set', 'C-1106', 'KN-01']);
  await rejects(['check-set', 'KN-03', '--remove=KN-INS-10:L2398:5'], /does not hold/);
  await run(db, ['check-set', 'KN-03', '--remove=KN-INS-10:L2398:2', '--restock=KN-INS-10:L2401:2']);
  eq(await issueOf('C-1105'), 'ok');
  ok(!(await rules()).includes('H02'), 'fresh stock clears H02');

  // The set out too long comes back.
  await run(db, ['return-set', 'KN-02']);
  eq(await count(['returns']), 0);
  eq((await run(db, ['sets'])).find((s) => s.code === 'KN-02').status, 'returned');
  await rejects(['return-set', 'KN-02'], /not out on a case/);
  await run(db, ['check-set', 'KN-02']);
  eq((await run(db, ['sets'])).find((s) => s.code === 'KN-02').status, 'available');

  // Order to cash.
  await rejects(['bill-case', 'C-1092', '--invoice=INV-1'], /no usage recorded/);
  const used = await run(db, ['add-usage', 'C-1092', '--sku=KN-FEM-3', '--serial=SN-F3-22301', '--card']);
  eq(Number(used[0].price_cents), 320000);
  eq((await run(db, ['unbilled'])).find((u) => u.code === 'C-1092').issue, 'usage in, no purchase order');
  await run(db, ['update-case', 'C-1092', '--po=NHP-9950']);
  eq((await run(db, ['unbilled'])).find((u) => u.code === 'C-1092').issue, 'ready to invoice');
  await run(db, ['bill-case', 'C-1090', '--invoice=INV-30500']);
  ok(!(await run(db, ['unbilled'])).some((u) => u.code === 'C-1090'), 'an invoiced case leaves the list');
  await run(db, ['add-usage', 'C-1091', '--sku=SCR-6545', '--lot=S7710', '--qty=2', '--from=consignment', '--location=BRP-CON']);
  eq((await run(db, ['stock', '--location=BRP-CON', '--sku=SCR-6545']))[0].qty, 8, 'consignment usage comes off the shelf');
  await rejects(['add-usage', 'C-1091', '--sku=SCR-6545', '--lot=S7710', '--qty=50', '--location=BRP-CON'], /only 8 on hand/);
  await rejects(['add-usage', 'C-1091', '--sku=SCR-6545', '--lot=NOPE'], /no lot "NOPE"/);
  await rejects(['add-usage', 'C-1091', '--sku=SCR-6545', '--qty=0'], /whole number of 1 or more/);

  // Consignment back to par.
  const pick = await run(db, ['draft-replenishment', 'NHP-CON']);
  ok(draftText(pick[0]).includes('L2401'), 'the pick list names the lot to pick');
  ok(!draftText(pick[0]).includes('L2398'), 'and leaves out the lot about to expire');
  await run(db, ['move-stock', '--from=WH-AKL', '--to=NHP-CON', '--sku=KN-INS-10', '--lot=L2401', '--qty=3']);
  eq((await run(db, ['consignment', '--location=NHP-CON'])).find((c) => c.sku === 'KN-INS-10').to_replenish, 0);
  await rejects(['draft-replenishment', 'NHP-CON'], /at par/);
  await run(db, ['set-par', '--location=BRP-CON', '--sku=HIP-HD-32', '--par=4']);
  eq(await count(['consignment']), 5);
  ok(!(await run(db, ['consignment'])).some((c) => c.to_replenish > 0), 'every location at par');
  await run(db, ['receive', '--location=WH-BNE', '--sku=HIP-HD-32', '--lot=H5600', '--expires=2029-01-31', '--qty=5']);
  eq((await run(db, ['stock', '--location=WH-BNE', '--sku=HIP-HD-32'])).length, 2);
  await rejects(['receive', '--location=WH-BNE', '--sku=HIP-HD-32', '--qty=5'], /lot tracked/);

  // Regulatory records.
  await run(db, ['update-product', 'HIP-STM-12', '--artg=ARTG 400106', '--billing-code=KD006']);
  ok(!(await rules()).includes('R01') && !(await rules()).includes('R06'), 'ARTG and billing code clear R01 and R06');
  await run(db, ['update-product', 'WDG-AUG-5', '--wand=today']);
  ok(!(await rules()).includes('R02'), 'a WAND notification clears R02');
  await run(db, ['add-product', '--sku=PAT-28', '--description=Patella button, 28 mm', '--track=lot', '--card', '--price=450', `--nz-first-supplied=${day(-60)}`]);
  ok((await run(db, ['compliance'])).some((f) => f.rule === 'R02' && f.record === 'PAT-28' && f.days_left < 0), 'a device past 30 working days with no WAND is overdue');
  await run(db, ['add-lot', '--sku=PAT-28', '--lot=P0912', '--expires=2028-06-30']);
  await rejects(['add-product', '--sku=X1'], /missing --description/);
  await rejects(['add-product', '--sku=X1', '--description=Y', '--kind=implantt'], /must be one of/);

  // Recall: quarantine pulls the stock and holds the set; R05 clears; the notice goes to the hospital.
  const notice = await run(db, ['draft-recall-notice', 'MA-2026-07']);
  eq(notice.map((n) => n.hospital), ['NHP']);
  ok(draftText(notice[0]).includes('Implanted: case C-1080'), 'the notice names the implanted case');
  const q = await run(db, ['quarantine', 'MA-2026-07']);
  eq(q[0].sets_on_hold, 'HP-02');
  ok(!(await rules()).includes('R05'), 'quarantine clears R05');
  eq((await run(db, ['stock', '--location=QUAR-AKL']))[0].qty, 3);
  await rejects(['assign-set', 'C-1104', 'HP-02'], /quarantine/);
  await run(db, ['check-set', 'HP-02', '--remove=SCR-6545:S7702:3', '--restock=SCR-6545:S7710:3']);
  eq((await run(db, ['sets'])).find((s) => s.code === 'HP-02').status, 'quarantine', 'a quarantined set stays held after its check');
  await db.query("update sets set status = 'available' where code = 'HP-02'");
  await run(db, ['close-recall', 'MA-2026-07']);
  eq(await count(['recall-trace']), 0);
  const fresh = await run(db, ['recall', '--code=MA-2026-08', '--sku=BC-40', '--lot=C881', '--country=NZ', '--kind=product alert', '--reason=Label misprint']);
  eq(fresh.map((t) => t.place), ['NHP-CON']);
  await rejects(['close-recall', 'MA-2026-08'], /still has 1 location/);
  await rejects(['recall', '--code=MA-X', '--sku=BC-40', '--country=UK'], /NZ, AU or both/);

  // Implant records on the next AU case.
  await run(db, ['add-usage', 'C-1102', '--sku=HIP-HD-32', '--lot=H5521', '--set=HP-01']);
  ok((await run(db, ['compliance'])).some((f) => f.rule === 'R04' && f.record === 'C-1102'), 'no card recorded raises R04');
  eq((await run(db, ['case', 'C-1102'])).case.status, 'done', 'usage marks the case done');

  // Booking, notes, drafts.
  await run(db, ['book-case', '--code=C-1200', '--hospital=NPH', `--on=${day(10)}`, '--surgeon=Lau', '--rep=Priya', '--procedure=Total hip replacement, left']);
  eq(await issueOf('C-1200'), 'no set booked');
  await rejects(['book-case', '--code=C-1201', '--hospital=NPH', '--on=31/12/2026'], /must be a date/);
  await rejects(['update-case', 'C-1200', '--status=finished'], /must be one of/);
  await run(db, ['log', 'C-1200', '--kind=call', '--body=Dr Lau wants the 52 mm cup on the shelf']);
  await run(db, ['log', 'Northside', '--body=New CSSD manager starts Monday']);
  eq((await db.query('select count(*)::int n from notes'))[0].n, 3);
  const conf = await run(db, ['draft-case-confirmation', 'C-1105']);
  ok(draftText(conf[0]).includes('KN-03'));
  await rejects(['draft-case-confirmation', 'C-1200'], /no set booked/);
  const chase = await run(db, ['draft-charge-chase', 'C-1091']);
  eq(chase[0].asking_for, 'purchase order');
  ok(draftText(chase[0]).includes('SCR-6545'));
  await rejects(['draft-charge-chase', 'C-1092'], /ready to invoice/);
  const review = await run(db, ['weekly-review']);
  ok(draftText(review[0]).includes('## Money'));
  ok((await run(db, ['audit'])).length >= 25, 'every write is audited');

  // Import: field inventory, kit lists, case history. Dry run, real run, repeat skipped, bad file rolled back.
  const inv = path.join(REPO_ROOT, 'examples', 'field-inventory.csv');
  const dry = await run(db, ['import', 'movemedical', inv, '--dry-run']);
  eq([dry[0].stock_lines, dry[0].locations_added, dry[0].products_added], [4, 2, 0]);
  eq((await db.query("select count(*)::int n from locations where name = 'Christchurch Surgical Centre'"))[0].n, 0, 'dry run saves nothing');
  const real = await run(db, ['import', 'stock', inv]);
  eq([real[0].units, real[0].lots_added], [11, 0]);
  eq((await db.query("select kind, country from locations where name = 'Christchurch Surgical Centre'"))[0], { kind: 'consignment', country: 'NZ' });
  eq((await db.query("select kind from locations where name = 'Mia Tane trunk'"))[0].kind, 'trunk');
  eq((await run(db, ['import', 'stock', inv]))[0].result, 'skipped');
  const kits = await run(db, ['import', 'kits', path.join(REPO_ROOT, 'examples', 'kit-lists.csv')]);
  eq([kits[0].kits_added, kits[0].lines], [1, 4]);
  const cases = await run(db, ['import', 'cases', path.join(REPO_ROOT, 'examples', 'case-history.csv')]);
  eq([cases[0].cases_added, cases[0].hospitals_added], [3, 1]);
  eq((await db.query("select status, surgery_on from cases where code = 'MM-55012'"))[0], { status: 'done', surgery_on: '2026-09-02' });
  const bad = path.join(tmp, 'bad.csv');
  fs.writeFileSync(bad, 'Location,Item Number,Lot Number,Expiration Date,Quantity\nNew Site,ZZ-1,A1,2027-01-01,1\nNew Site,ZZ-2,A2,next week,1\n');
  await rejects(['import', 'stock', bad], /cannot read the date/);
  eq((await db.query("select count(*)::int n from products where sku = 'ZZ-1'"))[0].n, 0, 'a bad row rolls back the whole file');

  // Export: every table plus a manifest, into a new folder only.
  const out = path.join(tmp, 'export');
  const manifest = await run(db, ['export', `--out=${out}`]);
  eq(manifest.length, 19);
  ok(fs.readFileSync(path.join(out, 'products.csv'), 'utf8').includes('"Knee tibial insert, 10 mm"'), 'CSV quoting survives');
  await rejects(['export', `--out=${out}`], /not empty/);

  await rejects(['nonsense'], /unknown command/);
  eq((await run(db, ['help'])).length, Object.keys(reads).length + Object.keys(commands).length);
} finally {
  await db.close();
}

// The rendered views and documents, and the CLI as a person runs it, on the same data.
const env = { ...process.env };
for (const [script, args, expect] of [
  ['view.mjs', [], /view: .*traceability/],
  ['docs.mjs', [], /document\(s\) rendered/],
  ['sets.mjs', ['attention'], /billing/],
  ['sets.mjs', ['readiness', '--json'], /"surgery_on"/],
]) {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', script), ...args], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, `${script} ${args.join(' ')} failed: ${r.stderr}`);
  assert.match(r.stdout, expect);
  checks++;
}
const amb = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sets.mjs'), 'case', 'walker'], { env, encoding: 'utf8' });
assert.equal(amb.status, 1, 'ambiguous match exits 1');
assert.match(amb.stderr, /Ambiguous/);
checks++;
for (const d of ['delivery-docket', 'charge-sheet', 'consignment-statement']) {
  assert.ok(fs.readdirSync(path.join(process.env.OUTPUT_DIR, 'docs-out', d)).length >= 1, `${d} rendered`);
  checks++;
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`PASS: ${checks} checks, ${Object.keys(reads).length + Object.keys(commands).length} commands (${process.env.DATABASE_URL ? 'postgres' : 'pglite'})`);
