---
description: "Import stock on hand, kit lists or case history from a Movemedical (or any) CSV export"
---

# import

Run `npm run sets -- import stock <file.csv> [--mapping=map.json] [--dry-run]`. Fill in the operator's values. Add `--json` when you need every field.

Run with --dry-run first and show the counts. Check the location names and kinds it would create. Then run it for real. Other column names take a mapping file: see docs/replace-movemedical.md. An identical file is skipped; a bad row rolls back the whole file.

Nothing here sends a message or contacts anyone.
