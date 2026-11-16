---
description: "Receive stock into a location (a lot is created if new)"
---

# receive

Run `npm run sets -- receive --location= --sku= --qty= [--lot=] [--expires=YYYY-MM-DD]`. Fill in the operator's values. Add `--json` when you need every field.

Receive stock from a supplier or a transfer. Lot tracked products need `--lot` and `--expires`.

Nothing here sends a message or contacts anyone.
