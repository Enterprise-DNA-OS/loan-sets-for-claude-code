---
description: "Draft the pick list to bring a consignment location back to par, picking shortest expiry first"
---

# draft-replenishment

Run `npm run sets -- draft-replenishment <location> [--from=<warehouse>]`. Fill in the operator's values. Add `--json` when you need every field.

Writes the pick list to drafts/, shortest expiry lot first, leaving out lots within 90 days of expiry. Record the move with `move-stock` once it is picked.

Nothing here sends a message or contacts anyone.
