<h1 align="center">Loan Sets for Claude Code</h1>

<p align="center">
  <strong>The open-source loan set and field stock system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Movemedical data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=movemedical">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/movemedical?utm_source=github&utm_medium=readme&utm_campaign=movemedical">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-weekly-rituals">Commands</a> &bull;
  <a href="#instead-of-movemedical">Instead of Movemedical</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Loan Sets for Claude Code runs the field side of a medical device distributor: surgical cases, the loan sets booked to them, what is in each set against its kit list, consignment stock at hospitals, rep trunk stock, usage from charge sheets, billing, and recalls traced to every unit. It is a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask in plain language.

Movemedical publishes no price. It is sold through a demo request, as a modular platform for medical device manufacturers and hospitals, with RFID, courier and ERP connections ([movemedical.com](https://www.movemedical.com), read 16 November 2026).

It is for orthopaedic, spine, trauma and other implant distributors in New Zealand and Australia with a handful of reps, a warehouse, a few dozen loan sets and consignment stock in hospitals: the office that gets every set to theatre inside the hospital's lead time, chases charge sheets and purchase orders, keeps consignment at par, and can say where every unit of a recalled lot is. The ARTG, WAND, distribution record, implant card and Prescribed List checks are built in.

Want the same thing with a rep app, barcode or RFID scanning, or a web front end? That is a customisation, and it is what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=movemedical).

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your cases, sets and stock sit in plain Postgres tables you own. Any tool can read them. No export fee, no lock-in.
- No seats, no modules. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for what a screen still gives you.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node 20 or later):

```bash
git clone https://github.com/Enterprise-DNA-OS/loan-sets-for-claude-code.git
cd loan-sets-for-claude-code
npm install
npm test
npm run demo
npm run sets -- attention
```

Then open the folder in Claude Code and type `/attention`. The demo is an orthopaedic distributor with four hospitals in New Zealand and Australia: a knee set for tomorrow that has not shipped and is one insert short, a hip set booked on two cases a day apart, a set holding inserts that expire before the surgery, a set still at a hospital six days after the case, a case with no charge sheet, a private case with no purchase order, a consignment cupboard below par, a hip stem sold in Australia with no ARTG number on file, a new wedge two days from its WAND deadline, and a recalled screw lot sitting in a set, on a hospital shelf and in a patient.

Seed only an empty demo database. On Postgres, `npm run seed -- --demo-database` is required on purpose.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. Patient references on cases are health information under the Privacy Act 2020 (NZ) and the Privacy Act 1988 (Cth): keep them to the hospital's record number, and set up controlled access and backups before shared use.

## The weekly rituals

| Command | What it does |
|---|---|
| `/attention` | Everything late, short, clashing, unbilled or out of rule, one list |
| `/readiness` | Every case in the next 14 days: sets booked, delivered, short, expiring or clashing, against the hospital's lead time |
| `/weekly-review` | Writes the Monday review to `drafts/`: cases at risk, sets, money in the field, rules, reps |
| `/compliance` | Checks the records against six NZ and AU rules and two house rules, each cited in [docs/compliance.md](docs/compliance.md) |
| `/clashes` | Sets booked on two cases too close together to turn around |
| `/shortfalls` | Sets short of their kit list, item by item |
| `/returns` | Sets still at a hospital past its return days |
| `/unbilled` | Surgery done, not invoiced: missing charge sheets, missing purchase orders, ready to bill |
| `/consignment` | Consignment stock against par, with what to replenish |
| `/slow-stock` | Field stock that has not moved in 180 days, with its value |
| `/expiring` | Lots expiring within 90 days, in stock or in a set |
| `/recall-trace` | Every unit of an open recall: stock, loan sets and patients' cases |
| `/utilisation` | Cases per set in 90 days: sets earning their keep and sets sitting idle |
| `/surgeon-usage` | What each surgeon used in the last year, by product and value |
| `/rep-load` | Cases, problems, overdue returns and unbilled cases per rep |
| `/sets`, `/set` | Every set and where it is; one set with its contents and history |
| `/cases`, `/case` | Live cases; one case with sets, usage, value and notes |

Records and paperwork:

