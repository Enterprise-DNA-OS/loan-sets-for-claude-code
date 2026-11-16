---
description: "Field stock that has not moved in 180 days, with its value"
---

# slow-stock

Run `npm run sets -- slow-stock [--json]`. Fill in the operator's values. Add `--json` when you need every field.

Total the value parked in the field. Suggest pulling back or moving stock that has sat 180 days to a hospital that uses it, using `surgeon-usage` to find one. Recording the move is `move-stock`.

Nothing here sends a message or contacts anyone.
