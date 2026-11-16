---
description: "Move a case: date, status, purchase order, patient reference, charge sheet received"
---

# update-case

Run `npm run sets -- update-case <case> [--on=YYYY-MM-DD] [--status=booked|confirmed|done|cancelled] [--po=] [--patient=] [--charge-sheet=YYYY-MM-DD]`. Fill in the operator's values. Add `--json` when you need every field.

Change only what the operator named. Moving the date re-runs the readiness check: show it.

Nothing here sends a message or contacts anyone.
