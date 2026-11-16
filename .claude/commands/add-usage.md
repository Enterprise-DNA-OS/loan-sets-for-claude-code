---
description: "Record what was used on a case, from the charge sheet"
---

# add-usage

Run `npm run sets -- add-usage <case> --sku= [--lot=] [--serial=] [--qty=1] [--from=set|consignment|trunk] [--set=] [--location=] [--card]`. Fill in the operator's values. Add `--json` when you need every field.

Enter each line of the charge sheet: SKU, lot or serial, quantity, where it came from, and whether the implant card went with it (`--card`). Usage on a set comes off the set; consignment usage comes off that shelf. Read back the case value at the end.

Nothing here sends a message or contacts anyone.
