---
description: "Sets short of their kit list, item by item"
---

# shortfalls

Run `npm run sets -- shortfalls [--json]`. Fill in the operator's values. Add `--json` when you need every field.

List what each set is missing. Check the home warehouse stock with `stock --location=<home> --sku=<sku>` and offer the `check-set --restock=` line that fills it, shortest expiry lot first.

Nothing here sends a message or contacts anyone.
