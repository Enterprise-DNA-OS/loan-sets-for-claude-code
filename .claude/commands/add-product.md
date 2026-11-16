---
description: "Add a product to the catalogue"
---

# add-product

Run `npm run sets -- add-product --sku= --description= [--kind=implant|instrument|consumable] [--track=lot|serial|none] [--card] [--price=] [--artg=] [--billing-code=] [--nz-first-supplied=YYYY-MM-DD] [--wand=YYYY-MM-DD]`. Fill in the operator's values. Add `--json` when you need every field.

Ask for the tracking (lot or serial), whether it needs an implant card, the ARTG number and the Prescribed List billing code for Australia, and the NZ first supply date.

Nothing here sends a message or contacts anyone.
