# Loan Sets for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Distributor:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs doing this week? | `/attention` |
| Are this week's cases ready? | `/readiness`, then `/draft-case-confirmation` |
| The Monday review | `/weekly-review` |
| Are we inside every rule? | `/compliance` |
| Which sets clash, are short, or are still out? | `/clashes`, `/shortfalls`, `/returns` |
| Where is set X, what is in it? | `/set`, `/sets` |
| Tell me about case X | `/case` |
| Book a case, move it, book a set | `/book-case`, `/update-case`, `/assign-set`, `/unassign-set` |
| Set shipped, delivered, back, checked | `/ship-set`, `/deliver-set`, `/return-set`, `/check-set` |
| Enter a charge sheet | `/add-usage` |
| What is not invoiced? | `/unbilled`, then `/draft-charge-chase`, `/bill-case` |
| What needs replenishing at a hospital? | `/consignment`, then `/draft-replenishment`, `/move-stock` |
| What is sitting idle or expiring? | `/slow-stock`, `/utilisation`, `/expiring` |
| A recall came in | `/recall`, `/recall-trace`, `/quarantine`, `/draft-recall-notice`, `/close-recall` |
| What does Dr X use? | `/surgeon-usage` |
| How are the reps going? | `/rep-load` |
| New product, lot, ARTG number, billing code, WAND date | `/add-product`, `/add-lot`, `/update-product` |
| Stock in or moved | `/receive`, `/move-stock`, `/set-par`, `/stock` |
| Log a call or visit | `/log` |
| Bring in Movemedical data | `/import` |
| Get everything out | `/export` |
| Change a field, status or rule | `/customise` |
| A new page to look at | `/new-view` |
| Who changed what | `/audit`, `/imports` |

If an ask fits nothing here, run the CLI directly (`npm run sets -- help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Rules for this business

- Patient references are health information. Keep them to the hospital's record number, never a name, and never paste them anywhere outside this folder and the database.
- A set goes to theatre only checked, complete against its kit list, and with nothing expiring before the surgery. If the operator wants to send it anyway, say what is wrong and let them decide.
- A recall finding is never closed by editing the data. Units are quarantined, swapped out of sets, and accounted for first.
- Compliance checks cite their source. Nothing here is regulatory advice; anything about whether to notify the TGA or Medsafe goes to the regulatory affairs lead.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off Movemedical.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/movemedical
