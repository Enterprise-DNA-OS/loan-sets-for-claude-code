# Compliance rules

`npm run sets -- compliance` checks the records against the rules below. Each check lives in one SQL view, `compliance_findings`, in `supabase/migrations/0001_loan_sets.sql`, so the CLI, the weekly review and the rendered views share one definition.

These are the records a medical device distributor in New Zealand or Australia keeps every week: what it may supply, how it traces each implant, and what it does when a lot is recalled. A clean check means the recorded data passes the rule. It is not regulatory advice, and it is only as good as the records entered: your regulatory affairs lead owns the decision on every finding.

Sources:
- Therapeutic Goods Act 1989 (Cth): https://www.legislation.gov.au/C2004A03952/latest/text
- TGA, distribution records for medical devices: https://www.tga.gov.au/products/medical-devices/supply-and-distribution/distribution-records
- TGA, patient implant cards and patient information leaflets: https://www.tga.gov.au/resources/resource/guidance/medical-device-patient-information-leaflets-and-implant-cards
- TGA, Procedure for Recalls, Product Alerts and Product Corrections (PRAC, in force 5 March 2025): https://www.tga.gov.au/recalls-and-non-recall-actions
- Medsafe, WAND notification (Medicines (Database of Medical Devices) Regulations 2003): https://www.medsafe.govt.nz/regulatory/devicesnew/3-6RegulatoryRequirements.asp
- Medsafe, New Zealand Medicines and Medical Devices Recall Code (2015): https://www.medsafe.govt.nz/Safety/RecallCode.pdf
- Department of Health, Disability and Ageing, the Prescribed List: https://www.health.gov.au/our-work/the-prescribed-list/about

| Rule | What it checks | Source | Breach in the data |
|---|---|---|---|
| R01 | A medical device supplied in Australia is included in the ARTG. The check flags a non-instrument product held in Australian stock, booked to an Australian case, or used at an Australian hospital with no ARTG number on its record. | Therapeutic Goods Act 1989 s 41MI | `products.artg_no` empty and the product in AU stock, an AU loan set booked to a live case, or AU usage |
| R02 | A sponsor notifies a medical device to Medsafe's WAND database within 30 working days of becoming its sponsor, which Medsafe reads as from the day the device first arrives in New Zealand. The check flags a device 14 days or less from that date, or past it, with no notification recorded. Weekends are skipped; public holidays are not, so it warns early, never late. | Medicines (Database of Medical Devices) Regulations 2003 reg 6 | `first_supplied_nz_on` set, `wand_notified_on` empty |
| R03 | Sponsors keep distribution records so a recall can reach every unit. The check flags implant usage at an Australian hospital with no lot number (lot tracked) or serial number (serial tracked). | Therapeutic Goods Act 1989 s 41FO | `usage` row, AU hospital, implant, lot or serial missing |
| R04 | Patient information materials, including a patient implant card, go with implantable devices that need them (screws, plates, sutures and the other listed exclusions do not). The check flags an implant marked `card_required` used in Australia with no card recorded. | Therapeutic Goods (Medical Devices) Regulations 2002 Sch 1 cl 13A | `usage.implant_card_given` false on a `card_required` product, AU hospital |
| R05 | An open recall, product alert or correction has every affected unit accounted for. The check flags affected units still in a stock location that is not quarantine, or in a loan set not on hold. Patients' cases are listed by `recall-trace` for the hospital to follow up, and are not a breach. | TGA PRAC (2025); NZ Medicines and Medical Devices Recall Code (2015) | `recall_trace` rows held in stock or a set |
| R06 | An implant billed to an Australian private hospital carries its Prescribed List billing code, so the hospital can claim the benefit from the insurer. | Private Health Insurance (Medical Devices and Human Tissue Products) Rules, Sch 1 (the Prescribed List), made under the Private Health Insurance Act 2007 | `usage` at an AU private hospital, implant, `products.billing_code` empty |
| H01 | House rule from each hospital's loan set policy: a set is at the hospital `loan_lead_hours` before 07:00 on the day of surgery, so sterilising services can process it. The check flags a set not delivered within 24 hours of that deadline, or past it. | The hospital's loan set policy, recorded as `hospitals.loan_lead_hours` | `case_sets.delivered_at` empty and now later than the deadline less 24 hours |
| H02 | House rule: nothing leaves the warehouse in a loan set that expires on or before the surgery it is booked for. | Your quality system | a booked set holds a lot with `expires_on` on or before `surgery_on` |

## What the checks do not cover

- Whether a product is classified correctly, or whether its ARTG entry covers the exact model. The check only sees that a number is on file.
- Reprocessing standards inside the hospital (AS 5369 in Australia, AS/NZS 4187 where it still applies). The hospital owns those; the lead time on its record is how you meet them.
- Adverse event reporting to the TGA or Medsafe. Log the event as a note on the case and report it through your quality system.
- Unique device identification. When the TGA or Medsafe UDI rules apply to your products, add the UDI as a field with `/customise`.

## Adding a rule

Ask Claude Code with `/customise`, for example "flag any loan set not checked in 60 days, per our SOP QP-14". It writes a new migration that extends the view, adds a row to this table with the source, and adds a test.
