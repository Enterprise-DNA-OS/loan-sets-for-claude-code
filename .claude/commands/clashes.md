---
description: "Sets booked on two cases too close together to turn around"
---

# clashes

Run `npm run sets -- clashes [--json]`. Fill in the operator's values. Add `--json` when you need every field.

For each clash, look for a free set of the same kit with `sets` and `utilisation`, and propose the swap with `unassign-set` and `assign-set`. Do not move a set that has already shipped.

Nothing here sends a message or contacts anyone.
