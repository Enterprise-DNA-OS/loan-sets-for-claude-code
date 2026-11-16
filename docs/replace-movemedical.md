# Moving off Movemedical

Movemedical does not publish an export format, and its own site sells it through a demo request, so this guide works from the reports any field inventory system can produce as CSV: stock on hand by location and lot, kit lists, and case history. Ask your Movemedical administrator (or your account manager) for those three reports as CSV before you give notice, and keep them until the records here reconcile.

Every import runs with `--dry-run` first, shows its counts, and saves nothing. An identical file is skipped the second time. A bad row rolls back the whole file.

## 1. Hospitals, reps and surgeons

Set up your hospitals first, with each hospital's loan set lead time (`loan_lead_hours`) and return days, because the delivery deadlines come from them. Ask Claude Code: "Clear the demo and set up our hospitals: North Shore Private, 48 hours, returns in 3 days ...". Case history creates any hospital, surgeon or rep it does not know, so you can also start from the case import and fill in lead times after.

## 2. Stock on hand

```bash
npm run sets -- import stock inventory.csv --dry-run
npm run sets -- import stock inventory.csv
```

Columns read out of the box (any one of the names in each row):

| Field | Column names |
|---|---|
| Location | Location, Location Name, Inventory Location, Site, Facility, Account |
| Location type | Location Type, Type, Inventory Type (consignment, hospital or facility becomes consignment; trunk or rep becomes trunk; quarantine or hold becomes quarantine; anything else is a warehouse) |
| Item | Item Number, Item, Part Number, Product Code, SKU, Catalog Number, Reference, REF |
| Description | Item Description, Description, Product Description |
| Lot | Lot, Lot Number, Lot/Serial, Batch |
| Expiry | Expiration Date, Expiry, Expiry Date, Use By (YYYY-MM-DD or DD/MM/YYYY) |
| Quantity | Quantity, Qty, On Hand, Qty On Hand |
| Country | Country (NZ or AU; otherwise `--country=AU`) |

Other names take a mapping file: `{"sku": "Material", "lot": "Batch No"}` and `--mapping=map.json`. See `examples/field-inventory.csv`.

## 3. Kit lists

```bash
npm run sets -- import kits kit-lists.csv --dry-run
```

Columns: Kit (or Kit Name, Set, Set Name, Tray), Item Number, Item Description, Quantity. See `examples/kit-lists.csv`. Then create each physical set and load what is in it: ask Claude Code "set up sets KN-01 to KN-04 as Primary knee sets and load their contents from this list".

## 4. Case history

```bash
npm run sets -- import cases case-history.csv --dry-run
```

Columns: Case ID, Surgery Date, Facility, Country, Surgeon, Rep, Procedure, Status (completed, closed or billed becomes done; cancelled; confirmed; anything else booked), PO Number. See `examples/case-history.csv`. A case already imported is updated, not duplicated.

## 5. Product records

Add each product's tracking (lot or serial), whether it needs a patient implant card, its ARTG number and Prescribed List billing code for Australia, and its WAND notification date for New Zealand. Your regulatory affairs register usually holds these. Then run `/compliance`.

## What does not carry over

- **Usage line history.** Past charge sheets come across as cases. Bring the lot and serial of each implant across only if you need the distribution record here for past recalls; ask for it as part of the setup.
- **RFID reads and courier tracking events.** Those stay with the hardware and the courier.
- **Users and permissions.** This is a database you own: set up access on your own Postgres or Supabase.
- **Movemedical's predictive stock planning.** The usage history is here to build your own: ask "how many 10 mm inserts did we use per month at each hospital this year?"

Enterprise DNA does this move for you as part of a customised version: https://enterprisedna.co/omni/instead-of/movemedical
