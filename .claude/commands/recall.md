---
description: "Open a market action (recall, product alert or correction) on a product or one lot"
---

# recall

Run `npm run sets -- recall --code= --sku= [--lot=] --country=NZ|AU|both [--kind=recall|product_alert|product_correction|hazard_alert] [--reason=] [--notified=YYYY-MM-DD]`. Fill in the operator's values. Add `--json` when you need every field.

Open the market action as notified to the TGA or Medsafe. Show the trace it returns, then offer `quarantine` and `draft-recall-notice`.

Nothing here sends a message or contacts anyone.
