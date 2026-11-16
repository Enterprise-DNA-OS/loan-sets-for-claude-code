---
description: "Check a returned set against its kit list, restock from its home warehouse, mark it available"
---

# check-set

Run `npm run sets -- check-set <set> [--restock=SKU:LOT:QTY,SKU::QTY] [--remove=SKU:LOT:QTY]`. Fill in the operator's values. Add `--json` when you need every field.

Run after the set is checked against its kit list. `--remove=` takes out used, damaged or recalled items; `--restock=` adds from the home warehouse (lot tracked items need the lot). Report anything still short or expiring within 30 days.

Nothing here sends a message or contacts anyone.
