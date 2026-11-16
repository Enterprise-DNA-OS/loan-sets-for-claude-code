---
description: "Surgery done, not invoiced: missing charge sheets, missing purchase orders, ready to bill"
---

# unbilled

Run `npm run sets -- unbilled [--json]`. Fill in the operator's values. Add `--json` when you need every field.

Total the value waiting first. Then the three groups: chase the charge sheet, chase the purchase order, ready to invoice. Offer `draft-charge-chase` for the first two and `bill-case` once the invoice is raised in the accounts system.

Nothing here sends a message or contacts anyone.
