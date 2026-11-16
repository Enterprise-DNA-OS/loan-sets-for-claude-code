---
description: "Pull every affected unit of a market action: stock to quarantine, sets on hold"
---

# quarantine

Run `npm run sets -- quarantine <action> [--to=<quarantine location>]`. Fill in the operator's values. Add `--json` when you need every field.

Moves affected stock to the quarantine location and holds every set with an affected unit. Then swap the units out of each set with `check-set --remove=`, restock, and release.

Nothing here sends a message or contacts anyone.