| Command | What it does |
|---|---|
| `/book-case`, `/update-case` | Book a case, move its date, status, purchase order or patient reference |
| `/assign-set`, `/unassign-set` | Book a set to a case, and see a clash straight away |
| `/ship-set`, `/deliver-set`, `/return-set` | Record a set out, signed for at the hospital, and back |
| `/check-set` | Check a returned set, take out used or recalled items, restock from the warehouse, release it |
| `/add-usage` | Enter the charge sheet: SKU, lot or serial, quantity, source, implant card |
| `/bill-case` | Record the invoice number once it is raised |
| `/add-product`, `/update-product`, `/add-lot` | The catalogue, with tracking, implant card, ARTG, billing code and WAND dates |
| `/receive`, `/move-stock`, `/set-par`, `/stock` | Stock in, stock moved between warehouse, consignment, trunk and quarantine, par levels |
| `/recall`, `/quarantine`, `/close-recall` | Open a market action, pull every affected unit, close it when accounted for |
| `/draft-case-confirmation` | Email to theatre or sterilising services confirming which sets arrive when |
| `/draft-charge-chase` | Email for a missing charge sheet or purchase order |
| `/draft-replenishment` | Pick list to bring a consignment location to par, shortest expiry first |
| `/draft-recall-notice` | One recall letter per hospital listing the units it holds and the implanted cases |
| `/log` | Log a call, email, visit or note against a case or a hospital |
| `/import` | Stock on hand, kit lists or case history from a Movemedical (or any) CSV export |
| `/export` | Every table to CSV and JSON with a manifest |
| `/customise` | Add a field, rename a status, change a rule, in plain language |
| `/new-view` | Add a read-only page to `npm run view` |
| `/hospitals`, `/products`, `/audit`, `/imports`, `/help` | Reference lists, who changed what, what was imported, every command |

Every CLI command takes `--json`. Records match on their code or any part of the name; an ambiguous match lists the candidates and exits 1. Nothing sends: every letter and email is written to `drafts/` for a person to send.

`npm run view` renders three read-only pages (the week, money in the field, traceability) in your colours from `brand.json`. `npm run docs` renders a delivery docket per coming case, a charge sheet per done case, a customer list per open recall and a consignment statement per hospital.

## Ten questions Movemedical's screens do not answer for you

Each is one command against your own records today.

1. Which cases this week have a set that is not delivered inside the hospital's lead time? `readiness`
2. Which sets are booked on two cases too close together to turn around? `clashes`
3. Which sets are short of their kit list, and what exactly is missing? `shortfalls`
4. Which sets hold a lot that expires before the surgery they are booked for? `readiness`, `expiring`
5. Which sets are still sitting at a hospital days after the case? `returns`
6. Which cases are done but not invoiced, and how much is waiting on a charge sheet or a purchase order? `unbilled`
7. Which consignment locations are below par, and which lots should we pick? `consignment`, `draft-replenishment`
8. How much stock has sat at hospitals and in rep trunks for six months, and what is it worth? `slow-stock`
9. Where is every unit of a recalled lot right now, down to the patient's case? `recall-trace`
10. Which products are we selling in Australia with no ARTG number or billing code on file, and which new devices are close to their WAND deadline? `compliance`

## Your first hour: ten things to ask for

1. "Put our company name and colours in brand.json."
2. "Run the attention list on the demo and explain each row."
3. "Which cases this week are at risk, and draft the confirmation to theatre for the closest one."
4. "Clear the demo and set up our hospitals with their loan set lead times."
5. "Map our field inventory export and dry-run it."
6. "Import our kit lists, then our sets and what is in each one."
7. "Import the last three months of cases."
8. "Show me every case done and not invoiced, and draft the charge sheet chases."
9. "Add our SOP rule that every set is checked within 60 days to the compliance check."
10. "Set up a shared database with backups for the office and the reps."

## Instead of Movemedical

Export stock on hand, kit lists and case history as CSV and run `npm run sets -- import stock inventory.csv --dry-run`. Column names common in field inventory exports are read out of the box; anything else takes a one-line mapping. The full guide, including what does not carry over, is [docs/replace-movemedical.md](docs/replace-movemedical.md).

## Architecture

```
loan-sets-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     compliance rules, the Movemedical guide, why no front end
  views.json, documents.json the read-only pages and the paperwork
  examples/                 sample export files for the importers
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Loan Sets for Claude Code for your business, migrates your Movemedical data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=movemedical)
- Read more: [enterprisedna.co/omni/instead-of/movemedical](https://enterprisedna.co/omni/instead-of/movemedical?utm_source=github&utm_medium=readme&utm_campaign=movemedical)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
